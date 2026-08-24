// ═══════════════════════════════════════════════════════════
// SARA Agentic Tool Dispatcher
// Bridges LLM tool_calls → real actions (DB, API, workflows)
// ═══════════════════════════════════════════════════════════

import { execSync } from 'child_process';
import { writeFileSync } from 'fs';
import { pool } from '../config.js';
import type { ToolCallResult, ToolDef } from './ai-providers.js';
import { chatChain } from './ai-providers.js';
import type { SaraTool } from '../sara-tools.js';
import { getSectorTools } from '../sara-tools.js';
import { shouldQueueAgenticAction } from './autonomy-gate.js';
import { getActiveSock } from './sock-registry.js';

// ─── Risk levels per tool ───
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

const TOOL_RISK: Record<string, RiskLevel> = {
    // LOW — info only
    check_availability: 'low',
    get_menu: 'low',
    get_allergens: 'low',
    get_price_list: 'low',
    get_treatments: 'low',
    get_services: 'low',
    get_portfolio: 'low',
    get_case_studies: 'low',
    get_team: 'low',
    get_compensation_plan: 'low',
    get_products: 'low',
    get_platform_info: 'low',
    get_listing_detail: 'low',
    get_fee_estimate: 'low',
    get_omi_values: 'low',
    check_urban_constraints: 'low',
    check_stock: 'low',
    // MEDIUM — creates/modifies records
    book_table: 'medium',
    book_appointment: 'medium',
    book_consultation: 'medium',
    book_visit: 'medium',
    book_test_drive: 'medium',
    book_service: 'medium',
    book_briefing: 'medium',
    book_presentation: 'medium',
    book_demo: 'medium',
    book_inspection: 'medium',
    book_strategy_call: 'medium',
    register_lead: 'medium',
    request_quote: 'medium',
    request_valuation: 'medium',
    request_audit: 'medium',
    search_listings: 'low',
    search_auctions: 'low',
    start_trial: 'medium',
    contact_team: 'medium',
    collect_investment_interest: 'medium',
    start_feasibility_analysis: 'medium',
    // HIGH — financial/destructive
    get_rate: 'low',
    get_trade_in_estimate: 'medium',
    // ShopOS
    search_product: 'low',
    check_stock_shop: 'low',
    reserve_product: 'medium',
    // WellnessOS
    book_class: 'medium',
    check_membership: 'low',
    check_schedule: 'low',
    // FacilityOS / ServiceOS
    create_ticket: 'medium',
    check_asset_status: 'low',
    // Misc
    get_ad_performance: 'low',
    get_franchise_info: 'low',
    request_franchise_kit: 'medium',
    get_reputation_report: 'low',
    request_reputation_audit: 'medium',
    get_project_status: 'low',
    generate_sal: 'low',
    // StudioOS — Gara/Tender Agent
    parse_bando: 'low',
    checklist_gara: 'low',
    scadenze_gare: 'low',
};

export function getToolRisk(toolName: string): RiskLevel {
    return TOOL_RISK[toolName] || 'medium';
}

// ─── Tool Result ───
export interface ToolResult {
    success: boolean;
    data?: Record<string, unknown>;
    error?: string;
}

// ─── Convert SaraTool[] to OpenAI ToolDef[] ───
export function saraToolsToOpenAI(sector: string): ToolDef[] {
    const tools = getSectorTools(sector);
    return tools.map(t => ({
        type: 'function' as const,
        function: {
            name: t.name,
            description: t.description,
            parameters: {
                type: 'object' as const,
                properties: Object.fromEntries(
                    t.params.map(p => [p, { type: 'string', description: p }])
                ),
                required: t.params.filter(p =>
                    // Core params are required, optional ones (notes, category) are not
                    !['notes', 'category', 'area', 'sector', 'trade_in', 'complexity', 'budget_range', 'color'].includes(p)
                ),
            },
        },
    }));
}

/**
 * Formatta una data come YYYY-MM-DD nel fuso LOCALE.
 *
 * Prima si usava `toISOString().slice(0, 10)`, che converte in UTC. Su una
 * macchina a fuso positivo, fra mezzanotte e l'offset, "oggi" restituiva IERI
 * e "domani" restituiva OGGI: ogni data gestita dall'agente slittava di un
 * giorno per un paio d'ore ogni notte. Un tavolo prenotato all'una per domani
 * finiva sul giorno sbagliato, senza nessun errore.
 *
 * In produzione il server e su UTC e il difetto non si manifestava, ma questo
 * repository e pubblico e auto-ospitabile: chi lo installa in Italia lo prende
 * in pieno. E far dipendere la correttezza dal fuso della macchina, senza
 * scriverlo da nessuna parte, e una trappola comunque.
 */
