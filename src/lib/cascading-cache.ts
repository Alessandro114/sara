// ═══════════════════════════════════════════════════════════
// cascading-cache.ts — Formalized multi-layer cache cascade
// ═══════════════════════════════════════════════════════════
// Implements a strict cascade order that tries each layer before
// touching the LLM. Each layer is cheaper/faster than the next.
//
// CASCADE ORDER:
//   L1: Static FAQ (in-memory, 0ms, €0)
//   L2: Template Match (pre-built sector responses, <1ms, €0)
//   L3: Dream Cache (DB lookup, <5ms, €0)
//   L4: Fact Extract from pre-digested KB (regex+JSON, <10ms, €0)
//   L5: LLM call (Groq/Ollama, 200-2000ms, €0 but rate-limited)
//   L6: Ensemble 3×7B (3 parallel Ollama, 500-3000ms, €0)
//
// The caller (ai.ts getAIResponse) decides when to use L5 vs L6.

import { pool } from '../config.js';
import * as crypto from 'crypto';
import { getPredigestedFacts, buildFactsFromDigested, type ExtractedFact } from './fact-predigest.js';

export interface CascadeResult {
    text: string;
    layer: 'faq' | 'template' | 'cache' | 'fact' | 'llm' | 'ensemble';
    latencyMs: number;
    cached: boolean;
}

// ─── L2: Template Match ───
// Pre-built responses for very common patterns per sector.
// These don't need LLM — they're hardcoded natural responses.
const SECTOR_TEMPLATES: Record<string, Array<{ pattern: RegExp; responses: Record<string, string> }>> = {
    immobiliare: [
        {
            pattern: /(?:orari|apertura|quando.*aperto|opening|horario)/i,
            responses: {
                it: 'Siamo aperti dal lunedì al venerdì 9:00-18:00 e sabato 9:00-13:00. Per visite agli immobili, anche su appuntamento fuori orario.',
                en: 'We are open Monday to Friday 9:00-18:00 and Saturday 9:00-13:00. Property viewings also available by appointment outside hours.',
                es: 'Estamos abiertos de lunes a viernes 9:00-18:00 y sábados 9:00-13:00. Visitas a inmuebles también con cita fuera de horario.',
                pt: 'Estamos abertos de segunda a sexta 9:00-18:00 e sábado 9:00-13:00. Visitas a imóveis também por marcação fora do horário.',
            },
        },
    ],
    ristorante: [
        {
            pattern: /(?:prenotare|reservation|reserva|prenot|book.*table)/i,
            responses: {
                it: 'Certo! Per prenotare basta dirmi data, orario e numero di persone. Posso verificare la disponibilità subito.',
                en: 'Of course! To book just tell me the date, time and number of guests. I can check availability right away.',
                es: '¡Por supuesto! Para reservar solo dime fecha, hora y número de personas. Puedo verificar la disponibilidad enseguida.',
                pt: 'Claro! Para reservar basta me dizer data, hora e número de pessoas. Posso verificar a disponibilidade já.',
            },
        },
    ],
    beauty: [
        {
            pattern: /(?:orari|apertura|quando.*aperto|opening|horario)/i,
            responses: {
                it: 'Siamo aperti dal martedì al sabato. Per orari precisi e appuntamenti, dimmi che giorno preferisci!',
                en: 'We are open Tuesday to Saturday. For exact times and appointments, just tell me your preferred day!',
                es: 'Estamos abiertos de martes a sábado. Para horarios exactos y citas, ¡dime qué día prefieres!',
                pt: 'Estamos abertos de terça a sábado. Para horários exatos e marcações, diga-me que dia prefere!',
            },
        },
    ],
};

function matchTemplate(question: string, sector: string, lang: string): string | null {
    const templates = SECTOR_TEMPLATES[sector];
    if (!templates) return null;

    for (const tmpl of templates) {
        if (tmpl.pattern.test(question)) {
            return tmpl.responses[lang] || tmpl.responses.it || null;
        }
    }
    return null;
}

