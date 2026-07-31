// ═══════════════════════════════════════════════════
// SARA Voice-to-CRM Handler
// Parses voice transcriptions into CRM commands and executes them.
// Supports: create/update/search contacts, bookings, pipeline/deal queries.
// ═══════════════════════════════════════════════════

import { pool } from '../config.js';
import { chatChain, type ChatMsg } from '../lib/ai-providers.js';
import { getAdminUserId } from '../crm-sync.js';
import pino from 'pino';

const log = pino({ name: 'voice-crm', level: 'info' });

// ─── Types ───

export interface VoiceCRMCommand {
    intent:
        | 'create_contact'
        | 'update_contact'
        | 'search_contact'
        | 'create_booking'
        | 'query_pipeline'
        | 'query_deal'
        | 'general';
    entities: {
        name?: string;
        phone?: string;
        email?: string;
        company?: string;
        date?: string;
        time?: string;
        deal_name?: string;
        notes?: string;
    };
    confidence: number;
}

// ─── Intent Detection via LLM ───

const INTENT_PROMPT = `Sei un classificatore di comandi CRM. L'utente ha inviato un comando vocale via WhatsApp.
Classifica l'intento ed estrai le entità.

Trascrizione: "{TEXT}"

Rispondi SOLO con JSON valido, niente altro:
{
  "intent": "create_contact" | "update_contact" | "search_contact" | "create_booking" | "query_pipeline" | "query_deal" | "general",
  "entities": {
    "name": "nome della persona (null se non presente)",
    "phone": "numero di telefono (null se non presente)",
    "email": "email (null se non presente)",
    "company": "nome azienda (null se non presente)",
    "date": "data in formato YYYY-MM-DD (null se non presente)",
    "time": "orario in formato HH:MM (null se non presente)",
    "deal_name": "nome del deal/affare (null se non presente)",
    "notes": "note aggiuntive (null se non presenti)"
  },
  "confidence": 0.0-1.0
}

Regole:
- "create_contact": l'utente vuole AGGIUNGERE un nuovo contatto al CRM
- "update_contact": l'utente vuole AGGIORNARE un contatto esistente
- "search_contact": l'utente vuole CERCARE un contatto
- "create_booking": l'utente vuole PROGRAMMARE un appuntamento/riunione
- "query_pipeline": l'utente chiede il VALORE TOTALE della pipeline o delle trattative aperte
- "query_deal": l'utente chiede informazioni su un DEAL/TRATTATIVA specifico
- "general": qualsiasi altra cosa (domanda generica, chiacchierata, ecc.)
- Classifica come CRM command SOLO se la confidence > 0.7
- Se la data è relativa (domani, martedì, ecc.), convertila in data assoluta basandoti sulla data odierna
- Per numeri di telefono italiani, normalizza con prefisso +39 se mancante`;

/**
 * Parse a voice transcription into a structured CRM command using LLM.
 * Returns intent=general with low confidence if the text is not a CRM command.
 */
export async function parseVoiceCRMCommand(transcription: string): Promise<VoiceCRMCommand> {
    const fallback: VoiceCRMCommand = {
        intent: 'general',
        entities: {},
        confidence: 0,
    };

    if (!transcription || transcription.trim().length < 5) {
        return fallback;
    }

    try {
        // Inject today's date so the LLM can resolve relative dates
        const today = new Date().toISOString().slice(0, 10);
        const dayNames = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'];
        const todayName = dayNames[new Date().getDay()];

        const prompt = INTENT_PROMPT.replace('{TEXT}', transcription.substring(0, 500));

        const messages: ChatMsg[] = [
            {
                role: 'system',
                content: `Sei un motore di classificazione CRM. Oggi è ${todayName} ${today}. Rispondi SOLO con JSON valido.`,
            },
            { role: 'user', content: prompt },
        ];

        const result = await chatChain(messages, 300);
        const jsonMatch = result.text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            log.warn({ text: transcription.substring(0, 80) }, 'no JSON in LLM response for voice-crm');
            return fallback;
        }

        const parsed = JSON.parse(jsonMatch[0]);

        // Validate intent
        const validIntents = [
            'create_contact', 'update_contact', 'search_contact',
            'create_booking', 'query_pipeline', 'query_deal', 'general',
        ];
        const intent = validIntents.includes(parsed.intent) ? parsed.intent : 'general';

        // Sanitize confidence
        const confidence = typeof parsed.confidence === 'number'
            ? Math.min(1, Math.max(0, parsed.confidence))
            : 0;

        // Clean entities — strip nulls and "null" strings
        const rawEntities = parsed.entities || {};
        const entities: VoiceCRMCommand['entities'] = {};
        for (const [key, val] of Object.entries(rawEntities)) {
            if (val && val !== 'null' && typeof val === 'string' && val.trim().length > 0) {
                (entities as any)[key] = val.trim();
            }
        }

        return { intent, entities, confidence };
    } catch (err: any) {
        log.error({ err: err.message }, 'parseVoiceCRMCommand failed');
        return fallback;
    }
}

