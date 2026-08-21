// ═══════════════════════════════════════════════════════════════════
// SARA Conversation Monitor — Anomaly & Hallucination Detector
// ═══════════════════════════════════════════════════════════════════
// Scans wa_messages for forbidden prices, sectors, wrong URLs,
// unsolicited verticals, verbose responses, and hallucinated claims.
//
// Usage:
//   npx tsx src/scripts/sara-conversation-monitor.ts --report
//   npx tsx src/scripts/sara-conversation-monitor.ts --since 2026-04-17
//   npx tsx src/scripts/sara-conversation-monitor.ts --live
//
// Environment:
//   DATABASE_URL            — Postgres connection string
//   TELEGRAM_BOT_TOKEN      — TG bot token for critical alerts
//   TELEGRAM_ADMIN_CHAT_ID  — TG chat ID (set your Telegram chat ID)
// ═══════════════════════════════════════════════════════════════════

import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const { Pool } = pg;

// ─── Config ───

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
    throw new Error('DATABASE_URL is not set. Copy .env.example to .env and set it.');
}
const TG_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TG_ADMIN_CHAT_ID = process.env.TELEGRAM_ADMIN_CHAT_ID || '';
const REPORT_DIR = process.env.SARA_MONITOR_LOG_DIR || './logs/sara-monitor';

const pool = new Pool({ connectionString: DATABASE_URL });
pool.on('error', (err) => console.error('[pool] idle client error', err));

// ─── Severity levels ───

type Severity = 'critical' | 'high' | 'medium' | 'low';

interface Anomaly {
    id: string;
    severity: Severity;
    category: string;
    rule: string;
    message_id: string;
    phone_redacted: string;
    direction: 'in' | 'out';
    snippet: string;       // first 120 chars of offending content
    matched: string;       // what exactly matched
    created_at: string;
}

interface MonitorReport {
    generated_at: string;
    scan_from: string;
    scan_to: string;
    total_messages: number;
    total_outbound: number;
    total_inbound: number;
    anomalies_found: number;
    severity_breakdown: Record<Severity, number>;
    category_breakdown: Record<string, number>;
    anomalies: Anomaly[];
    performance: {
        avg_response_time_ms: number | null;
        slow_responses: number;   // > 30s
        max_response_time_ms: number | null;
    };
}

// ─── Detection Rules ───

// Prezzi VIETATI: listino morto. Se SARA li dice a un cliente, è un'allucinazione grave.
// ⚠️ FIX 17 lug 2026 (decisione di Ale): €19/€29/€39 sono stati TOLTI da questa lista — sono
// add-on LEGITTIMI (SARA WhatsApp Connect €19, SARA Voice €29, SARA WhatsApp Business API €39).
// Marcarli come "vietati critici" faceva scattare l'allarme quando SARA diceva la cosa GIUSTA.
const FORBIDDEN_PRICE_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
    { pattern: /€\s?49(?:\/|\s|$)/i, label: 'forbidden_price_€49' },     // vecchio Growth
    { pattern: /€\s?149(?:\/|\s|$)/i, label: 'forbidden_price_€149' },   // vecchio Scale
    { pattern: /€\s?298(?:\/|\s|$)/i, label: 'forbidden_price_€298' },   // vecchio Enterprise
    { pattern: /€\s?79(?:\/|\s|$)/i, label: 'forbidden_price_€79' },
    { pattern: /€\s?999(?:\/|\s|$)/i, label: 'forbidden_price_€999' },
    { pattern: /€\s?41(?:\/|\s|$)/i, label: 'forbidden_price_€41' },
    { pattern: /€\s?124(?:\/|\s|$)/i, label: 'forbidden_price_€124' },
    { pattern: /€\s?248(?:\/|\s|$)/i, label: 'forbidden_price_€248' },
];

