// ═══════════════════════════════════════════════════════════
// dream-cycle.ts — Nightly pre-computation engine for SARA
// ═══════════════════════════════════════════════════════════
// Runs during off-peak hours (default 2-5 AM) using Groq free tier.
// Pre-computes and caches responses for predicted questions,
// warms embeddings, validates KB, and consolidates conversation patterns.
// Result: near-zero LLM calls during peak hours → zero marginal cost.

import { pool } from '../config.js';
import { chatChain, embedChain, type ChatMsg } from './ai-providers.js';
import { SECTOR_PROMPTS } from '../sectors.js';
import * as crypto from 'crypto';

// ─── Configuration ───
const DREAM_HOUR_START = parseInt(process.env.DREAM_HOUR_START || '2', 10);
const DREAM_HOUR_END = parseInt(process.env.DREAM_HOUR_END || '5', 10);
const DREAM_BATCH_SIZE = parseInt(process.env.DREAM_BATCH_SIZE || '20', 10);
const DREAM_DELAY_MS = parseInt(process.env.DREAM_DELAY_MS || '3000', 10); // delay between LLM calls to stay under rate limits

// sara_business_insights.user_id is uuid NOT NULL with no FK, but the table has a
// UNIQUE (user_id, insight_type) constraint. System-level insights (not owned by any
// tenant) are attributed to the nil UUID so they occupy exactly one row per insight_type.
const SYSTEM_INSIGHT_USER_ID = '00000000-0000-0000-0000-000000000000';

interface DreamStats {
    questionsAnalyzed: number;
    responsesCached: number;
    embeddingsWarmed: number;
    staleEntriesPurged: number;
    patternsFound: number;
    startedAt: Date;
    finishedAt?: Date;
}

// ─── Pattern templates per sector ───
// Common question patterns that can be pre-computed
const SECTOR_QUESTION_TEMPLATES: Record<string, string[]> = {
    immobiliare: [
        'Quanto costa un bilocale a {zone}?',
        'Avete trilocali in zona {zone}?',
        'Quali appartamenti avete disponibili?',
        'Cerco casa a {zone}',
        'Quanto costa al metro quadro a {zone}?',
    ],
    legale: [
        'Quanto costa una consulenza?',
        'Avete esperienza in {service}?',
        'Come funziona la prima visita?',
        'Tempi per una causa di {service}?',
    ],
    dermatologia: [
        'Quanto costa il botox?',
        'Quanto costa il filler?',
        'Prezzi trattamenti laser?',
        'Prima visita dermatologica costo?',
    ],
    automotive: [
        'Quanto costa un tagliando?',
        'Quanto costa la revisione?',
        'Cambio gomme prezzo?',
        'Avete {brand} usate?',
    ],
    ristorante: [
        'Avete tavoli per stasera?',
        'Menu degustazione prezzo?',
        'Siete aperti la domenica?',
        'Avete opzioni vegetariane?',
    ],
    beauty: [
        'Quanto costa un taglio donna?',
        'Trattamento cheratina prezzo?',
        'Orari di apertura?',
        'Colorazione prezzo?',
    ],
    cleaning: [
        'Quanto costa una pulizia appartamento?',
        'Pulizia uffici preventivo?',
        'Pulizia post-cantiere prezzo?',
    ],
    turismo: [
        'Pacchetti weekend disponibili?',
        'Escursioni prezzi?',
        'Prenotazione hotel?',
    ],
    waste: [
        'Quanto costa la TARI per 2 persone?',
        'Calendario raccolta differenziata?',
        'Come smaltire ingombranti?',
    ],
    franchise: [
        'Quanto costa la fee di ingresso?',
        'Royalty mensili?',
        'Requisiti per aprire?',
    ],
    service: [
        'Quanto costa un intervento?',
        'Contratto manutenzione annuale?',
        'Tempi di intervento?',
    ],
    wellness: [
        'Abbonamento mensile palestra?',
        'Personal trainer prezzo?',
        'Prova gratuita?',
    ],
};