// ─── CRM Command Execution ───

/**
 * Execute a parsed CRM command against the database.
 * Returns a human-readable Italian confirmation message.
 */
export async function executeVoiceCRMCommand(
    command: VoiceCRMCommand,
    phone: string,
    ownerUserId?: string
): Promise<string> {
    const userId = ownerUserId || (await getAdminUserId());
    if (!userId) {
        log.error('no admin user_id available for voice-crm');
        return 'Non riesco ad eseguire il comando CRM — configurazione utente mancante.';
    }

    try {
        switch (command.intent) {
            case 'create_contact':
                return await createContact(command.entities, userId);
            case 'update_contact':
                return await updateContact(command.entities, userId);
            case 'search_contact':
                return await searchContact(command.entities, userId);
            case 'create_booking':
                return await createBooking(command.entities, userId);
            case 'query_pipeline':
                return await queryPipeline(userId);
            case 'query_deal':
                return await queryDeal(command.entities, userId);
            default:
                return '';
        }
    } catch (err: any) {
        log.error({ err: err.message, intent: command.intent }, 'executeVoiceCRMCommand failed');
        return `Mi dispiace, si è verificato un errore nell'esecuzione del comando. Riprova tra poco.`;
    }
}

// ─── Individual command implementations ───

async function createContact(
    entities: VoiceCRMCommand['entities'],
    userId: string
): Promise<string> {
    if (!entities.name) {
        return 'Per creare un contatto ho bisogno almeno del nome. Puoi ripetere?';
    }

    // Normalize phone: add +39 if it looks Italian and has no prefix
    let contactPhone = entities.phone || null;
    if (contactPhone) {
        contactPhone = contactPhone.replace(/[\s\-().]/g, '');
        if (/^\d{9,10}$/.test(contactPhone)) {
            contactPhone = '+39' + contactPhone;
        }
    }

    const r = await pool.query(
        `INSERT INTO crm_contacts (
            user_id, name, phone, email, company, lead_score,
            status, source, tags, notes, created_at, updated_at
        ) VALUES (
            $1::uuid, $2, $3, $4, $5, 10,
            'lead', 'voice_command', ARRAY['voice_created']::text[],
            $6, NOW(), NOW()
        )
        ON CONFLICT (user_id, phone) WHERE phone IS NOT NULL
        DO UPDATE SET
            name = COALESCE(NULLIF(EXCLUDED.name, ''), crm_contacts.name),
            company = COALESCE(NULLIF(EXCLUDED.company, ''), crm_contacts.company),
            email = COALESCE(NULLIF(EXCLUDED.email, ''), crm_contacts.email),
            updated_at = NOW()
        RETURNING id, name`,
        [
            userId,
            entities.name,
            contactPhone,
            entities.email || null,
            entities.company || null,
            entities.notes || null,
        ]
    );

    const row = r.rows[0];
    const parts = [`Contatto "${row.name}" creato nel CRM`];
    if (contactPhone) parts.push(`telefono: ${contactPhone}`);
    if (entities.email) parts.push(`email: ${entities.email}`);
    if (entities.company) parts.push(`azienda: ${entities.company}`);
    return parts.join(', ') + '.';
}