// Prezzi LEGITTIMI che SARA può dire. Qualsiasi importo fuori da qui viene segnalato.
// ⚠️ Questo Set era INVERTITO: conteneva il listino MORTO {0,49,149,298,490,1490,2980} marcato come
// "canonico". Effetto: SARA che diceva €97/€197 (giusto) veniva segnalata come anomalia, mentre
// €149/€298 (sbagliato) passava in silenzio. L'antifurto suonava sui clienti e taceva sui ladri.
// Fonte di verità: INSPECTOR-REFERENCE.md + CLAUDE.md (17 lug 2026). Il piano Starter NON esiste più.
const CANONICAL_PRICES = new Set([
    '0',                        // gratuito / nessun costo
    '97', '970',                // Growth: €97/mese · €970/anno
    '197', '1970',              // Scale: €197/mese · €1970/anno
    '9,90', '9.90',             // SOLO SARA (offerta separata freelance/P.IVA)
    '19',                       // add-on: SARA WhatsApp Connect
    '29',                       // add-on: SARA Voice
    '39',                       // add-on: SARA WhatsApp Business API
    '5',                        // add-on: €5 ogni 1000 AI credits
    '2000', '2.000',            // Enterprise: da €2.000/mese
]);

// Forbidden sectors
const FORBIDDEN_SECTOR_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
    { pattern: /\b(?:settore\s+)?finanziario\b/i, label: 'forbidden_sector_finanziario' },
    { pattern: /\b(?:settore\s+)?bancario\b/i, label: 'forbidden_sector_bancario' },
    { pattern: /\bbanking\s+(?:sector|vertical)\b/i, label: 'forbidden_sector_banking' },
    { pattern: /\bfinancial?\s+(?:sector|vertical)\b/i, label: 'forbidden_sector_financial' },
    { pattern: /\b(?:settore\s+)?assicura(?:tivo|zioni)\b/i, label: 'forbidden_sector_insurance' },
    { pattern: /\binsurance\s+(?:sector|vertical)\b/i, label: 'forbidden_sector_insurance_en' },
    { pattern: /\bretail\s+(?:sector|vertical)\b/i, label: 'forbidden_sector_retail' },
    { pattern: /\be-?commerce\s+vertical\b/i, label: 'forbidden_sector_ecommerce' },
    { pattern: /\bhealthcare\s+vertical\b/i, label: 'forbidden_sector_healthcare' },
    { pattern: /\bsanit[aà]\s+vertical\b/i, label: 'forbidden_sector_sanita' },
    { pattern: /\bospedale|hospital\s+sector\b/i, label: 'forbidden_sector_hospital' },
    { pattern: /\bmanufacturing\s+(?:sector|vertical)\b/i, label: 'forbidden_sector_manufacturing' },
    { pattern: /\blogistic[sa]\s+vertical\b/i, label: 'forbidden_sector_logistics' },
    { pattern: /\beducation\s+(?:sector|vertical)\b/i, label: 'forbidden_sector_education' },
    { pattern: /\bpubblica\s+amministrazione\b/i, label: 'forbidden_sector_pa' },
    { pattern: /\bgovernment\s+sector\b/i, label: 'forbidden_sector_government' },
];

// Allowed URL hosts
const ALLOWED_HOSTS = new Set([
    'get-scala.com',
    'app.get-scala.com',
    'content.get-scala.com',
    'wa.me',
    't.me',
    'www.get-scala.com',
]);

// Wrong acronym patterns
const WRONG_ACRONYM_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
    { pattern: /\bC\s*=\s*Cash\b/i, label: 'wrong_acronym_C=Cash' },
    { pattern: /\bC\s+sta\s+per\s+Cash\b/i, label: 'wrong_acronym_C_sta_per_Cash' },
    { pattern: /\bC\s+stands?\s+for\s+Cash\b/i, label: 'wrong_acronym_C_stands_for_Cash' },
    { pattern: /Strategy\s*,?\s*Cash\s*,?\s*Activation/i, label: 'wrong_acronym_SCA' },
];

// Nomi di piano INVENTATI: se SARA li dice, se li è inventati.
// ⚠️ FIX 17 lug 2026 — questa lista era INVERTITA come CANONICAL_PRICES: segnalava come
// "allucinazione" cose che ESISTONO DAVVERO, quindi suonava quando SARA diceva il vero:
//   · "piano Enterprise"  → ESISTE (Custom, da €2.000/mese — INSPECTOR-REFERENCE.md)
//   · "white label"       → ESISTE (opzione Enterprise, insieme a self-hosted)
//   · "add-on"            → ESISTONO (WhatsApp Connect €19, Voice €29, Business API €39, crediti €5)
// Rimossi tutti e tre. Resta solo ciò che è davvero inventato.
const WRONG_PLAN_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
    { pattern: /\bProfessional\s+plan\b/i, label: 'hallucination_professional_plan' },
    { pattern: /\b(?:piano|plan)\s+Starter\b/i, label: 'hallucination_starter_plan' },   // eliminato 17 lug 2026
    { pattern: /\b(?:piano|plan)\s+Free\b/i, label: 'hallucination_free_plan' },         // non esiste
    { pattern: /\bBasic\s+(?:plan|piano)\b/i, label: 'hallucination_basic_plan' },
    { pattern: /\bPremium\s+(?:plan|piano)\b/i, label: 'hallucination_premium_plan' },
];