// ─── Cache key generation (must match ai.ts logic) ───
function normalizeQuestion(q: string): string {
    return q.toLowerCase().trim().replace(/\s+/g, ' ').replace(/[?!.,;:'"()\[\]{}]/g, '').replace(/\s+/g, ' ').trim();
}

function generateCacheKey(normalizedQ: string, sector: string, lang: string): string {
    const keywords = normalizedQ.split(' ').filter(w => w.length > 2).sort().join('|');
    const raw = `${keywords}::${sector}::${lang}`;
    return crypto.createHash('sha256').update(raw).digest('hex').substring(0, 32);
}

// ─── Phase 1: Analyze recent conversations to find uncached patterns ───
async function analyzeRecentConversations(): Promise<Array<{ question: string; sector: string; lang: string; frequency: number }>> {
    try {
        const result = await pool.query(`
            SELECT content, s.sector, COALESCE(s.user_language, 'it') as lang, COUNT(*) as freq
            FROM wa_messages m
            JOIN wa_sessions s ON m.phone = s.phone
            WHERE m.direction = 'in'
              AND m.created_at > NOW() - INTERVAL '7 days'
              AND LENGTH(m.content) > 10
              AND LENGTH(m.content) < 200
            GROUP BY content, s.sector, s.user_language
            HAVING COUNT(*) >= 2
            ORDER BY freq DESC
            LIMIT 100
        `);

        return result.rows.map((r: any) => ({
            question: r.content,
            sector: r.sector || 'general',
            lang: r.lang || 'it',
            frequency: parseInt(r.freq),
        }));
    } catch (err: any) {
        console.error('[DREAM] Failed to analyze conversations:', err.message);
        return [];
    }
}

// ─── Phase 2: Find KB docs without embeddings or with stale embeddings ───
async function warmEmbeddings(): Promise<number> {
    let warmed = 0;
    try {
        const docs = await pool.query(`
            SELECT id, title, content FROM wa_rag_documents
            WHERE embedding IS NULL
            LIMIT 50
        `);

        for (const doc of docs.rows) {
            try {
                const { vector } = await embedChain(`${doc.title} ${doc.content}`);
                await pool.query(
                    'UPDATE wa_rag_documents SET embedding = $1::vector WHERE id = $2',
                    [`[${vector.join(',')}]`, doc.id]
                );
                warmed++;
                await sleep(500);
            } catch (err: any) {
                console.error(`[DREAM] Embed failed for "${doc.title}":`, err.message);
            }
        }
    } catch (err: any) {
        console.error('[DREAM] Embedding warmup failed:', err.message);
    }
    return warmed;
}

// ─── Phase 3: Pre-compute responses for common patterns ───
async function precomputeResponses(
    patterns: Array<{ question: string; sector: string; lang: string }>,
    maxBatch: number
): Promise<number> {
    let cached = 0;

    for (const pattern of patterns.slice(0, maxBatch)) {
        const normalizedQ = normalizeQuestion(pattern.question);
        const cacheKey = generateCacheKey(normalizedQ, pattern.sector, pattern.lang);

        // Skip if already cached
        try {
            const existing = await pool.query(
                'SELECT 1 FROM ai_response_cache WHERE cache_key = $1 AND expires_at > NOW()',
                [cacheKey]
            );
            if (existing.rows.length > 0) continue;
        } catch { continue; }

        // Find relevant KB context
        let kbContext = '';
        try {
            const keywords = normalizedQ.split(' ').filter(w => w.length > 3);
            if (keywords.length > 0) {
                const conditions = keywords.map((_, i) => `(LOWER(title) LIKE $${i + 2} OR LOWER(content) LIKE $${i + 2})`).join(' OR ');
                const params: any[] = [pattern.sector, ...keywords.map(k => `%${k}%`)];
                const kbResult = await pool.query(
                    `SELECT title, content FROM wa_rag_documents WHERE (sector = $1 OR sector = 'general') AND (${conditions}) LIMIT 3`,
                    params
                );
                if (kbResult.rows.length > 0) {
                    kbContext = kbResult.rows.map((r: any) => `[${r.title}] ${r.content}`).join('\n---\n');
                }
            }
        } catch { /* KB search non-blocking */ }

        // Build prompt and generate response
        const sectorPrompt = SECTOR_PROMPTS[pattern.sector] || SECTOR_PROMPTS.general;
        const langNames: Record<string, string> = { it: 'Italian', en: 'English', es: 'Spanish', pt: 'Portuguese', de: 'German' };
        const replyLang = langNames[pattern.lang] || 'Italian';

        const messages: ChatMsg[] = [
            {
                role: 'system',
                content: `${sectorPrompt}\n\nRispondi in modo breve e naturale (max 60 parole, 1 messaggio solo).\n${pattern.lang !== 'it' ? `Reply ONLY in ${replyLang}.` : ''}${kbContext ? `\n\n═══ DATI VERIFICATI ═══\n${kbContext}\n═══════════════════\nUSA questi dati per rispondere. COPIA i numeri ESATTAMENTE.` : ''}`,
            },
            { role: 'user', content: pattern.question },
        ];

        try {
            const result = await chatChain(messages, 300);
            const response = result.text.trim();

            if (response && response.length > 10) {
                await pool.query(
                    `INSERT INTO ai_response_cache (cache_key, question_normalized, response, sector, lang, provider)
                     VALUES ($1, $2, $3, $4, $5, $6)
                     ON CONFLICT (cache_key) DO UPDATE SET
                       response = EXCLUDED.response,
                       expires_at = NOW() + INTERVAL '7 days'`,
                    [cacheKey, normalizedQ, response, pattern.sector, pattern.lang, `dream:${result.provider}`]
                );
                cached++;
                console.log(`[DREAM] Cached: "${pattern.question.substring(0, 50)}..." → ${result.provider}`);
            }

            await sleep(DREAM_DELAY_MS);
        } catch (err: any) {
            console.error(`[DREAM] Pre-compute failed for "${pattern.question.substring(0, 40)}":`, err.message);
            await sleep(1000);
        }
    }

    return cached;
}

// ─── Phase 4: Generate template-based questions from KB ───
async function generateFromTemplates(sector: string, lang: string): Promise<Array<{ question: string; sector: string; lang: string }>> {
    const templates = SECTOR_QUESTION_TEMPLATES[sector];
    if (!templates) return [];

    // Get real data from KB to fill template variables
    const questions: Array<{ question: string; sector: string; lang: string }> = [];

    try {
        const docs = await pool.query(
            'SELECT title, content FROM wa_rag_documents WHERE sector = $1 LIMIT 20',
            [sector]
        );

        // Extract zones/brands/services from KB titles
        const zones = new Set<string>();
        const services = new Set<string>();
        const brands = new Set<string>();

        for (const doc of docs.rows) {
            const title = doc.title as string;
            const zoneMatch = title.match(/(?:bilocale|trilocale|attico|villa|appartamento|penthouse)\s+(.+)/i);
            if (zoneMatch) zones.add(zoneMatch[1].trim());

            const serviceMatch = title.match(/(?:consulenza|trattamento|causa|pratica)\s+(.+)/i);
            if (serviceMatch) services.add(serviceMatch[1].trim());

            const brandMatch = title.match(/^(Fiat|Jeep|BMW|Audi|Mercedes|Ford|Toyota|Volkswagen)/i);
            if (brandMatch) brands.add(brandMatch[1]);
        }

        const zonesArr = Array.from(zones);
        const servicesArr = Array.from(services);
        const brandsArr = Array.from(brands);

        for (const template of templates) {
            if (template.includes('{zone}')) {
                for (const zone of zonesArr) {
                    questions.push({ question: template.replace('{zone}', zone), sector, lang });
                }
                if (zonesArr.length === 0) continue;
            } else if (template.includes('{service}')) {
                for (const svc of servicesArr) {
                    questions.push({ question: template.replace('{service}', svc), sector, lang });
                }
                if (servicesArr.length === 0) continue;
            } else if (template.includes('{brand}')) {
                for (const brand of brandsArr) {
                    questions.push({ question: template.replace('{brand}', brand), sector, lang });
                }
                if (brandsArr.length === 0) continue;
            } else {
                questions.push({ question: template, sector, lang });
            }
        }
    } catch { /* non-blocking */ }

    return questions;
}

// ─── Phase 5: Purge stale cache entries ───
async function purgeStaleCache(): Promise<number> {
    try {
        const result = await pool.query('DELETE FROM ai_response_cache WHERE expires_at < NOW()');
        return result.rowCount || 0;
    } catch {
        return 0;
    }
}

// ─── Phase 6: Consolidate conversation patterns into insights ───
async function consolidatePatterns(): Promise<number> {
    try {
        // Find top question clusters per sector
        const result = await pool.query(`
            SELECT s.sector,
                   LOWER(SUBSTRING(m.content FROM 1 FOR 50)) as pattern,
                   COUNT(*) as freq
            FROM wa_messages m
            JOIN wa_sessions s ON m.phone = s.phone
            WHERE m.direction = 'in'
              AND m.created_at > NOW() - INTERVAL '30 days'
              AND LENGTH(m.content) > 5
            GROUP BY s.sector, LOWER(SUBSTRING(m.content FROM 1 FOR 50))
            HAVING COUNT(*) >= 3
            ORDER BY freq DESC
            LIMIT 50
        `);

        // Store as a single business insight row.
        // NOTE: sara_business_insights has UNIQUE (user_id, insight_type), so one row per
        // insight_type is all the schema allows — the patterns are aggregated into the
        // insight_data jsonb payload rather than inserted one row per pattern.
        if (result.rows.length > 0) {
            const patterns = result.rows.map((row: any) => ({
                sector: row.sector || 'general',
                pattern: row.pattern,
                freq: parseInt(row.freq, 10),
            }));
            try {
                await pool.query(
                    `INSERT INTO sara_business_insights
                        (user_id, insight_type, insight_data, sample_size, generated_at, expires_at)
                     VALUES ($1, 'dream_pattern', $2::jsonb, $3, NOW(), NOW() + INTERVAL '30 days')
                     ON CONFLICT (user_id, insight_type) DO UPDATE
                        SET insight_data = EXCLUDED.insight_data,
                            sample_size  = EXCLUDED.sample_size,
                            generated_at = EXCLUDED.generated_at,
                            expires_at   = EXCLUDED.expires_at`,
                    [
                        SYSTEM_INSIGHT_USER_ID,
                        JSON.stringify({ window: '30 days', patterns }),
                        patterns.length,
                    ]
                );
            } catch (err: any) {
                console.error('[DREAM] Failed to persist dream_pattern insight:', err.message);
            }
        }

        return result.rows.length;
    } catch (err: any) {
        console.error('[DREAM] Pattern consolidation failed:', err.message);
        return 0;
    }
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── Main Dream Cycle Runner ───
export async function runDreamCycle(): Promise<DreamStats> {
    const stats: DreamStats = {
        questionsAnalyzed: 0,
        responsesCached: 0,
        embeddingsWarmed: 0,
        staleEntriesPurged: 0,
        patternsFound: 0,
        startedAt: new Date(),
    };

    console.log('[DREAM] ═══════════════════════════════════════');
    console.log('[DREAM] Dream cycle starting...');
    console.log('[DREAM] ═══════════════════════════════════════');

    // Phase 1: Analyze recent conversations
    console.log('[DREAM] Phase 1: Analyzing recent conversations...');
    const recentPatterns = await analyzeRecentConversations();
    stats.questionsAnalyzed = recentPatterns.length;
    console.log(`[DREAM] Phase 1 complete: ${recentPatterns.length} patterns found`);

    // Phase 2: Warm embeddings for docs without them
    console.log('[DREAM] Phase 2: Warming embeddings...');
    stats.embeddingsWarmed = await warmEmbeddings();
    console.log(`[DREAM] Phase 2 complete: ${stats.embeddingsWarmed} embeddings warmed`);

    // Phase 3: Pre-compute responses for real conversation patterns
    console.log('[DREAM] Phase 3: Pre-computing responses from conversation patterns...');
    const cachedFromPatterns = await precomputeResponses(recentPatterns, DREAM_BATCH_SIZE);
    stats.responsesCached += cachedFromPatterns;
    console.log(`[DREAM] Phase 3 complete: ${cachedFromPatterns} responses cached`);

    // Phase 4: Generate and cache template-based questions
    console.log('[DREAM] Phase 4: Pre-computing from templates...');
    const allTemplateQuestions: Array<{ question: string; sector: string; lang: string }> = [];
    const sectors = Object.keys(SECTOR_QUESTION_TEMPLATES);
    const langs = ['it', 'en', 'es', 'pt'];

    for (const sector of sectors) {
        for (const lang of langs) {
            const templateQs = await generateFromTemplates(sector, lang);
            allTemplateQuestions.push(...templateQs);
        }
    }

    const remaining = DREAM_BATCH_SIZE * 2 - cachedFromPatterns;
    if (remaining > 0 && allTemplateQuestions.length > 0) {
        const cachedFromTemplates = await precomputeResponses(allTemplateQuestions, remaining);
        stats.responsesCached += cachedFromTemplates;
        console.log(`[DREAM] Phase 4 complete: ${cachedFromTemplates} template responses cached`);
    }

    // Phase 5: Purge stale cache
    console.log('[DREAM] Phase 5: Purging stale cache...');
    stats.staleEntriesPurged = await purgeStaleCache();
    console.log(`[DREAM] Phase 5 complete: ${stats.staleEntriesPurged} stale entries purged`);

    // Phase 6: Consolidate patterns
    console.log('[DREAM] Phase 6: Consolidating conversation patterns...');
    stats.patternsFound = await consolidatePatterns();
    console.log(`[DREAM] Phase 6 complete: ${stats.patternsFound} patterns consolidated`);

    stats.finishedAt = new Date();
    const durationMs = stats.finishedAt.getTime() - stats.startedAt.getTime();

    console.log('[DREAM] ═══════════════════════════════════════');
    console.log(`[DREAM] Dream cycle complete in ${Math.round(durationMs / 1000)}s`);
    console.log(`[DREAM]   Questions analyzed: ${stats.questionsAnalyzed}`);
    console.log(`[DREAM]   Responses cached:   ${stats.responsesCached}`);
    console.log(`[DREAM]   Embeddings warmed:   ${stats.embeddingsWarmed}`);
    console.log(`[DREAM]   Stale purged:        ${stats.staleEntriesPurged}`);
    console.log(`[DREAM]   Patterns found:      ${stats.patternsFound}`);
    console.log('[DREAM] ═══════════════════════════════════════');

    return stats;
}

// ─── Scheduler: runs dream cycle during off-peak hours ───
let dreamTimer: ReturnType<typeof setInterval> | null = null;

export function startDreamScheduler(): void {
    if (dreamTimer) return;

    console.log(`[DREAM] Scheduler started: will run between ${DREAM_HOUR_START}:00-${DREAM_HOUR_END}:00`);

    // Check every 30 minutes if we're in the dream window
    dreamTimer = setInterval(async () => {
        const hour = new Date().getHours();
        if (hour >= DREAM_HOUR_START && hour < DREAM_HOUR_END) {
            // Guard: check if we already ran today. Kept in its OWN try so that a guard
            // failure can never prevent the cycle from running (it previously shared a try
            // with runDreamCycle(), so one bad SELECT killed the whole nightly cycle).
            try {
                const lastRun = await pool.query(
                    `SELECT 1 FROM sara_business_insights
                     WHERE insight_type = 'dream_cycle_complete'
                     AND generated_at > NOW() - INTERVAL '20 hours'
                     LIMIT 1`
                );
                if (lastRun.rows.length > 0) {
                    return; // Already ran today
                }
            } catch (err: any) {
                // Fail open: if we cannot tell whether we already ran, run anyway.
                console.error('[DREAM] Last-run guard failed, running cycle anyway:', err.message);
            }

            let stats: DreamStats;
            try {
                stats = await runDreamCycle();
            } catch (err: any) {
                console.error('[DREAM] Cycle error:', err.message);
                return;
            }

            // Log completion. UNIQUE (user_id, insight_type) means this is an upsert:
            // refreshing generated_at is what makes the 20h guard above work at all.
            try {
                await pool.query(
                    `INSERT INTO sara_business_insights
                        (user_id, insight_type, insight_data, sample_size, generated_at, expires_at)
                     VALUES ($1, 'dream_cycle_complete', $2::jsonb, $3, NOW(), NOW() + INTERVAL '7 days')
                     ON CONFLICT (user_id, insight_type) DO UPDATE
                        SET insight_data = EXCLUDED.insight_data,
                            sample_size  = EXCLUDED.sample_size,
                            generated_at = EXCLUDED.generated_at,
                            expires_at   = EXCLUDED.expires_at`,
                    [
                        SYSTEM_INSIGHT_USER_ID,
                        JSON.stringify({
                            responsesCached: stats.responsesCached,
                            embeddingsWarmed: stats.embeddingsWarmed,
                            staleEntriesPurged: stats.staleEntriesPurged,
                            patternsFound: stats.patternsFound,
                            questionsAnalyzed: stats.questionsAnalyzed,
                            startedAt: stats.startedAt.toISOString(),
                            finishedAt: stats.finishedAt?.toISOString() ?? null,
                        }),
                        stats.questionsAnalyzed,
                    ]
                );
            } catch (err: any) {
                console.error('[DREAM] Failed to record dream_cycle_complete:', err.message);
            }
        }
    }, 30 * 60 * 1000).unref(); // Check every 30 min
}

export function stopDreamScheduler(): void {
    if (dreamTimer) {
        clearInterval(dreamTimer);
        dreamTimer = null;
        console.log('[DREAM] Scheduler stopped');
    }
}