async function updateContact(
    entities: VoiceCRMCommand['entities'],
    userId: string
): Promise<string> {
    if (!entities.name) {
        return 'Per aggiornare un contatto ho bisogno del nome. Puoi ripetere?';
    }

    // Find the contact first
    const search = await pool.query(
        `SELECT id, name, phone, email, company FROM crm_contacts
         WHERE user_id = $1::uuid AND name ILIKE $2
         AND deleted_at IS NULL
         ORDER BY updated_at DESC LIMIT 1`,
        [userId, `%${entities.name}%`]
    );

    if (search.rows.length === 0) {
        return `Non ho trovato nessun contatto con nome "${entities.name}" nel CRM.`;
    }

    const contact = search.rows[0];
    const updates: string[] = [];
    const params: any[] = [];
    let idx = 1;

    if (entities.email) {
        updates.push(`email = $${idx++}`);
        params.push(entities.email);
    }
    if (entities.phone) {
        let ph = entities.phone.replace(/[\s\-().]/g, '');
        if (/^\d{9,10}$/.test(ph)) ph = '+39' + ph;
        updates.push(`phone = $${idx++}`);
        params.push(ph);
    }
    if (entities.company) {
        updates.push(`company = $${idx++}`);
        params.push(entities.company);
    }
    if (entities.notes) {
        updates.push(`notes = COALESCE(notes, '') || E'\\n' || $${idx++}`);
        params.push(`[${new Date().toISOString().slice(0, 16)}] ${entities.notes}`);
    }

    if (updates.length === 0) {
        return `Ho trovato "${contact.name}" ma non ho capito cosa aggiornare. Puoi specificare email, telefono, azienda o note?`;
    }

    updates.push(`updated_at = NOW()`);
    params.push(contact.id);

    await pool.query(
        `UPDATE crm_contacts SET ${updates.join(', ')} WHERE id = $${idx}::uuid`,
        params
    );

    const changedFields = [];
    if (entities.email) changedFields.push(`email → ${entities.email}`);
    if (entities.phone) changedFields.push(`telefono → ${entities.phone}`);
    if (entities.company) changedFields.push(`azienda → ${entities.company}`);
    if (entities.notes) changedFields.push('note aggiunte');

    return `Contatto "${contact.name}" aggiornato: ${changedFields.join(', ')}.`;
}

async function searchContact(
    entities: VoiceCRMCommand['entities'],
    userId: string
): Promise<string> {
    const searchTerm = entities.name || entities.company || entities.phone || entities.email;
    if (!searchTerm) {
        return 'Per cercare un contatto dimmi un nome, azienda, telefono o email.';
    }

    const r = await pool.query(
        `SELECT name, phone, email, company, lead_score, status, created_at
         FROM crm_contacts
         WHERE user_id = $1::uuid
           AND deleted_at IS NULL
           AND (
               name ILIKE $2
               OR company ILIKE $2
               OR phone ILIKE $2
               OR email ILIKE $2
           )
         ORDER BY updated_at DESC
         LIMIT 5`,
        [userId, `%${searchTerm}%`]
    );

    if (r.rows.length === 0) {
        return `Nessun contatto trovato per "${searchTerm}".`;
    }

    const contacts = r.rows.map((c: any) => {
        const parts = [c.name || 'Senza nome'];
        if (c.company) parts.push(`(${c.company})`);
        if (c.phone) parts.push(`tel: ${c.phone}`);
        if (c.email) parts.push(`email: ${c.email}`);
        parts.push(`stato: ${c.status}`);
        return '- ' + parts.join(', ');
    });

    const header = r.rows.length === 1
        ? `Ho trovato 1 contatto:`
        : `Ho trovato ${r.rows.length} contatti:`;

    return `${header}\n${contacts.join('\n')}`;
}

async function createBooking(
    entities: VoiceCRMCommand['entities'],
    userId: string
): Promise<string> {
    if (!entities.name) {
        return 'Per creare un appuntamento ho bisogno almeno del nome del partecipante.';
    }
    if (!entities.date) {
        return 'Non ho capito la data dell\'appuntamento. Puoi ripetere specificando il giorno?';
    }

    // Default time if not specified
    const bookingTime = entities.time || '10:00';

    // Validate date format
    const dateStr = entities.date;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
        return `Non riesco a interpretare la data "${dateStr}". Usa un formato come "martedì" o "15 maggio".`;
    }

    const r = await pool.query(
        `INSERT INTO bookings (user_id, name, phone, date, time, duration, notes, status)
         VALUES ($1::uuid, $2, $3, $4::date, $5, 30, $6, 'confirmed')
         RETURNING id, name, date, time`,
        [
            userId,
            entities.name,
            entities.phone || null,
            dateStr,
            bookingTime,
            entities.notes || null,
        ]
    );

    const row = r.rows[0];
    const formattedDate = new Date(row.date).toLocaleDateString('it-IT', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
    });

    return `Appuntamento confermato con ${row.name} per ${formattedDate} alle ${row.time}.`;
}