// ─── L3: Dream Cache lookup ───
function normalizeQuestion(q: string): string {
    return q.toLowerCase().trim().replace(/\s+/g, ' ').replace(/[?!.,;:'"()\[\]{}]/g, '').replace(/\s+/g, ' ').trim();
}

function generateCacheKey(normalizedQ: string, sector: string, lang: string): string {
    const keywords = normalizedQ.split(' ').filter(w => w.length > 2).sort().join('|');
    const raw = `${keywords}::${sector}::${lang}`;
    return crypto.createHash('sha256').update(raw).digest('hex').substring(0, 32);
}

async function lookupDreamCache(question: string, sector: string, lang: string): Promise<string | null> {
    const normalizedQ = normalizeQuestion(question);
    const cacheKey = generateCacheKey(normalizedQ, sector, lang);

    try {
        const r = await pool.query(
            'SELECT response FROM ai_response_cache WHERE cache_key = $1 AND expires_at > NOW()',
            [cacheKey]
        );
        if (r.rows.length > 0) {
            pool.query('UPDATE ai_response_cache SET hit_count = hit_count + 1 WHERE cache_key = $1', [cacheKey]).catch(() => {});
            return r.rows[0].response;
        }
    } catch { /* non-blocking */ }
    return null;
}

// ─── L4: Fact-based response from pre-digested KB ───
async function factBasedResponse(
    question: string,
    sector: string,
    lang: string
): Promise<{ facts: ExtractedFact[]; docTitle: string } | null> {
    const keywords = normalizeQuestion(question).split(' ').filter(w => w.length > 3);
    if (keywords.length === 0) return null;

    try {
        const conditions = keywords.map((_, i) => `(LOWER(title) LIKE $${i + 2} OR LOWER(content) LIKE $${i + 2})`).join(' OR ');
        const params: any[] = [sector, ...keywords.map(k => `%${k}%`)];

        const result = await pool.query(
            `SELECT id, title FROM wa_rag_documents
             WHERE (sector = $1 OR sector = 'general') AND (${conditions})
             AND facts_json IS NOT NULL
             ORDER BY CASE WHEN ${keywords.map((_, i) => `LOWER(title) LIKE $${i + 2}`).join(' OR ')} THEN 0 ELSE 1 END
             LIMIT 1`,
            params
        );

        if (result.rows.length > 0) {
            const facts = await getPredigestedFacts(result.rows[0].id);
            if (facts.length > 0) {
                return { facts, docTitle: result.rows[0].title };
            }
        }
    } catch { /* non-blocking */ }
    return null;
}

// ─── Main cascade function ───
export async function tryCascade(
    question: string,
    sector: string,
    lang: string,
    faqMatcher?: (q: string, l: string) => string | null
): Promise<CascadeResult | null> {
    const start = Date.now();

    // L1: Static FAQ
    if (faqMatcher) {
        const faqResponse = faqMatcher(question, lang);
        if (faqResponse) {
            return { text: faqResponse, layer: 'faq', latencyMs: Date.now() - start, cached: true };
        }
    }

    // L2: Template Match
    const templateResponse = matchTemplate(question, sector, lang);
    if (templateResponse) {
        console.log(`[CASCADE] L2 template hit: sector=${sector}`);
        return { text: templateResponse, layer: 'template', latencyMs: Date.now() - start, cached: true };
    }

    // L3: Dream Cache
    const cacheResponse = await lookupDreamCache(question, sector, lang);
    if (cacheResponse) {
        console.log(`[CASCADE] L3 dream cache hit: sector=${sector}`);
        return { text: cacheResponse, layer: 'cache', latencyMs: Date.now() - start, cached: true };
    }

    // L4: Pre-digested facts (returns facts, caller must still format with LLM or template)
    // This is an optimization hint, not a full response — return null to signal "proceed to LLM"
    // but with pre-extracted facts available
    const factResult = await factBasedResponse(question, sector, lang);
    if (factResult && factResult.facts.length >= 2) {
        const factsPrompt = buildFactsFromDigested(factResult.facts);
        console.log(`[CASCADE] L4 pre-digested facts found: "${factResult.docTitle}" → ${factResult.facts.length} facts`);
        // Return facts as structured context — caller will inject into LLM prompt
        // This saves the regex extraction step at runtime
        return { text: factsPrompt, layer: 'fact', latencyMs: Date.now() - start, cached: false };
    }

    // No cache hit — caller should proceed to L5 (LLM) or L6 (Ensemble)
    return null;
}

export { normalizeQuestion, generateCacheKey };