// Model name leak
const MODEL_LEAK_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
    { pattern: /\b(?:gemini|groq|mistral|llama|claude|gpt-?\d|openai)\b/i, label: 'leak_model_name' },
    { pattern: /\/home\/ale\//i, label: 'leak_filepath' },
    { pattern: /scala-backend|whatsapp-bot\/src/i, label: 'leak_repo_path' },
    { pattern: /system[_ ]instruction/i, label: 'leak_system_instruction' },
    { pattern: /persona[_ ]instruction/i, label: 'leak_persona_instruction' },
];

// Known SCALA verticals for unsolicited-mention detection
const SCALA_VERTICALS = [
    'PropertyOS', 'AgencyOS', 'BeautyOS', 'DermalyOS', 'DineOS',
    'MotorOS', 'TravelOS', 'PraxisOS', 'StudioOS', 'CleanOS', 'NetworkOS',
    'WellnessOS', 'ShopOS', 'FranchiseOS', 'ProjectOS', 'ReputationOS',
    'LandIQ', 'FacilityOS', 'AdOS',
];

// ─── Utility ───

function redactPhone(phone: string): string {
    const digits = (phone || '').replace(/\D/g, '');
    return digits.length >= 4 ? `***${digits.slice(-4)}` : '****';
}

function truncate(s: string, len: number): string {
    if (!s) return '';
    return s.length > len ? s.slice(0, len) + '...' : s;
}