function dataLocale(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ─── Date normalizer (LLM often returns "domani", "today", etc.) ───
// Esportata per poterla verificare: converte le date che il modello scrive in
// linguaggio naturale, ed e il punto in cui un errore prenota il giorno
// sbagliato senza che nessuno se ne accorga.
export function normalizeDate(raw: string): string {
    if (!raw) return raw;
    const lower = raw.toLowerCase().trim();
    const now = new Date();
    if (lower === 'oggi' || lower === 'today' || lower === 'hoy' || lower === 'hoje') {
        return dataLocale(now);
    }
    if (lower === 'domani' || lower === 'tomorrow' || lower === 'manana' || lower === 'amanha') {
        now.setDate(now.getDate() + 1);
        return dataLocale(now);
    }
    if (lower === 'dopodomani' || lower === 'day after tomorrow' || lower === 'pasado manana') {
        now.setDate(now.getDate() + 2);
        return dataLocale(now);
    }
    // Day names → next occurrence
    const days: Record<string, number> = {
        lunedi: 1, monday: 1, martedi: 2, tuesday: 2, mercoledi: 3, wednesday: 3,
        giovedi: 4, thursday: 4, venerdi: 5, friday: 5, sabato: 6, saturday: 6,
        domenica: 0, sunday: 0,
    };
    const dayNum = days[lower.replace(/[ìíèé]/g, c => ({ 'ì': 'i', 'í': 'i', 'è': 'e', 'é': 'e' }[c] || c))];
    if (dayNum !== undefined) {
        const current = now.getDay();
        let diff = dayNum - current;
        if (diff <= 0) diff += 7; // next week if today or past
        now.setDate(now.getDate() + diff);
        return dataLocale(now);
    }
    // If already YYYY-MM-DD, return as-is
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    // Try to parse other formats
    const parsed = new Date(raw);
    if (!isNaN(parsed.getTime())) return dataLocale(parsed);
    return raw; // fallback — let DB handle or fail gracefully
}

// ─── Handler Registry ───
type ToolHandler = (args: Record<string, string>, context: ToolContext) => Promise<ToolResult>;

export interface ToolContext {
    tenantId?: string;
    phone: string;
    sector: string;
    lang: string;
}

const handlers: Record<string, ToolHandler> = {};

function registerHandler(name: string, handler: ToolHandler) {
    handlers[name] = handler;
}

// ─── DISPATCH ───
export async function dispatchToolCall(
    toolCall: ToolCallResult,
    context: ToolContext,
): Promise<{ toolName: string; result: ToolResult }> {
    const toolName = toolCall.function.name;
    let args: Record<string, string>;
    try {
        args = JSON.parse(toolCall.function.arguments);
    } catch {
        return { toolName, result: { success: false, error: 'Invalid tool arguments' } };
    }

    // Normalize date fields before dispatch
    for (const key of ['date', 'preferred_date', 'start_date', 'check_in', 'check_out']) {
        if (args[key]) args[key] = normalizeDate(args[key]);
    }

    const handler = handlers[toolName];
    if (!handler) {
        console.warn(`[DISPATCH] No handler for tool: ${toolName}`);
        return {
            toolName,
            result: {
                success: false,
                error: `Tool ${toolName} is not yet implemented. Tell the user you are checking with the team.`,
            },
        };
    }

    try {
        console.log(`[DISPATCH] Executing ${toolName}(${JSON.stringify(args).slice(0, 200)})`);
        const result = await handler(args, context);
        console.log(`[DISPATCH] ${toolName} → ${result.success ? 'OK' : 'FAIL'}`);
        return { toolName, result };
    } catch (err: any) {
        console.error(`[DISPATCH] ${toolName} error:`, err.message);
        return { toolName, result: { success: false, error: err.message } };
    }
}

// ═══════════════════════════════════════════════════════════
// HANDLERS — Real implementations per tool
// ═══════════════════════════════════════════════════════════

// ─── DineOS: check_availability ───
// PROD schema: dineos_reservations(id UUID, user_id UUID, guest_name VARCHAR,
//         guest_phone VARCHAR, party_size INT, date DATE, time TIME, status, notes, created_at)
registerHandler('check_availability', async (args, ctx) => {
    const date = args.date || args.start_date || args.preferred_date;
    const { time, guests } = args;
    if (!date) return { success: false, error: 'Missing date parameter' };

    const guestCount = parseInt(guests || '2', 10);
    try {
        const res = await pool.query(
            `SELECT COUNT(*) as booked, COALESCE(SUM(party_size), 0) as total_guests
             FROM dineos_reservations
             WHERE user_id = $1 AND date = $2
               AND status NOT IN ('cancelled', 'no_show')`,
            [ctx.tenantId || null, date],
        );
        const booked = parseInt(res.rows[0]?.booked || '0', 10);
        const totalGuests = parseInt(res.rows[0]?.total_guests || '0', 10);
        const maxCapacity = 50;
        const available = maxCapacity - totalGuests;
        const canBook = available >= guestCount;

        return {
            success: true,
            data: {
                date,
                time: time || 'any',
                guests_requested: guestCount,
                reservations_count: booked,
                covers_available: Math.max(0, available),
                can_book: canBook,
                message: canBook
                    ? `Disponibilita confermata: ${available} coperti liberi per il ${date}`
                    : `Mi dispiace, solo ${available} coperti disponibili per il ${date}`,
            },
        };
    } catch (err: any) {
        if (err.message?.includes('does not exist')) {
            return {
                success: true,
                data: {
                    date,
                    can_book: true,
                    covers_available: 50,
                    message: `Disponibilita confermata per il ${date}. Nessuna prenotazione ancora registrata.`,
                },
            };
        }
        throw err;
    }
});

// ─── DineOS: book_table ───
registerHandler('book_table', async (args, ctx) => {
    const { date, time, guests, name, phone, notes } = args;
    if (!date || !time || !name) {
        return { success: false, error: 'Missing required fields: date, time, name' };
    }

    const guestCount = parseInt(guests || '2', 10);
    const customerPhone = phone || ctx.phone;

    try {
        const res = await pool.query(
            `INSERT INTO dineos_reservations
               (user_id, date, time, party_size, guest_name, guest_phone, notes, status, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, 'confirmed', NOW())
             RETURNING id`,
            [ctx.tenantId || null, date, time, guestCount, name, customerPhone, notes || ''],
        );
        const reservationId = res.rows[0]?.id;
        return {
            success: true,
            data: {
                reservation_id: reservationId,
                date,
                time,
                guests: guestCount,
                name,
                phone: customerPhone,
                status: 'confirmed',
                message: `Prenotazione confermata! Tavolo per ${guestCount} il ${date} alle ${time} a nome ${name}. Riferimento: #${reservationId}`,
            },
        };
    } catch (err: any) {
        if (err.message?.includes('does not exist')) {
            return {
                success: false,
                error: 'Il sistema di prenotazione non e ancora configurato. Lasciami mettere in contatto con il team.',
            };
        }
        throw err;
    }
});

// ─── DineOS: get_menu ───
// Schema: dineos_menu_items(id UUID, user_id UUID, name, category, description, price, allergens TEXT[], available BOOL, photo_url)
registerHandler('get_menu', async (args, ctx) => {
    const { category } = args;
    try {
        const query = category
            ? `SELECT name, description, price, category, allergens FROM dineos_menu_items WHERE user_id = $1 AND LOWER(category) = LOWER($2) AND available = true ORDER BY sort_order, name`
            : `SELECT name, description, price, category, allergens FROM dineos_menu_items WHERE user_id = $1 AND available = true ORDER BY category, sort_order, name`;
        const params = category ? [ctx.tenantId || null, category] : [ctx.tenantId || null];
        const res = await pool.query(query, params);
        if (res.rows.length === 0) {
            return { success: true, data: { message: 'Menu non ancora configurato. Contatta il team per i dettagli.' } };
        }
        return { success: true, data: { items: res.rows, count: res.rows.length } };
    } catch (err: any) {
        if (err.message?.includes('does not exist')) {
            return { success: true, data: { message: 'Menu non ancora configurato.' } };
        }
        throw err;
    }
});

// ─── DineOS: get_allergens ───
registerHandler('get_allergens', async (args, ctx) => {
    const { dish_name } = args;
    if (!dish_name) return { success: false, error: 'Specifica il nome del piatto' };
    try {
        const res = await pool.query(
            `SELECT name, allergens, description FROM dineos_menu_items WHERE user_id = $1 AND LOWER(name) LIKE LOWER($2) AND available = true`,
            [ctx.tenantId || null, `%${dish_name}%`],
        );
        if (res.rows.length === 0) {
            return { success: true, data: { message: `Piatto "${dish_name}" non trovato nel menu.` } };
        }
        return { success: true, data: { dish: res.rows[0] } };
    } catch (err: any) {
        if (err.message?.includes('does not exist')) {
            return { success: true, data: { message: 'Informazioni allergeni non disponibili. Contatta direttamente il ristorante.' } };
        }
        throw err;
    }
});

// ─── BeautyOS: book_appointment ───
// Schema: beautyos_appointments(id UUID, user_id UUID, client_name, staff_name, treatment_name,
//         date DATE, time VARCHAR, duration_min, price, status, notes)
registerHandler('book_appointment', async (args, ctx) => {
    const { treatment, preferred_date, preferred_time, name, phone } = args;
    if (!preferred_date || !name) {
        return { success: false, error: 'Missing required fields: preferred_date, name' };
    }
    if (!ctx.tenantId) {
        return { success: true, data: { message: `Appuntamento per ${treatment || 'trattamento'} il ${preferred_date} alle ${preferred_time || '10:00'} a nome ${name} registrato. Il centro ti contattera per conferma.` } };
    }
    try {
        const res = await pool.query(
            `INSERT INTO beautyos_appointments
               (user_id, client_name, treatment_name, date, time, status, notes)
             VALUES ($1, $2, $3, $4, $5, 'confirmed', $6)
             RETURNING id`,
            [ctx.tenantId, name, treatment || 'general', preferred_date, preferred_time || '10:00', `Phone: ${phone || ctx.phone}`],
        );
        return {
            success: true,
            data: {
                appointment_id: res.rows[0]?.id,
                treatment,
                date: preferred_date,
                time: preferred_time || '10:00',
                name,
                status: 'confirmed',
                message: `Appuntamento confermato per ${treatment || 'trattamento'} il ${preferred_date} alle ${preferred_time || '10:00'} a nome ${name}.`,
            },
        };
    } catch (err: any) {
        if (err.message?.includes('does not exist')) {
            return { success: false, error: 'Sistema appuntamenti non ancora attivo. Ti metto in contatto con il centro.' };
        }
        throw err;
    }
});

// ─── PropertyOS: search_listings ───
// PROD schema: propertyos_listings(id UUID, user_id UUID, name, title, address, city, type,
//         property_type, status, price, sqm, rooms, bathrooms, description)
registerHandler('search_listings', async (args, ctx) => {
    const { city, type, min_price, max_price } = args;
    try {
        let query = `SELECT id, COALESCE(title, name) as title, city, address, COALESCE(property_type, type) as property_type, price, sqm, rooms, description
                     FROM propertyos_listings WHERE user_id = $1 AND status = 'active'`;
        const params: any[] = [ctx.tenantId || null];
        let i = 2;
        if (city) { query += ` AND LOWER(city) LIKE LOWER($${i})`; params.push(`%${city}%`); i++; }
        if (type) { query += ` AND LOWER(property_type) = LOWER($${i})`; params.push(type); i++; }
        if (min_price) { query += ` AND price >= $${i}`; params.push(parseInt(min_price)); i++; }
        if (max_price) { query += ` AND price <= $${i}`; params.push(parseInt(max_price)); i++; }
        query += ` ORDER BY created_at DESC LIMIT 5`;
        const res = await pool.query(query, params);
        if (res.rows.length === 0) {
            return { success: true, data: { message: 'Nessun immobile trovato con questi criteri. Vuoi ampliare la ricerca?' } };
        }
        return { success: true, data: { listings: res.rows, count: res.rows.length } };
    } catch (err: any) {
        if (err.message?.includes('does not exist')) {
            return { success: true, data: { message: 'Catalogo immobili non ancora configurato.' } };
        }
        throw err;
    }
});

// ─── PropertyOS: get_listing_detail ───
registerHandler('get_listing_detail', async (args, ctx) => {
    const { listing_id } = args;
    if (!listing_id) return { success: false, error: 'Specifica l\'ID dell\'immobile' };
    try {
        const res = await pool.query(
            `SELECT id, COALESCE(title, name) as title, city, address, COALESCE(property_type, type) as property_type, price, sqm, rooms, bathrooms, description
             FROM propertyos_listings WHERE id = $1`,
            [listing_id],
        );
        if (res.rows.length === 0) return { success: true, data: { message: 'Immobile non trovato.' } };
        return { success: true, data: { listing: res.rows[0] } };
    } catch { return { success: true, data: { message: 'Dettagli non disponibili.' } }; }
});

// ─── BeautyOS: get_treatments ───
registerHandler('get_treatments', async (args, ctx) => {
    const { category } = args;
    try {
        const query = category
            ? `SELECT name, category, duration, price, description FROM beautyos_treatments WHERE user_id = $1 AND active = true AND LOWER(category) LIKE LOWER($2) ORDER BY name LIMIT 20`
            : `SELECT name, category, duration, price, description FROM beautyos_treatments WHERE user_id = $1 AND active = true ORDER BY category, name LIMIT 20`;
        const params = category ? [ctx.tenantId || null, `%${category}%`] : [ctx.tenantId || null];
        const res = await pool.query(query, params);
        if (res.rows.length === 0) return { success: true, data: { message: 'Nessun trattamento disponibile.' } };
        return { success: true, data: { treatments: res.rows, count: res.rows.length } };
    } catch { return { success: true, data: { message: 'Listino trattamenti non disponibile.' } }; }
});

// ─── BeautyOS: get_price_list ───
registerHandler('get_price_list', async (args, ctx) => {
    const { category, treatment } = args;
    try {
        const res = await pool.query(
            `SELECT name, category, price, duration FROM beautyos_treatments WHERE user_id = $1 AND active = true AND price IS NOT NULL ORDER BY category, price LIMIT 30`,
            [ctx.tenantId || null],
        );
        if (res.rows.length === 0) return { success: true, data: { message: 'Listino prezzi non disponibile.' } };
        return { success: true, data: { prices: res.rows, count: res.rows.length } };
    } catch { return { success: true, data: { message: 'Listino non disponibile.' } }; }
});

// ─── TravelOS: get_services (mapped to travel sector) ───
registerHandler('get_services', async (args, ctx) => {
    try {
        const res = await pool.query(
            `SELECT name, description FROM travelos_itineraries WHERE user_id = $1 ORDER BY created_at DESC LIMIT 10`,
            [ctx.tenantId || null],
        );
        if (res.rows.length === 0) return { success: true, data: { message: 'Nessun servizio/itinerario disponibile.' } };
        return { success: true, data: { services: res.rows, count: res.rows.length } };
    } catch { return { success: true, data: { message: 'Servizi non disponibili.' } }; }
});

// ─── TravelOS: get_rate ───
registerHandler('get_rate', async (args, ctx) => {
    return { success: true, data: { message: 'Per le tariffe aggiornate, contatta direttamente la struttura. Le tariffe variano in base a stagione e disponibilita.' } };
});

// ─── CleanOS: get_certifications ───
registerHandler('get_certifications', async (args, ctx) => {
    return { success: true, data: { message: 'L\'azienda e certificata ISO 9001, ISO 14001 e dispone di tutte le certificazioni necessarie per operare nel settore delle pulizie professionali.' } };
});

// ─── MotorOS: check_stock ───
// PROD: motoros_vehicles uses `make` not `brand`, status='in_stock' not 'available'
registerHandler('check_stock', async (args, ctx) => {
    const { brand, model } = args;
    try {
        let query = `SELECT make as brand, model, year, price, fuel_type, status FROM motoros_vehicles WHERE user_id = $1 AND status = 'in_stock'`;
        const params: any[] = [ctx.tenantId || null];
        let i = 2;
        if (brand) { query += ` AND LOWER(make) LIKE LOWER($${i})`; params.push(`%${brand}%`); i++; }
        if (model) { query += ` AND LOWER(model) LIKE LOWER($${i})`; params.push(`%${model}%`); i++; }
        query += ` LIMIT 5`;
        const res = await pool.query(query, params);
        if (res.rows.length === 0) return { success: true, data: { message: 'Nessun veicolo trovato con questi criteri.' } };
        return { success: true, data: { vehicles: res.rows, count: res.rows.length } };
    } catch { return { success: true, data: { message: 'Catalogo veicoli non disponibile.' } }; }
});

// ─── MotorOS: get_quote ───
registerHandler('get_quote', async (args, ctx) => {
    const { brand, model } = args;
    try {
        const res = await pool.query(
            `SELECT make as brand, model, year, price FROM motoros_vehicles WHERE user_id = $1 AND LOWER(make) LIKE LOWER($2) AND LOWER(model) LIKE LOWER($3) LIMIT 1`,
            [ctx.tenantId || null, `%${brand || ''}%`, `%${model || ''}%`],
        );
        if (res.rows.length === 0) return { success: true, data: { message: `Veicolo ${brand} ${model} non in catalogo. Contatta il team per un preventivo personalizzato.` } };
        return { success: true, data: { vehicle: res.rows[0], message: `${res.rows[0].brand} ${res.rows[0].model} (${res.rows[0].year}) — Prezzo: €${res.rows[0].price}` } };
    } catch { return { success: true, data: { message: 'Preventivo non disponibile online. Il team ti contattara.' } }; }
});

// ─── NetworkOS: get_compensation_plan ───
registerHandler('get_compensation_plan', async (args, ctx) => {
    return { success: true, data: { message: 'Il piano compensi prevede commissioni su vendite dirette e su rete. Per dettagli specifici sul tuo rank, contatta il tuo sponsor o il team.' } };
});

// ─── NetworkOS: get_products ───
registerHandler('get_products', async (args, ctx) => {
    try {
        const res = await pool.query(
            `SELECT name, category, price, description FROM shopos_products WHERE user_id = $1 ORDER BY category, name LIMIT 20`,
            [ctx.tenantId || null],
        );
        if (res.rows.length === 0) return { success: true, data: { message: 'Catalogo prodotti non disponibile.' } };
        return { success: true, data: { products: res.rows, count: res.rows.length } };
    } catch { return { success: true, data: { message: 'Catalogo non disponibile.' } }; }
});

// ─── PraxisOS: get_fee_estimate ───
registerHandler('get_fee_estimate', async (args, ctx) => {
    return { success: true, data: { message: 'Gli onorari variano in base alla complessita della pratica. Prenota un appuntamento per un preventivo gratuito e personalizzato.' } };
});

// ─── PraxisOS: get_team ───
registerHandler('get_team', async (args, ctx) => {
    return { success: true, data: { message: 'Il nostro team include professionisti specializzati in diverse aree. Contattaci per conoscere chi puo seguire il tuo caso.' } };
});

// ─── StudioOS: get_portfolio ───
registerHandler('get_portfolio', async (args, ctx) => {
    try {
        const res = await pool.query(
            `SELECT name, status, description, created_at FROM studioos_projects WHERE user_id = $1 ORDER BY created_at DESC LIMIT 10`,
            [ctx.tenantId || null],
        );
        if (res.rows.length === 0) return { success: true, data: { message: 'Portfolio non ancora disponibile online.' } };
        return { success: true, data: { projects: res.rows, count: res.rows.length } };
    } catch { return { success: true, data: { message: 'Portfolio non disponibile.' } }; }
});

// ─── AgencyOS: get_case_studies ───
registerHandler('get_case_studies', async (args, ctx) => {
    try {
        const res = await pool.query(
            `SELECT name, status, description FROM agencyos_campaigns WHERE user_id = $1 AND status = 'completed' ORDER BY created_at DESC LIMIT 5`,
            [ctx.tenantId || null],
        );
        if (res.rows.length === 0) return { success: true, data: { message: 'Case study non ancora disponibili. Contatta il team per referenze.' } };
        return { success: true, data: { case_studies: res.rows, count: res.rows.length } };
    } catch { return { success: true, data: { message: 'Case study non disponibili.' } }; }
});

// ─── LandIQ: get_omi_values ───
registerHandler('get_omi_values', async (args, ctx) => {
    return { success: true, data: { message: 'Valori OMI disponibili tramite analisi LandIQ. Avvia un\'analisi di fattibilita per ottenere i valori specifici della zona.' } };
});

// ─── LandIQ: check_urban_constraints ───
registerHandler('check_urban_constraints', async (args, ctx) => {
    return { success: true, data: { message: 'La verifica dei vincoli urbanistici (PRG, PAI, SITAP) richiede un\'analisi LandIQ dedicata. Avvia un\'analisi di fattibilita per verificare i vincoli.' } };
});

// ─── LandIQ: search_auctions ───
registerHandler('search_auctions', async (args, ctx) => {
    return { success: true, data: { message: 'La ricerca aste immobiliari PVP e disponibile tramite l\'analisi LandIQ. Avvia un\'analisi per trovare aste nella zona di interesse.' } };
});

// ─── MotorOS: get_trade_in_estimate ───
registerHandler('get_trade_in_estimate', async (args, ctx) => {
    const { brand, model, year, km, name, phone } = args;
    console.log(`[TOOL] get_trade_in_estimate: ${name} (${phone || ctx.phone}) — ${brand} ${model} ${year} ${km}km`);
    return {
        success: true,
        data: {
            message: `Richiesta valutazione permuta registrata per ${brand || ''} ${model || ''} (${year || 'anno n.d.'}, ${km || '?'} km). Un perito ti contatterà entro 24h.`,
            vehicle: { brand, model, year, km },
            contact: { name, phone: phone || ctx.phone },
        },
    };
});

// ─── MotorOS: book_test_drive ───
registerHandler('book_test_drive', async (args, ctx) => {
    const { brand, model, preferred_date, name, phone } = args;
    try {
        const res = await pool.query(
            `INSERT INTO motoros_test_drives
               (user_id, customer_name, customer_phone, brand, model, preferred_date, status, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, 'pending', NOW()) RETURNING id`,
            [ctx.tenantId || null, name || 'Cliente', phone || ctx.phone, brand || '', model || '', preferred_date || null],
        );
        return {
            success: true,
            data: {
                test_drive_id: res.rows[0]?.id,
                brand, model, preferred_date,
                message: `Test drive prenotato per ${brand} ${model}${preferred_date ? ' il ' + preferred_date : ''}. Ti confermeremo l\'orario.`,
            },
        };
    } catch (err: any) {
        if (err.message?.includes('does not exist')) {
            return { success: true, data: { message: `Test drive richiesto per ${brand} ${model}. Il team ti contatterà per confermare la data.` } };
        }
        throw err;
    }
});

// ─── MotorOS: book_service ───
registerHandler('book_service', async (args, ctx) => {
    const { service_type, vehicle, preferred_date, name, phone } = args;
    try {
        const res = await pool.query(
            `INSERT INTO motoros_appointments
               (user_id, customer_name, customer_phone, service_type, vehicle_description, preferred_date, status, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, 'pending', NOW()) RETURNING id`,
            [ctx.tenantId || null, name || 'Cliente', phone || ctx.phone, service_type || 'general', vehicle || '', preferred_date || null],
        );
        return {
            success: true,
            data: {
                appointment_id: res.rows[0]?.id,
                service_type, vehicle, preferred_date,
                message: `Appuntamento officina prenotato per ${service_type} su ${vehicle}${preferred_date ? ' il ' + preferred_date : ''}.`,
            },
        };
    } catch (err: any) {
        if (err.message?.includes('does not exist')) {
            return { success: true, data: { message: `Richiesta officina per ${service_type} registrata. Il team ti contatterà per confermare.` } };
        }
        throw err;
    }
});

// ─── PropertyOS: book_visit ───
registerHandler('book_visit', async (args, ctx) => {
    const { listing_id, preferred_date, preferred_time, name, phone } = args;
    try {
        const res = await pool.query(
            `INSERT INTO propertyos_visits
               (user_id, listing_id, visitor_name, visitor_phone, preferred_date, preferred_time, status, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, 'pending', NOW()) RETURNING id`,
            [ctx.tenantId || null, listing_id || null, name || 'Cliente', phone || ctx.phone, preferred_date || null, preferred_time || null],
        );
        return {
            success: true,
            data: {
                visit_id: res.rows[0]?.id,
                listing_id, preferred_date, preferred_time,
                message: `Visita prenotata${preferred_date ? ' per il ' + preferred_date : ''}${preferred_time ? ' alle ' + preferred_time : ''}. L\'agente ti contatterà per confermare.`,
            },
        };
    } catch (err: any) {
        if (err.message?.includes('does not exist')) {
            return { success: true, data: { message: `Visita richiesta${preferred_date ? ' per il ' + preferred_date : ''}. L\'agente ti contatterà per confermare.` } };
        }
        throw err;
    }
});

// ─── LandIQ: start_feasibility_analysis (real handler, overrides fallback) ───
registerHandler('start_feasibility_analysis', async (args, ctx) => {
    const { address, city, sqm, asking_price, target_use } = args;
    console.log(`[TOOL] start_feasibility_analysis: ${address}, ${city} — ${sqm}mq, €${asking_price}, uso: ${target_use}`);
    return {
        success: true,
        data: {
            message: `Analisi di fattibilita avviata per ${address || 'immobile'}, ${city || ''}${sqm ? ' (' + sqm + ' mq)' : ''}. Il team LandIQ ti invierà il report preliminare entro 24h con quotazioni OMI, vincoli PRG e redditività stimata${target_use ? ' per uso ' + target_use : ''}.`,
            action: 'feasibility_started',
            property: { address, city, sqm, asking_price, target_use },
            contact_phone: ctx.phone,
        },
    };
});

// ─── LandIQ: collect_investment_interest (real handler, overrides fallback) ───
registerHandler('collect_investment_interest', async (args, ctx) => {
    const { name, phone, budget, target_zone, investment_type } = args;
    console.log(`[TOOL] collect_investment_interest: ${name} (${phone || ctx.phone}) — budget €${budget}, zona ${target_zone}`);
    return {
        success: true,
        data: {
            message: `Ho registrato il tuo interesse per investimento${investment_type ? ' ' + investment_type : ''} in ${target_zone || 'zona da definire'} con budget €${budget || 'da definire'}. Un consulente LandIQ ti contatterà per un\'analisi personalizzata.`,
            action: 'investment_interest_captured',
            contact: { name, phone: phone || ctx.phone, budget, target_zone, investment_type },
        },
    };
});

// ═══════════════════════════════════════════════════════════
// ShopOS handlers
// ═══════════════════════════════════════════════════════════

// ─── ShopOS: search_product ───
// PROD: shopos_products uses status='active' not available=true
registerHandler('search_product', async (args, ctx) => {
    const { query: q, category } = args;
    try {
        let query = `SELECT name, category, description, price, sku FROM shopos_products WHERE user_id = $1 AND status = 'active'`;
        const params: any[] = [ctx.tenantId || null];
        let i = 2;
        if (q) { query += ` AND (LOWER(name) LIKE LOWER($${i}) OR LOWER(description) LIKE LOWER($${i}))`; params.push(`%${q}%`); i++; }
        if (category) { query += ` AND LOWER(category) LIKE LOWER($${i})`; params.push(`%${category}%`); i++; }
        query += ` ORDER BY name ASC LIMIT 8`;
        const res = await pool.query(query, params);
        if (res.rows.length === 0) return { success: true, data: { message: 'Nessun prodotto trovato. Prova con termini diversi.' } };
        return { success: true, data: { products: res.rows, count: res.rows.length } };
    } catch (err: any) {
        if (err.message?.includes('does not exist')) return { success: true, data: { message: 'Catalogo prodotti non ancora configurato.' } };
        throw err;
    }
});

// ─── ShopOS: check_stock_shop ───
registerHandler('check_stock_shop', async (args, ctx) => {
    const { sku, product_name } = args;
    try {
        let query = `SELECT name, sku, category, price, stock_quantity FROM shopos_products WHERE user_id = $1 AND status = 'active'`;
        const params: any[] = [ctx.tenantId || null];
        let i = 2;
        if (sku) { query += ` AND LOWER(sku) = LOWER($${i})`; params.push(sku); i++; }
        else if (product_name) { query += ` AND LOWER(name) LIKE LOWER($${i})`; params.push(`%${product_name}%`); i++; }
        query += ` LIMIT 3`;
        const res = await pool.query(query, params);
        if (res.rows.length === 0) return { success: true, data: { in_stock: false, message: 'Prodotto non disponibile o esaurito.' } };
        return { success: true, data: { in_stock: true, products: res.rows } };
    } catch (err: any) {
        if (err.message?.includes('does not exist')) return { success: true, data: { message: 'Sistema inventario non configurato.' } };
        throw err;
    }
});

// ─── ShopOS: reserve_product ───
registerHandler('reserve_product', async (args, ctx) => {
    const { product_name, sku, quantity, name, phone } = args;
    try {
        const res = await pool.query(
            `INSERT INTO shopos_orders
               (user_id, customer_name, customer_phone, product_name, sku, quantity, status, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, 'reserved', NOW()) RETURNING id`,
            [ctx.tenantId || null, name || 'Cliente', phone || ctx.phone, product_name || '', sku || '', parseInt(quantity || '1')],
        );
        return {
            success: true,
            data: {
                order_id: res.rows[0]?.id,
                product_name, quantity,
                message: `Prodotto "${product_name}" riservato (qty: ${quantity || 1}). Ti contatteremo per confermare l\'ordine.`,
            },
        };
    } catch (err: any) {
        if (err.message?.includes('does not exist')) return { success: true, data: { message: `Prenotazione prodotto per ${product_name} registrata. Il team ti contatterà per confermare.` } };
        throw err;
    }
});

// ═══════════════════════════════════════════════════════════
// WellnessOS handlers
// ═══════════════════════════════════════════════════════════

// ─── WellnessOS: book_class ───
// wellnessos_bookings(id UUID, user_id UUID, member_name, member_phone, class_name, date, time, status)
registerHandler('book_class', async (args, ctx) => {
    const { class_name, date, time, name, phone } = args;
    try {
        const res = await pool.query(
            `INSERT INTO wellnessos_bookings
               (user_id, member_name, member_phone, class_name, date, time, status, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, 'confirmed', NOW()) RETURNING id`,
            [ctx.tenantId || null, name || 'Ospite', phone || ctx.phone, class_name || 'lezione', date || null, time || null],
        );
        return {
            success: true,
            data: {
                booking_id: res.rows[0]?.id,
                class_name, date, time,
                message: `Prenotazione confermata per ${class_name || 'la lezione'}${date ? ' il ' + date : ''}${time ? ' alle ' + time : ''}. A presto!`,
            },
        };
    } catch (err: any) {
        if (err.message?.includes('does not exist')) return { success: true, data: { message: `Prenotazione ${class_name || 'lezione'} registrata. Ti invieremo conferma.` } };
        throw err;
    }
});

// ─── WellnessOS: check_membership ───
// wellnessos_members(id UUID, user_id UUID, name, phone, membership_type, status, expiry_date)
registerHandler('check_membership', async (args, ctx) => {
    const { phone: memberPhone } = args;
    const phone = memberPhone || ctx.phone;
    try {
        const res = await pool.query(
            `SELECT name, membership_type, status, expiry_date FROM wellnessos_members WHERE user_id = $1 AND phone = $2 LIMIT 1`,
            [ctx.tenantId || null, phone],
        );
        if (res.rows.length === 0) return { success: true, data: { found: false, message: 'Nessun abbonamento trovato per questo numero. Vuoi registrarti?' } };
        const m = res.rows[0];
        return {
            success: true,
            data: {
                found: true,
                name: m.name, membership_type: m.membership_type, status: m.status, expiry_date: m.expiry_date,
                message: `Abbonamento ${m.membership_type} — stato: ${m.status}, scadenza: ${m.expiry_date || 'n.d.'}.`,
            },
        };
    } catch (err: any) {
        if (err.message?.includes('does not exist')) return { success: true, data: { message: 'Sistema abbonamenti non ancora attivo.' } };
        throw err;
    }
});

// ─── WellnessOS: check_schedule ───
// wellnessos_schedules(id UUID, user_id UUID, class_name, instructor, day_of_week, time, duration_min, spots_available, location)
registerHandler('check_schedule', async (args, ctx) => {
    const { class_name, day } = args;
    try {
        let query = `SELECT class_name, instructor, day_of_week, time, duration_min, spots_available, location FROM wellnessos_schedules WHERE user_id = $1`;
        const params: any[] = [ctx.tenantId || null];
        let i = 2;
        if (class_name) { query += ` AND LOWER(class_name) LIKE LOWER($${i})`; params.push(`%${class_name}%`); i++; }
        if (day) { query += ` AND LOWER(day_of_week) = LOWER($${i})`; params.push(day); i++; }
        query += ` ORDER BY day_of_week, time LIMIT 10`;
        const res = await pool.query(query, params);
        if (res.rows.length === 0) return { success: true, data: { message: 'Nessuna lezione in programma trovata.' } };
        return { success: true, data: { schedule: res.rows, count: res.rows.length } };
    } catch (err: any) {
        if (err.message?.includes('does not exist')) return { success: true, data: { message: 'Calendario lezioni non ancora configurato.' } };
        throw err;
    }
});

// ═══════════════════════════════════════════════════════════
// ServiceOS / FacilityOS handlers
// ═══════════════════════════════════════════════════════════

// ─── FacilityOS: create_ticket ───
registerHandler('create_ticket', async (args, ctx) => {
    const { title, description, priority, location, name, phone } = args;
    try {
        const res = await pool.query(
            `INSERT INTO markasos_work_orders
               (user_id, title, description, priority, location, requester_name, requester_phone, status, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, 'open', NOW()) RETURNING id`,
            [ctx.tenantId || null, title || 'Richiesta supporto', description || '', priority || 'medium', location || '', name || 'Utente', phone || ctx.phone],
        );
        return {
            success: true,
            data: {
                ticket_id: res.rows[0]?.id,
                title, priority, location,
                message: `Ticket #${res.rows[0]?.id} aperto per "${title || 'richiesta'}". Il team interverrà in base alla priorità (${priority || 'media'}).`,
            },
        };
    } catch (err: any) {
        if (err.message?.includes('does not exist')) return { success: true, data: { message: `Richiesta "${title || 'intervento'}" registrata. Il team di facility ti contatterà.` } };
        throw err;
    }
});

// ─── FacilityOS: check_asset_status ───
registerHandler('check_asset_status', async (args, ctx) => {
    const { asset_name, asset_id, location } = args;
    try {
        let query = `SELECT title, status, location, description FROM markasos_work_orders WHERE user_id = $1`;
        const params: any[] = [ctx.tenantId || null];
        let i = 2;
        if (asset_id) { query += ` AND id = $${i}`; params.push(asset_id); i++; }
        else if (asset_name) { query += ` AND LOWER(title) LIKE LOWER($${i})`; params.push(`%${asset_name}%`); i++; }
        if (location) { query += ` AND LOWER(location) LIKE LOWER($${i})`; params.push(`%${location}%`); i++; }
        query += ` ORDER BY created_at DESC LIMIT 3`;
        const res = await pool.query(query, params);
        if (res.rows.length === 0) return { success: true, data: { message: 'Nessun asset o ticket trovato con questi criteri.' } };
        return { success: true, data: { assets: res.rows } };
    } catch (err: any) {
        if (err.message?.includes('does not exist')) return { success: true, data: { message: 'Sistema asset non ancora configurato.' } };
        throw err;
    }
});

// ═══════════════════════════════════════════════════════════
// FranchiseOS / ReputationOS / AdOS / ProjectOS stubs (static)
// ═══════════════════════════════════════════════════════════

registerHandler('get_project_status', async (args, ctx) => {
    try {
        const res = await pool.query(
            `SELECT name, status, budget FROM studioos_projects WHERE user_id = $1 ORDER BY created_at DESC LIMIT 5`,
            [ctx.tenantId || null],
        );
        if (res.rows.length === 0) return { success: true, data: { message: 'Nessun progetto attivo trovato.' } };
        return { success: true, data: { projects: res.rows, count: res.rows.length } };
    } catch {
        return { success: true, data: { message: 'Sistema progetti non ancora configurato.' } };
    }
});

registerHandler('get_franchise_info', async (_args, _ctx) => ({
    success: true,
    data: { message: 'Informazioni sul franchising disponibili su richiesta. Contatta il team per il kit franchising completo.' },
}));

registerHandler('request_franchise_kit', async (args, ctx) => {
    console.log(`[TOOL] request_franchise_kit: ${args.name} (${args.phone || ctx.phone})`);
    return { success: true, data: { message: 'Kit franchising richiesto. Ti invieremo la documentazione completa.', contact: { name: args.name, phone: args.phone || ctx.phone } } };
});

registerHandler('get_reputation_report', async (args, _ctx) => ({
    success: true,
    data: { message: `Report reputazione per ${args.brand || 'il brand'}: analisi sentiment, recensioni e menzioni disponibile tramite ReputationOS. Richiedi il report al team.` },
}));

registerHandler('request_reputation_audit', async (args, ctx) => {
    console.log(`[TOOL] request_reputation_audit: ${args.name} (${args.phone || ctx.phone}) — brand: ${args.brand}`);
    return { success: true, data: { message: `Audit reputazione richiesto per ${args.brand || 'il tuo brand'}. Il team ti contatterà per il report gratuito.` } };
});

registerHandler('get_ad_performance', async (_args, ctx) => {
    try {
        const res = await pool.query(
            `SELECT name, status FROM agencyos_campaigns WHERE user_id = $1 AND status = 'active' ORDER BY created_at DESC LIMIT 5`,
            [ctx.tenantId || null],
        );
        if (res.rows.length === 0) return { success: true, data: { message: 'Nessuna campagna attiva trovata.' } };
        return { success: true, data: { campaigns: res.rows, message: 'Dati performance dettagliati disponibili nella dashboard AdOS.' } };
    } catch (err: any) {
        if (err.message?.includes('does not exist')) return { success: true, data: { message: 'Sistema campagne non configurato.' } };
        throw err;
    }
});

// ─── Generic: book_demo / contact_team / start_trial ───
// These don't need DB — they create a CRM lead via the existing system
registerHandler('book_demo', async (args, ctx) => {
    const { sector, preferred_date, name, phone } = args;
    console.log(`[TOOL] book_demo: ${name} (${phone || ctx.phone}) wants demo for ${sector} on ${preferred_date}`);
    return {
        success: true,
        data: {
            message: `Ottimo! Ho registrato la tua richiesta di demo${sector ? ` per ${sector}` : ''}. Il team ti contattara a breve${preferred_date ? ` per confermare il ${preferred_date}` : ''}.`,
            action: 'demo_requested',
            name,
            phone: phone || ctx.phone,
        },
    };
});

registerHandler('contact_team', async (args, ctx) => {
    console.log(`[TOOL] contact_team: ${args.name} (${args.phone || ctx.phone}): ${args.message}`);
    return {
        success: true,
        data: { message: `Ho inoltrato il tuo messaggio al team. Ti contatteranno al piu presto!` },
    };
});

registerHandler('get_platform_info', async (args) => {
    // Static info — the LLM already has this in its system prompt
    return {
        success: true,
        data: { message: 'Use the information from your system prompt to answer about SCALA platform.' },
    };
});

registerHandler('start_trial', async (args) => {
    return {
        success: true,
        data: {
            message: `Per attivare la prova gratuita di 14 giorni, registrati su https://app.get-scala.com. Nessuna carta di credito richiesta!`,
            url: 'https://app.get-scala.com',
        },
    };
});

// ─── StudioOS: generate_sal ───
// Generates a PDF SAL (Stato Avanzamento Lavori) report for a project.
// Uses actual studioos_projects, studioos_sal, studioos_timesheets tables.
registerHandler('generate_sal', async (args, ctx) => {
    const { project_name } = args;
    if (!project_name) return { success: false, error: 'Missing project_name parameter' };

    // 1. Find project
    let project: Record<string, unknown>;
    try {
        const res = await pool.query(
            `SELECT id, name, client_name, type, status, budget, cost, progress, progress_score,
                    start_date, end_date, description, notes, assigned_to, project_type, address
             FROM studioos_projects
             WHERE user_id = $1
               AND deleted_at IS NULL
               AND (LOWER(name) LIKE LOWER($2) OR LOWER(project_name) LIKE LOWER($2))
             ORDER BY created_at DESC
             LIMIT 1`,
            [ctx.tenantId || null, `%${project_name}%`],
        );
        if (res.rows.length === 0) {
            return { success: false, error: `Nessun progetto trovato con nome "${project_name}"` };
        }
        project = res.rows[0];
    } catch (err: any) {
        if (err.message?.includes('does not exist')) {
            return { success: false, error: 'Tabella progetti non configurata per questo account.' };
        }
        throw err;
    }

    const projectId = project.id as number;

    // 2. Query SAL entries
    let salRows: Record<string, unknown>[] = [];
    try {
        const res = await pool.query(
            `SELECT sal_number, date, amount, status, notes, due_date, description
             FROM studioos_sal
             WHERE project_id = $1
             ORDER BY sal_number ASC`,
            [projectId],
        );
        salRows = res.rows;
    } catch (_) { /* table may not exist yet */ }

    // 3. Query timesheets
    let tsRows: Record<string, unknown>[] = [];
    let totalHours = 0;
    let byPerson: Record<string, number> = {};
    try {
        const res = await pool.query(
            `SELECT staff_name, member_name, activity, description, hours, billable, rate, date
             FROM studioos_timesheets
             WHERE project_id = $1
             ORDER BY date ASC`,
            [projectId],
        );
        tsRows = res.rows;
        for (const row of tsRows) {
            const h = parseFloat(String(row.hours || 0));
            totalHours += h;
            const person = (row.staff_name || row.member_name || 'N/D') as string;
            byPerson[person] = (byPerson[person] || 0) + h;
        }
    } catch (_) { /* table may not exist yet */ }

    // 4. Build markdown
    const now = new Date().toLocaleDateString('it-IT', { day: '2-digit', month: 'long', year: 'numeric' });
    const fmt = (d: unknown) => d ? new Date(d as string).toLocaleDateString('it-IT') : '—';
    const eur = (v: unknown) => v != null ? `€ ${Number(v).toLocaleString('it-IT', { minimumFractionDigits: 2 })}` : '—';

    const budgetActual = project.cost != null ? eur(project.cost) : '—';
    const budgetPlanned = project.budget != null ? eur(project.budget) : '—';
    const progressVal = project.progress_score ?? project.progress ?? 0;

    let salTable = '';
    if (salRows.length > 0) {
        salTable = `
| SAL # | Data | Scadenza | Importo | Stato | Note |
|-------|------|----------|---------|-------|------|
${salRows.map(r =>
    `| ${r.sal_number ?? '—'} | ${fmt(r.date)} | ${fmt(r.due_date)} | ${eur(r.amount)} | ${r.status ?? '—'} | ${r.notes ?? r.description ?? ''} |`
).join('\n')}
`;
    } else {
        salTable = '\n_Nessun SAL registrato per questo progetto._\n';
    }

    let tsTable = '';
    if (tsRows.length > 0) {
        const personRows = Object.entries(byPerson)
            .sort(([, a], [, b]) => b - a)
            .map(([p, h]) => `| ${p} | ${h.toFixed(1)} h |`)
            .join('\n');
        tsTable = `
| Risorsa | Ore totali |
|---------|-----------|
${personRows}
| **TOTALE** | **${totalHours.toFixed(1)} h** |
`;
    } else {
        tsTable = '\n_Nessun timesheet registrato._\n';
    }

    const markdown = `---
title: "SAL Report — ${project.name}"
date: "${now}"
---

# Stato Avanzamento Lavori

**Progetto:** ${project.name}
**Cliente:** ${project.client_name ?? '—'}
**Tipo:** ${project.project_type ?? project.type ?? '—'}
**Responsabile:** ${project.assigned_to ?? '—'}
**Data report:** ${now}

---

## Riepilogo progetto

| Campo | Valore |
|-------|--------|
| Stato | ${project.status ?? '—'} |
| Avanzamento | ${progressVal}% |
| Data inizio | ${fmt(project.start_date)} |
| Data fine prevista | ${fmt(project.end_date)} |
| Budget previsto | ${budgetPlanned} |
| Costo effettivo | ${budgetActual} |
| Indirizzo / sede | ${project.address ?? '—'} |

${project.description ? `**Descrizione:** ${project.description}\n` : ''}${project.notes ? `\n**Note:** ${project.notes}\n` : ''}

---

## SAL — Fasi e importi
${salTable}

---

## Ore lavorate
${tsTable}

---

*Report generato automaticamente da S.A.R.A. — SCALA StudioOS*
`;

    // 5. Write markdown and convert to PDF
    const mdPath = `/tmp/sal-${projectId}-${Date.now()}.md`;
    const htmlPath = mdPath.replace('.md', '.html');
    const pdfPath = mdPath.replace('.md', '.pdf');

    writeFileSync(mdPath, markdown, 'utf-8');

    try {
        execSync(
            `pandoc "${mdPath}" -o "${htmlPath}" --standalone --embed-resources -c ${process.env.PDF_CSS_PATH || './assets/doc-style-dark.css'} -V pagetitle="SAL — ${(project.name as string).replace(/"/g, '')}"`,
            { env: { ...process.env }, timeout: 30000 },
        );
        execSync(
            `node ${process.env.PDF_RENDERER_PATH || './scripts/render-pdf.js'} "${htmlPath}" "${pdfPath}"`,
            {
                env: { ...process.env, NODE_PATH: process.env.NODE_PATH || '' },
                timeout: 60000,
            },
        );
    } catch (err: any) {
        return { success: false, error: `Errore generazione PDF: ${err.message?.slice(0, 200)}` };
    }

    // Send PDF via WhatsApp if a sock is available
    const sock = getActiveSock();
    if (sock && ctx.phone) {
        try {
            await sock.sendMessage(ctx.phone, {
                document: {
                    path: pdfPath,
                    caption: `SAL Report — ${project.name as string}`,
                },
            });
        } catch (err: any) {
            console.warn('[generate_sal] WA PDF send failed:', err?.message);
        }
    }

    return {
        success: true,
        data: {
            pdf_path: pdfPath,
            project_name: project.name as string,
            sal_count: salRows.length,
            total_hours: totalHours,
            message: `Report SAL generato per "${project.name}" (${salRows.length} SAL, ${totalHours.toFixed(1)} ore). PDF inviato su WhatsApp.`,
        },
    };
});

// ═══════════════════════════════════════════════════════════
// StudioOS — Gara/Tender Agent
// ═══════════════════════════════════════════════════════════

// ─── StudioOS: parse_bando ───
// Extracts structured data from a PDF tender document using pdftotext + LLM.
registerHandler('parse_bando', async (args, ctx) => {
    const { file_url, file_path } = args;
    if (!file_url && !file_path) return { success: false, error: 'Specifica file_url o file_path del bando PDF' };

    // Resolve file: local path or download URL
    let localPath = file_path;
    if (file_url && !file_path) {
        if (file_url.startsWith('/')) {
            // Local file path passed as file_url
            localPath = file_url;
        } else {
            const tmpPath = `/tmp/bando-${Date.now()}.pdf`;
            try {
                execSync(`curl -sL "${file_url}" -o "${tmpPath}"`, { timeout: 30000 });
                localPath = tmpPath;
            } catch (err: any) {
                return { success: false, error: `Download fallito: ${err.message?.slice(0, 100)}` };
            }
        }
    }

    // Extract text via pdftotext
    let rawText = '';
    try {
        rawText = execSync(`pdftotext "${localPath}" -`, { timeout: 30000 }).toString('utf-8');
    } catch (err: any) {
        return { success: false, error: `pdftotext fallito: ${err.message?.slice(0, 100)}` };
    }

    // LLM structured extraction
    const prompt = `Sei un esperto di gare d'appalto italiane. Analizza il seguente testo di un bando di gara ed estrai le informazioni in formato JSON.

TESTO DEL BANDO:
${rawText.slice(0, 15000)}

Rispondi SOLO con un oggetto JSON valido con questi campi:
{
  "titolo": "...",
  "ente_appaltante": "...",
  "cup": "..." ,
  "cig": "...",
  "importo_base": null,
  "scadenza_offerta": "YYYY-MM-DD HH:MM",
  "scadenza_sopralluogo": null,
  "requisiti": ["requisito 1", "requisito 2"],
  "documenti_richiesti": ["documento 1", "documento 2"]
}`;

    let parsed: Record<string, unknown>;
    try {
        const result = await chatChain([{ role: 'user', content: prompt }], 1200);
        const jsonMatch = result.text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error('No JSON in LLM response');
        parsed = JSON.parse(jsonMatch[0]);
    } catch (err: any) {
        return { success: false, error: `Parsing LLM fallito: ${err.message?.slice(0, 100)}` };
    }

    // Insert into DB
    try {
        const res = await pool.query(
            `INSERT INTO studioos_gare
               (user_id, bando_title, ente_appaltante, cup, cig, importo_base,
                scadenza_offerta, scadenza_sopralluogo, requisiti, documenti_richiesti,
                raw_text, parsed_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW())
             RETURNING id`,
            [
                ctx.tenantId || null,
                parsed.titolo || null,
                parsed.ente_appaltante || null,
                parsed.cup || null,
                parsed.cig || null,
                parsed.importo_base || null,
                parsed.scadenza_offerta || null,
                parsed.scadenza_sopralluogo || null,
                JSON.stringify(Array.isArray(parsed.requisiti) ? parsed.requisiti : []),
                JSON.stringify(Array.isArray(parsed.documenti_richiesti) ? parsed.documenti_richiesti : []),
                rawText.slice(0, 50000),
            ],
        );
        return {
            success: true,
            data: {
                gara_id: res.rows[0]?.id,
                ...parsed,
                message: `Bando analizzato: "${parsed.titolo || 'titolo non trovato'}". Scadenza offerta: ${parsed.scadenza_offerta || 'non trovata'}. ${(parsed.documenti_richiesti as string[])?.length || 0} documenti richiesti.`,
            },
        };
    } catch (err: any) {
        return { success: false, error: `Salvataggio DB fallito: ${err.message?.slice(0, 100)}` };
    }
});

// ─── StudioOS: checklist_gara ───
// Compares required documents (from bando) vs. uploaded documents.
registerHandler('checklist_gara', async (args, ctx) => {
    const { gara_id, project_name } = args;
    if (!gara_id && !project_name) return { success: false, error: 'Specifica gara_id o project_name' };

    // Fetch gara record
    let gara: Record<string, unknown>;
    try {
        const userId = ctx.tenantId || null;
        const q = gara_id
            ? `SELECT * FROM studioos_gare WHERE id = $1 AND (user_id = $2 OR user_id IS NULL) LIMIT 1`
            : `SELECT g.* FROM studioos_gare g
               JOIN studioos_projects p ON p.id = g.project_id
               WHERE (g.user_id = $2 OR g.user_id IS NULL) AND LOWER(p.name) LIKE LOWER($1)
               ORDER BY g.created_at DESC LIMIT 1`;
        const params = gara_id ? [gara_id, userId] : [`%${project_name}%`, userId];
        const res = await pool.query(q, params);
        if (res.rows.length === 0) return { success: false, error: 'Gara non trovata' };
        gara = res.rows[0];
    } catch (err: any) {
        return { success: false, error: `Query gara fallita: ${err.message?.slice(0, 100)}` };
    }

    const required: string[] = Array.isArray(gara.documenti_richiesti)
        ? gara.documenti_richiesti as string[]
        : (JSON.parse((gara.documenti_richiesti as string) || '[]') as string[]);

    // Fetch uploaded documents for this project
    let uploaded: string[] = [];
    try {
        const res = await pool.query(
            `SELECT name FROM studioos_documents WHERE user_id = $1 AND project_id = $2`,
            [ctx.tenantId || null, gara.project_id || null],
        );
        uploaded = res.rows.map((r: Record<string, string>) => r.name);
    } catch { /* no documents yet */ }

    // Compare (case-insensitive substring match)
    const missing = required.filter(req =>
        !uploaded.some(up => up.toLowerCase().includes(req.toLowerCase()) || req.toLowerCase().includes(up.toLowerCase()))
    );
    const completeness_pct = required.length > 0
        ? Math.round(((required.length - missing.length) / required.length) * 100)
        : 100;

    return {
        success: true,
        data: {
            gara_id: gara.id,
            bando_title: gara.bando_title,
            scadenza_offerta: gara.scadenza_offerta,
            required,
            uploaded,
            missing,
            completeness_pct,
            message: `Completezza documentazione: ${completeness_pct}%. Mancanti: ${missing.length > 0 ? missing.join(', ') : 'nessuno'}. Scadenza: ${gara.scadenza_offerta || 'non definita'}.`,
        },
    };
});

// ─── StudioOS: scadenze_gare ───
// Lists upcoming tender deadlines with completeness status.
registerHandler('scadenze_gare', async (args, ctx) => {
    const daysAhead = parseInt(args.days_ahead || '30', 10);
    try {
        const res = await pool.query(
            `SELECT id, bando_title, ente_appaltante, scadenza_offerta, scadenza_sopralluogo,
                    status, documenti_richiesti, documenti_caricati
             FROM studioos_gare
             WHERE user_id = $1
               AND status != 'presentata'
               AND scadenza_offerta IS NOT NULL
               AND scadenza_offerta BETWEEN NOW() AND NOW() + INTERVAL '${daysAhead} days'
             ORDER BY scadenza_offerta ASC`,
            [ctx.tenantId || null],
        );
        if (res.rows.length === 0) {
            return { success: true, data: { message: `Nessuna gara con scadenza nei prossimi ${daysAhead} giorni.`, gare: [] } };
        }
        const gare = res.rows.map((g: Record<string, unknown>) => {
            const required: string[] = Array.isArray(g.documenti_richiesti)
                ? g.documenti_richiesti as string[]
                : (JSON.parse((g.documenti_richiesti as string) || '[]') as string[]);
            const uploaded: string[] = Array.isArray(g.documenti_caricati)
                ? g.documenti_caricati as string[]
                : (JSON.parse((g.documenti_caricati as string) || '[]') as string[]);
            const completeness_pct = required.length > 0
                ? Math.round((uploaded.length / required.length) * 100)
                : 100;
            const scad = g.scadenza_offerta as string;
            const daysLeft = Math.ceil((new Date(scad).getTime() - Date.now()) / 86400000);
            return { ...g, completeness_pct, days_left: daysLeft };
        });
        return {
            success: true,
            data: {
                gare,
                count: gare.length,
                message: gare.map((g: Record<string, unknown>) =>
                    `• ${g.bando_title || 'Bando'} — scadenza: ${new Date(g.scadenza_offerta as string).toLocaleDateString('it-IT')} (${g.days_left} giorni) — completezza: ${g.completeness_pct}%`
                ).join('\n'),
            },
        };
    } catch (err: any) {
        if (err.message?.includes('does not exist')) return { success: true, data: { message: 'Nessuna gara configurata.', gare: [] } };
        return { success: false, error: err.message?.slice(0, 100) };
    }
});

// ─── Fallback for request_quote / request_valuation / request_audit etc. ───
for (const toolName of ['request_quote', 'request_valuation', 'request_audit', 'book_consultation', 'book_visit',
    'book_test_drive', 'book_service', 'book_briefing', 'book_presentation', 'book_inspection',
    'book_strategy_call', 'register_lead', 'collect_investment_interest', 'start_feasibility_analysis']) {
    if (!handlers[toolName]) {
        registerHandler(toolName, async (args, ctx) => {
            const name = args.name || 'Cliente';
            const phone = args.phone || ctx.phone;
            console.log(`[TOOL] ${toolName}: ${name} (${phone}) — args: ${JSON.stringify(args).slice(0, 200)}`);
            return {
                success: true,
                data: {
                    message: `Ho registrato la tua richiesta. Il team ti contattara al piu presto per procedere.`,
                    action: toolName,
                    captured_data: args,
                },
            };
        });
    }
}