async function queryPipeline(userId: string): Promise<string> {
    const r = await pool.query(
        `SELECT
            COUNT(*) as total_deals,
            COALESCE(SUM(value), 0) as total_value,
            COALESCE(SUM(CASE WHEN stage NOT IN ('won', 'lost', 'closed') THEN value ELSE 0 END), 0) as open_value,
            COUNT(CASE WHEN stage NOT IN ('won', 'lost', 'closed') THEN 1 END) as open_count,
            COUNT(CASE WHEN stage = 'won' THEN 1 END) as won_count,
            COALESCE(SUM(CASE WHEN stage = 'won' THEN value ELSE 0 END), 0) as won_value
         FROM deals
         WHERE user_id = $1::uuid AND deleted_at IS NULL`,
        [userId]
    );

    const row = r.rows[0];
    const totalDeals = parseInt(row.total_deals) || 0;

    if (totalDeals === 0) {
        return 'Non ci sono deal nella pipeline al momento.';
    }

    const fmt = (v: number) => new Intl.NumberFormat('it-IT', {
        style: 'currency', currency: 'EUR', maximumFractionDigits: 0,
    }).format(v);

    const parts = [
        `Pipeline CRM: ${totalDeals} deal totali.`,
        `Aperti: ${row.open_count} deal per ${fmt(parseFloat(row.open_value))}.`,
    ];

    if (parseInt(row.won_count) > 0) {
        parts.push(`Vinti: ${row.won_count} deal per ${fmt(parseFloat(row.won_value))}.`);
    }

    return parts.join('\n');
}

async function queryDeal(
    entities: VoiceCRMCommand['entities'],
    userId: string
): Promise<string> {
    const searchTerm = entities.deal_name || entities.name || entities.company;
    if (!searchTerm) {
        return 'Per cercare un deal dimmi il nome della trattativa o dell\'azienda.';
    }

    const r = await pool.query(
        `SELECT title, stage, value, currency, probability, expected_close, owner_name, notes
         FROM deals
         WHERE user_id = $1::uuid
           AND deleted_at IS NULL
           AND (title ILIKE $2 OR owner_name ILIKE $2 OR notes ILIKE $2)
         ORDER BY updated_at DESC
         LIMIT 3`,
        [userId, `%${searchTerm}%`]
    );

    if (r.rows.length === 0) {
        return `Nessun deal trovato per "${searchTerm}".`;
    }

    const fmt = (v: number, cur: string) => new Intl.NumberFormat('it-IT', {
        style: 'currency', currency: cur || 'EUR', maximumFractionDigits: 0,
    }).format(v);

    const deals = r.rows.map((d: any) => {
        const parts = [`"${d.title}"`];
        parts.push(`fase: ${translateStage(d.stage)}`);
        if (d.value) parts.push(`valore: ${fmt(parseFloat(d.value), d.currency)}`);
        if (d.probability) parts.push(`probabilità: ${d.probability}%`);
        if (d.expected_close) {
            const dt = new Date(d.expected_close);
            parts.push(`chiusura prevista: ${dt.toLocaleDateString('it-IT')}`);
        }
        return '- ' + parts.join(', ');
    });

    return `Trovati ${r.rows.length} deal:\n${deals.join('\n')}`;
}

// ─── Helpers ───

function translateStage(stage: string): string {
    const map: Record<string, string> = {
        new: 'Nuovo',
        contacted: 'Contattato',
        qualified: 'Qualificato',
        proposal: 'Proposta inviata',
        negotiation: 'In trattativa',
        won: 'Vinto',
        lost: 'Perso',
        closed: 'Chiuso',
    };
    return map[stage] || stage;
}

/**
 * Check if a voice transcription is a CRM command and execute it.
 * Returns the response string if it was a CRM command, or null if it should
 * fall through to the normal AI response flow.
 */
export async function handleVoiceCRM(
    transcription: string,
    phone: string,
    ownerUserId?: string
): Promise<string | null> {
    try {
        const command = await parseVoiceCRMCommand(transcription);

        // Only execute if it's a recognized CRM intent with high confidence
        if (command.intent === 'general' || command.confidence < 0.7) {
            log.debug(
                { intent: command.intent, confidence: command.confidence },
                'voice-crm: not a CRM command, falling through'
            );
            return null;
        }

        log.info(
            {
                intent: command.intent,
                confidence: command.confidence,
                entities: Object.keys(command.entities).filter(k => (command.entities as any)[k]),
            },
            'voice-crm: executing CRM command'
        );

        const response = await executeVoiceCRMCommand(command, phone, ownerUserId);
        return response || null;
    } catch (err: any) {
        log.error({ err: err.message }, 'handleVoiceCRM error');
        return null; // Fall through to normal AI response on error
    }
}