function makeId(): string {
    return `anomaly_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ─── Core scanner ───

interface WaMessage {
    id: string;
    phone: string;
    direction: 'in' | 'out';
    content: string;
    media_type: string;
    created_at: string;
}

function scanMessage(msg: WaMessage, contextMessages: WaMessage[]): Anomaly[] {
    const anomalies: Anomaly[] = [];
    const content = msg.content || '';
    const lower = content.toLowerCase();

    // Only scan outbound (SARA responses) for most rules
    // Inbound messages are only scanned for injection attempts (handled elsewhere)
    if (msg.direction !== 'out') return anomalies;

    const base = {
        message_id: msg.id,
        phone_redacted: redactPhone(msg.phone),
        direction: msg.direction as 'in' | 'out',
        created_at: msg.created_at,
    };

    // Rule 1: Forbidden prices
    for (const { pattern, label } of FORBIDDEN_PRICE_PATTERNS) {
        const match = content.match(pattern);
        if (match) {
            anomalies.push({
                ...base,
                id: makeId(),
                severity: 'critical',
                category: 'forbidden_price',
                rule: label,
                snippet: truncate(content, 120),
                matched: match[0],
            });
        }
    }

    // Rule 1b: Any euro price not in canonical set
    const euroMatches = content.matchAll(/€\s?(\d+)/g);
    for (const m of euroMatches) {
        const amount = m[1];
        if (!CANONICAL_PRICES.has(amount)) {
            // Check if it's a per-user or per-credit price like €5, €20 etc
            // that might be legitimate (AI credits extra: €5/1K)
            const legitimateSmall = ['5', '10', '15', '20'].includes(amount);
            if (!legitimateSmall) {
                anomalies.push({
                    ...base,
                    id: makeId(),
                    severity: 'high',
                    category: 'unknown_price',
                    rule: `unknown_price_€${amount}`,
                    snippet: truncate(content, 120),
                    matched: m[0],
                });
            }
        }
    }

    // Rule 2: Forbidden sectors
    for (const { pattern, label } of FORBIDDEN_SECTOR_PATTERNS) {
        const match = content.match(pattern);
        if (match) {
            anomalies.push({
                ...base,
                id: makeId(),
                severity: 'critical',
                category: 'forbidden_sector',
                rule: label,
                snippet: truncate(content, 120),
                matched: match[0],
            });
        }
    }

    // Rule 3: URLs not in whitelist
    const urls = content.match(/https?:\/\/[^\s)>"']+/gi) || [];
    for (const url of urls) {
        try {
            const host = new URL(url).hostname.replace(/^www\./, '');
            if (!ALLOWED_HOSTS.has(host) && !ALLOWED_HOSTS.has('www.' + host)) {
                anomalies.push({
                    ...base,
                    id: makeId(),
                    severity: 'high',
                    category: 'unknown_url',
                    rule: `url_not_whitelisted:${host}`,
                    snippet: truncate(content, 120),
                    matched: url.slice(0, 80),
                });
            }
        } catch {
            anomalies.push({
                ...base,
                id: makeId(),
                severity: 'medium',
                category: 'malformed_url',
                rule: 'malformed_url',
                snippet: truncate(content, 120),
                matched: url.slice(0, 80),
            });
        }
    }

    // Rule 4: Unsolicited vertical mention (AgencyOS hallucination pattern)
    // Get recent inbound user messages for context
    const userContext = contextMessages
        .filter(m => m.phone === msg.phone && m.direction === 'in')
        .map(m => (m.content || '').toLowerCase())
        .join(' ');

    for (const vertical of SCALA_VERTICALS) {
        const vLower = vertical.toLowerCase();
        if (!new RegExp(`\\b${vLower}\\b`, 'i').test(content)) continue;

        // Check if user mentioned this vertical or related keywords
        const grounded = userContext.includes(vLower);
        if (grounded) continue;

        // Check topical keywords
        const topicalMap: Record<string, string[]> = {
            propertyos: ['immobilia', 'property', 'casa', 'affit', 'agenzia immobi'],
            agencyos: ['agenzia', 'marketing', 'comunicazione', 'campagne', 'adv', 'pubblicit'],
            beautyos: ['saloni', 'parrucch', 'estetic', 'barberia', 'beauty', 'nail'],
            dermalyos: ['dermatolog', 'medicina estetic', 'clinica', 'trattamento estetico'],
            dineos: ['ristor', 'pizzeria', 'bar ', 'menu', 'prenotazioni tavol'],
            motoros: ['concessionari', 'officina', 'auto ', 'automotive', 'veicol'],
            travelos: ['turism', 'agenzia viaggi', 'tour operator', 'hotel ', 'viagg'],
            praxisos: ['studio professionale', 'avvocat', 'commercialist', 'notaio', 'consulente'],
            studioos: ['architett', 'designer', 'fotograf', 'creativi'],
            cleanos: ['pulizi', 'facility', 'sanifica', 'cleaning'],
            networkos: ['mlm', 'network marketing', 'multilevel', 'herbalife'],
        };
        const keywords = topicalMap[vLower] || [];
        const topicallyGrounded = keywords.some(k => userContext.includes(k));
        if (topicallyGrounded) continue;

        anomalies.push({
            ...base,
            id: makeId(),
            severity: 'critical',
            category: 'unsolicited_vertical',
            rule: `unsolicited_vertical:${vertical}`,
            snippet: truncate(content, 120),
            matched: vertical,
        });
    }

    // Rule 5: Over-verbose (> 2000 chars)
    if (content.length > 2000) {
        anomalies.push({
            ...base,
            id: makeId(),
            severity: 'low',
            category: 'over_verbose',
            rule: `message_length_${content.length}`,
            snippet: truncate(content, 120),
            matched: `${content.length} chars`,
        });
    }

    // Rule 6: Wrong acronym
    for (const { pattern, label } of WRONG_ACRONYM_PATTERNS) {
        const match = content.match(pattern);
        if (match) {
            anomalies.push({
                ...base,
                id: makeId(),
                severity: 'critical',
                category: 'wrong_acronym',
                rule: label,
                snippet: truncate(content, 120),
                matched: match[0],
            });
        }
    }

    // Rule 7: Wrong plan names / hallucinated features
    for (const { pattern, label } of WRONG_PLAN_PATTERNS) {
        const match = content.match(pattern);
        if (match) {
            // "add-on" in context of "no add-on" or "zero add-on" is fine
            if (label === 'hallucination_addon') {
                const surroundingLower = lower;
                if (/(?:no|zero|nessun|non\s+(?:ci\s+)?sono|non\s+ha|senza)\s+add[- ]?on/i.test(surroundingLower)) {
                    continue;
                }
                // "SCALA non ha add-on" is fine
                if (/scala\s+(?:non\s+ha|has\s+no|has\s+zero)\s+add/i.test(surroundingLower)) {
                    continue;
                }
            }
            anomalies.push({
                ...base,
                id: makeId(),
                severity: label.includes('enterprise') ? 'critical' : 'high',
                category: 'hallucinated_plan',
                rule: label,
                snippet: truncate(content, 120),
                matched: match[0],
            });
        }
    }

    // Rule 8: Model name / path leaks
    for (const { pattern, label } of MODEL_LEAK_PATTERNS) {
        const match = content.match(pattern);
        if (match) {
            anomalies.push({
                ...base,
                id: makeId(),
                severity: 'critical',
                category: 'persona_leak',
                rule: label,
                snippet: truncate(content, 120),
                matched: match[0],
            });
        }
    }

    // Rule 9: Wrong pricing (anything claiming a price that is not €0/€97/€197/€970/€1970)
    // Check for "costa/costs/price" + wrong number
    const priceClaim = content.match(/(?:cost[ao]|price|prez{1,2}o|piano|plan)\s+(?:di\s+|of\s+|a\s+|is\s+)?€?\s?(\d+)/i);
    if (priceClaim) {
        const claimed = priceClaim[1];
        if (!CANONICAL_PRICES.has(claimed)) {
            anomalies.push({
                ...base,
                id: makeId(),
                severity: 'critical',
                category: 'wrong_pricing_claim',
                rule: `price_claim_€${claimed}`,
                snippet: truncate(content, 120),
                matched: priceClaim[0],
            });
        }
    }

    return anomalies;
}

// ─── Response time analysis ───

interface ResponseTimePair {
    phone: string;
    inbound_at: Date;
    outbound_at: Date;
    response_ms: number;
}

async function analyzeResponseTimes(since: string, until: string): Promise<{
    pairs: ResponseTimePair[];
    avg_ms: number | null;
    max_ms: number | null;
    slow_count: number;
    slow_anomalies: Anomaly[];
}> {
    // For each inbound message, find the next outbound message to the same phone
    const res = await pool.query(`
        WITH inbound AS (
            SELECT id, phone, created_at as in_at
            FROM wa_messages
            WHERE direction = 'in'
              AND media_type = 'text'
              AND created_at >= $1
              AND created_at <= $2
        ),
        paired AS (
            SELECT
                i.id as in_id,
                i.phone,
                i.in_at,
                (SELECT MIN(created_at) FROM wa_messages o
                 WHERE o.phone = i.phone
                   AND o.direction = 'out'
                   AND o.created_at > i.in_at
                   AND o.created_at < i.in_at + interval '5 minutes'
                ) as out_at
            FROM inbound i
        )
        SELECT phone, in_at, out_at,
               EXTRACT(EPOCH FROM (out_at - in_at)) * 1000 as response_ms
        FROM paired
        WHERE out_at IS NOT NULL
        ORDER BY response_ms DESC
        LIMIT 1000
    `, [since, until]);

    const pairs: ResponseTimePair[] = res.rows.map((r: any) => ({
        phone: r.phone,
        inbound_at: r.in_at,
        outbound_at: r.out_at,
        response_ms: parseFloat(r.response_ms),
    }));

    const times = pairs.map(p => p.response_ms).filter(t => !isNaN(t));
    const avg_ms = times.length > 0 ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : null;
    const max_ms = times.length > 0 ? Math.round(Math.max(...times)) : null;
    const SLOW_THRESHOLD_MS = 30_000;
    const slow = pairs.filter(p => p.response_ms > SLOW_THRESHOLD_MS);

    const slow_anomalies: Anomaly[] = slow.map(p => ({
        id: makeId(),
        severity: p.response_ms > 60_000 ? 'high' as Severity : 'medium' as Severity,
        category: 'slow_response',
        rule: `response_time_${Math.round(p.response_ms)}ms`,
        message_id: '',
        phone_redacted: redactPhone(p.phone),
        direction: 'out' as const,
        snippet: `Response took ${(p.response_ms / 1000).toFixed(1)}s`,
        matched: `${Math.round(p.response_ms)}ms`,
        created_at: p.outbound_at.toISOString(),
    }));

    return { pairs, avg_ms, max_ms, slow_count: slow.length, slow_anomalies };
}

// ─── Database query ───

async function fetchMessages(since: string, until: string): Promise<WaMessage[]> {
    const res = await pool.query(`
        SELECT id, phone, direction, content, media_type, created_at
        FROM wa_messages
        WHERE created_at >= $1
          AND created_at <= $2
          AND media_type = 'text'
          AND content IS NOT NULL
          AND content != ''
        ORDER BY created_at ASC
    `, [since, until]);

    return res.rows.map((r: any) => ({
        id: r.id,
        phone: r.phone,
        direction: r.direction,
        content: r.content,
        media_type: r.media_type,
        created_at: new Date(r.created_at).toISOString(),
    }));
}

// ─── Telegram alerting ───

async function sendTelegramAlert(text: string): Promise<void> {
    if (!TG_BOT_TOKEN) {
        console.warn('[MONITOR] No TELEGRAM_BOT_TOKEN set — skipping TG alert');
        return;
    }
    const url = `https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`;
    try {
        const resp = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: TG_ADMIN_CHAT_ID,
                text,
                parse_mode: 'HTML',
                disable_web_page_preview: true,
            }),
        });
        if (!resp.ok) {
            const body = await resp.text();
            console.error(`[MONITOR] Telegram API error: ${resp.status} ${body}`);
        }
    } catch (err: any) {
        console.error(`[MONITOR] Telegram send failed: ${err.message}`);
    }
}

function formatTelegramAlert(report: MonitorReport): string {
    const lines: string[] = [
        `<b>SARA Monitor Alert</b>`,
        `<code>${report.generated_at}</code>`,
        ``,
        `Messages scanned: ${report.total_messages}`,
        `Anomalies found: <b>${report.anomalies_found}</b>`,
        ``,
    ];

    if (report.severity_breakdown.critical > 0) {
        lines.push(`CRITICAL: <b>${report.severity_breakdown.critical}</b>`);
    }
    if (report.severity_breakdown.high > 0) {
        lines.push(`HIGH: <b>${report.severity_breakdown.high}</b>`);
    }
    if (report.severity_breakdown.medium > 0) {
        lines.push(`MEDIUM: ${report.severity_breakdown.medium}`);
    }
    if (report.severity_breakdown.low > 0) {
        lines.push(`LOW: ${report.severity_breakdown.low}`);
    }

    lines.push('');

    // Top 5 anomalies
    const top = report.anomalies
        .filter(a => a.severity === 'critical' || a.severity === 'high')
        .slice(0, 5);
    for (const a of top) {
        lines.push(`[${a.severity.toUpperCase()}] ${a.category} — ${a.rule}`);
        lines.push(`  Phone: ${a.phone_redacted} | ${a.matched}`);
    }

    if (report.performance.slow_responses > 0) {
        lines.push('');
        lines.push(`Slow responses (>30s): ${report.performance.slow_responses}`);
        if (report.performance.max_response_time_ms) {
            lines.push(`Max response time: ${(report.performance.max_response_time_ms / 1000).toFixed(1)}s`);
        }
    }

    return lines.join('\n');
}

// ─── Report mode ───

async function runReport(since: string, until: string): Promise<MonitorReport> {
    console.log(`[MONITOR] Scanning messages from ${since} to ${until}...`);

    const messages = await fetchMessages(since, until);
    console.log(`[MONITOR] Fetched ${messages.length} text messages`);

    const allAnomalies: Anomaly[] = [];

    // Build a context window for each message (previous 10 messages from same phone)
    const byPhone = new Map<string, WaMessage[]>();
    for (const msg of messages) {
        if (!byPhone.has(msg.phone)) byPhone.set(msg.phone, []);
        byPhone.get(msg.phone)!.push(msg);
    }

    for (const msg of messages) {
        const phoneMessages = byPhone.get(msg.phone) || [];
        const msgIndex = phoneMessages.indexOf(msg);
        const contextWindow = phoneMessages.slice(Math.max(0, msgIndex - 10), msgIndex);
        const found = scanMessage(msg, contextWindow);
        allAnomalies.push(...found);
    }

    // Response time analysis
    const perfData = await analyzeResponseTimes(since, until);
    allAnomalies.push(...perfData.slow_anomalies);

    // Severity breakdown
    const severityBreakdown: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0 };
    const categoryBreakdown: Record<string, number> = {};
    for (const a of allAnomalies) {
        severityBreakdown[a.severity]++;
        categoryBreakdown[a.category] = (categoryBreakdown[a.category] || 0) + 1;
    }

    const outbound = messages.filter(m => m.direction === 'out').length;
    const inbound = messages.filter(m => m.direction === 'in').length;

    const report: MonitorReport = {
        generated_at: new Date().toISOString(),
        scan_from: since,
        scan_to: until,
        total_messages: messages.length,
        total_outbound: outbound,
        total_inbound: inbound,
        anomalies_found: allAnomalies.length,
        severity_breakdown: severityBreakdown,
        category_breakdown: categoryBreakdown,
        anomalies: allAnomalies,
        performance: {
            avg_response_time_ms: perfData.avg_ms,
            slow_responses: perfData.slow_count,
            max_response_time_ms: perfData.max_ms,
        },
    };

    return report;
}

function printConsoleSummary(report: MonitorReport): void {
    console.log('\n' + '='.repeat(60));
    console.log('  SARA Conversation Monitor Report');
    console.log('='.repeat(60));
    console.log(`  Generated:    ${report.generated_at}`);
    console.log(`  Scan range:   ${report.scan_from} -> ${report.scan_to}`);
    console.log(`  Messages:     ${report.total_messages} (in: ${report.total_inbound}, out: ${report.total_outbound})`);
    console.log('');
    console.log(`  Anomalies:    ${report.anomalies_found}`);
    console.log(`    CRITICAL:   ${report.severity_breakdown.critical}`);
    console.log(`    HIGH:       ${report.severity_breakdown.high}`);
    console.log(`    MEDIUM:     ${report.severity_breakdown.medium}`);
    console.log(`    LOW:        ${report.severity_breakdown.low}`);
    console.log('');

    if (Object.keys(report.category_breakdown).length > 0) {
        console.log('  By category:');
        for (const [cat, count] of Object.entries(report.category_breakdown).sort((a, b) => b[1] - a[1])) {
            console.log(`    ${cat}: ${count}`);
        }
        console.log('');
    }

    console.log('  Performance:');
    console.log(`    Avg response:  ${report.performance.avg_response_time_ms !== null ? (report.performance.avg_response_time_ms / 1000).toFixed(1) + 's' : 'N/A'}`);
    console.log(`    Max response:  ${report.performance.max_response_time_ms !== null ? (report.performance.max_response_time_ms / 1000).toFixed(1) + 's' : 'N/A'}`);
    console.log(`    Slow (>30s):   ${report.performance.slow_responses}`);
    console.log('');

    // Print top anomalies
    const criticals = report.anomalies.filter(a => a.severity === 'critical');
    if (criticals.length > 0) {
        console.log('  CRITICAL anomalies:');
        for (const a of criticals.slice(0, 10)) {
            console.log(`    [${a.category}] ${a.rule}`);
            console.log(`      Phone: ${a.phone_redacted} | Match: ${a.matched}`);
            console.log(`      At: ${a.created_at}`);
            console.log(`      Snippet: ${a.snippet}`);
            console.log('');
        }
    }

    const highs = report.anomalies.filter(a => a.severity === 'high');
    if (highs.length > 0) {
        console.log(`  HIGH anomalies (showing first 5 of ${highs.length}):`);
        for (const a of highs.slice(0, 5)) {
            console.log(`    [${a.category}] ${a.rule} — ${a.matched}`);
        }
    }

    console.log('='.repeat(60));
}

function saveReport(report: MonitorReport): string {
    if (!fs.existsSync(REPORT_DIR)) {
        fs.mkdirSync(REPORT_DIR, { recursive: true });
    }
    const dateStr = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filePath = path.join(REPORT_DIR, `report-${dateStr}.json`);
    fs.writeFileSync(filePath, JSON.stringify(report, null, 2));
    console.log(`[MONITOR] Report saved to ${filePath}`);
    return filePath;
}

// ─── Live mode ───

async function runLive(): Promise<void> {
    console.log('[MONITOR] Starting live tail mode...');
    console.log('[MONITOR] Watching for new messages (Ctrl+C to stop)');
    console.log('');

    let lastChecked = new Date().toISOString();
    const contextCache = new Map<string, WaMessage[]>(); // phone -> recent messages

    const pollInterval = 5_000; // 5s

    const poll = async () => {
        try {
            const now = new Date().toISOString();
            const newMessages = await fetchMessages(lastChecked, now);

            for (const msg of newMessages) {
                // Update context cache
                if (!contextCache.has(msg.phone)) {
                    contextCache.set(msg.phone, []);
                }
                const cache = contextCache.get(msg.phone)!;
                cache.push(msg);
                // Keep last 20 messages per phone
                while (cache.length > 20) cache.shift();

                const anomalies = scanMessage(msg, cache);
                if (anomalies.length > 0) {
                    for (const a of anomalies) {
                        const icon = a.severity === 'critical' ? 'CRIT' :
                                     a.severity === 'high' ? 'HIGH' :
                                     a.severity === 'medium' ? 'MED ' : 'LOW ';
                        console.log(`[${icon}] ${new Date().toISOString()} | ${a.category} | ${a.rule}`);
                        console.log(`        Phone: ${a.phone_redacted} | Match: ${a.matched}`);
                        if (a.severity === 'critical' || a.severity === 'high') {
                            console.log(`        Snippet: ${a.snippet}`);
                        }
                    }

                    // Send TG alert for critical anomalies
                    const criticals = anomalies.filter(a => a.severity === 'critical');
                    if (criticals.length > 0) {
                        const alertLines = criticals.map(a =>
                            `[CRITICAL] ${a.category}: ${a.rule}\nPhone: ${a.phone_redacted}\nMatch: ${a.matched}`
                        );
                        await sendTelegramAlert(
                            `<b>SARA Live Alert</b>\n\n${alertLines.join('\n\n')}`
                        );
                    }
                }
            }

            if (newMessages.length > 0) {
                lastChecked = newMessages[newMessages.length - 1].created_at;
            }
        } catch (err: any) {
            console.error(`[MONITOR] Poll error: ${err.message}`);
        }
    };

    // Initial poll
    await poll();

    // Continuous polling
    const intervalHandle = setInterval(poll, pollInterval);

    // Graceful shutdown
    process.on('SIGINT', () => {
        console.log('\n[MONITOR] Shutting down live monitor...');
        clearInterval(intervalHandle);
        pool.end().then(() => process.exit(0));
    });
    process.on('SIGTERM', () => {
        clearInterval(intervalHandle);
        pool.end().then(() => process.exit(0));
    });

    // Keep alive
    await new Promise(() => {}); // block forever
}

// ─── CLI ───

async function main(): Promise<void> {
    const args = process.argv.slice(2);
    const mode = args.find(a => a.startsWith('--'))?.replace('--', '') || 'report';

    try {
        // Verify DB connection
        await pool.query('SELECT 1');
        console.log('[MONITOR] Database connected');
    } catch (err: any) {
        console.error(`[MONITOR] Cannot connect to database: ${err.message}`);
        console.error('[MONITOR] Check DATABASE_URL environment variable');
        process.exit(1);
    }

    if (mode === 'live') {
        await runLive();
        return;
    }

    // Determine scan window
    let since: string;
    let until = new Date().toISOString();

    if (mode === 'since') {
        const dateArg = args[args.indexOf('--since') + 1];
        if (!dateArg) {
            console.error('[MONITOR] --since requires a date argument (YYYY-MM-DD)');
            process.exit(1);
        }
        since = new Date(dateArg).toISOString();
    } else {
        // Default: last 24h
        const yesterday = new Date();
        yesterday.setHours(yesterday.getHours() - 24);
        since = yesterday.toISOString();
    }

    const report = await runReport(since, until);
    printConsoleSummary(report);
    const reportPath = saveReport(report);

    // Send TG alert if critical anomalies found
    const criticalCount = report.severity_breakdown.critical;
    if (criticalCount > 0) {
        console.log(`[MONITOR] ${criticalCount} CRITICAL anomalies found — sending Telegram alert`);
        await sendTelegramAlert(formatTelegramAlert(report));
    } else {
        console.log('[MONITOR] No critical anomalies — no Telegram alert sent');
    }

    await pool.end();
    console.log(`[MONITOR] Done. Report: ${reportPath}`);
}

main().catch(err => {
    console.error('[MONITOR] Fatal error:', err);
    process.exit(1);
});
