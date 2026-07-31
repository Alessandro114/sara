// ═══════════════════════════════════════════════════════════
// fact-predigest.ts — Pre-digest KB docs into structured JSON
// ═══════════════════════════════════════════════════════════
// When a KB document is inserted or updated, pre-extract ALL facts
// into a JSON column. At query time, read the JSON instead of
// running regex — instant, deterministic, zero-cost.

import { pool } from '../config.js';

export interface ExtractedFact {
    key: string;
    value: string;
    unit?: string;
    lang?: string;
}

export interface DigestedDoc {
    id: string;
    title: string;
    sector: string;
    facts: ExtractedFact[];
    digestedAt: string;
}

// Universal price patterns (all languages)
const PRICE_PATTERNS = [
    /(?:prezzo|precio|preço|price|preis)[:\s]*(?:da\s+)?(?:€\s*)?(\d[\d.,]*)\s*(EUR|€|USD|\$|CHF)?/gi,
    /(?:€\s*)(\d[\d.,]*)/g,
    /(\d[\d.,]*)\s*(?:EUR|€)/g,
    /(?:costo|cost|coste|custo|kosten)[:\s]*(?:da\s+)?(?:€\s*)?(\d[\d.,]*)\s*(EUR|€)?/gi,
    /(?:tariffa|tarifa|tariff|fee|taxa)[:\s]*(?:€\s*)?(\d[\d.,]*)\s*(EUR|€)?/gi,
];

// Measurement patterns
const MEASURE_PATTERNS = {
    area: /(\d[\d.,]*)\s*(?:mq|m²|sqm|square\s*met)/gi,
    rooms: /(\d+)\s*(?:locali|rooms?|habitacion|cômodo|stanz|zimmer|vani)/gi,
    bathrooms: /(\d+)\s*(?:bagn[io]|bathroom|baño|banheir|bad)/gi,
    bedrooms: /(\d+)\s*(?:camer[ea]|bedroom|dormitorio|quarto|schlafzimmer)/gi,
    floor: /(?:piano|floor|planta|andar|stockwerk)\s*(\d+)/gi,
    year: /(?:anno|year|año|ano|jahr)\s*(?:di\s*)?(?:costruzione|built|construcción|construção|bau)?\s*(\d{4})/gi,
};

// Service-specific patterns
const SERVICE_PATTERNS: Record<string, Array<{ key: string; pattern: RegExp }>> = {
    dermatologia: [
        { key: 'BOTOX', pattern: /botox[:\s]*(?:€\s*)?(\d[\d.,]*)/gi },
        { key: 'FILLER', pattern: /filler[:\s]*(?:€\s*)?(\d[\d.,]*)/gi },
        { key: 'PEELING', pattern: /peeling[:\s]*(?:€\s*)?(\d[\d.,]*)/gi },
        { key: 'LASER', pattern: /laser[:\s]*(?:€\s*)?(\d[\d.,]*)/gi },
        { key: 'EPILAZIONE', pattern: /epilazion[ei][:\s]*(?:€\s*)?(\d[\d.,]*)/gi },
    ],
    automotive: [
        { key: 'TAGLIANDO', pattern: /tagliando[:\s]*(?:€\s*)?(\d[\d.,]*)/gi },
        { key: 'REVISIONE', pattern: /revision[ei][:\s]*(?:€\s*)?(\d[\d.,]*)/gi },
        { key: 'GOMME', pattern: /(?:gomme|pneumatici|tyre|tire)[:\s]*(?:€\s*)?(\d[\d.,]*)/gi },
        { key: 'MOT', pattern: /(?:mot|itv|revisão)[:\s]*(?:€\s*)?(\d[\d.,]*)/gi },
    ],
    waste: [
        { key: 'TARI_1P', pattern: /(?:tari|tassa).{0,20}1\s*person[ae]?[:\s]*(?:€\s*)?(\d[\d.,]*)/gi },
        { key: 'TARI_2P', pattern: /(?:tari|tassa).{0,20}2\s*person[ae]?[:\s]*(?:€\s*)?(\d[\d.,]*)/gi },
        { key: 'TARI_3P', pattern: /(?:tari|tassa).{0,20}3\s*person[ae]?[:\s]*(?:€\s*)?(\d[\d.,]*)/gi },
    ],
    ristorante: [
        { key: 'MENU_DEGUSTAZIONE', pattern: /(?:menu|menù)\s*(?:degustazione|tasting)[:\s]*(?:€\s*)?(\d[\d.,]*)/gi },
        { key: 'COPERTO', pattern: /coperto[:\s]*(?:€\s*)?(\d[\d.,]*)/gi },
    ],
    franchise: [
        { key: 'FEE_INGRESSO', pattern: /(?:fee|quota)\s*(?:di\s*)?(?:ingresso|entry|entrada)[:\s]*(?:€\s*)?(\d[\d.,]*)/gi },
        { key: 'ROYALTY', pattern: /royalt[yies][:\s]*(?:€\s*)?(\d[\d.,]*)/gi },
    ],
    wellness: [
        { key: 'ABBONAMENTO', pattern: /(?:abbonamento|membership|suscripción)[:\s]*(?:€\s*)?(\d[\d.,]*)/gi },
        { key: 'PERSONAL_TRAINER', pattern: /(?:personal\s*trainer|pt)[:\s]*(?:€\s*)?(\d[\d.,]*)/gi },
    ],
    service: [
        { key: 'INTERVENTO', pattern: /(?:intervento|intervention|call-out)[:\s]*(?:€\s*)?(\d[\d.,]*)/gi },
        { key: 'CONTRATTO_ANNUALE', pattern: /(?:contratto|contract).{0,20}(?:annual|annuo)[:\s]*(?:€\s*)?(\d[\d.,]*)/gi },
    ],
};

// Extract energy class for real estate
const ENERGY_CLASS_PATTERN = /(?:classe\s*energetica|energy\s*class|clase\s*energética)[:\s]*([A-G][1-4]?[+]?)/gi;

function extractAllFacts(content: string, sector: string): ExtractedFact[] {
    const facts: ExtractedFact[] = [];
    const seen = new Set<string>();

    function addFact(key: string, value: string, unit?: string) {
        const dedup = `${key}:${value}`;
        if (seen.has(dedup)) return;
        seen.add(dedup);
        facts.push({ key, value, unit });
    }

    // Universal prices
    for (const pattern of PRICE_PATTERNS) {
        pattern.lastIndex = 0;
        let match;
        while ((match = pattern.exec(content)) !== null) {
            const value = match[1] || match[2];
            const unit = match[2] || match[3] || 'EUR';
            if (value && /\d/.test(value)) {
                addFact('PREZZO', value, unit === '$' ? 'USD' : unit === '€' ? 'EUR' : unit);
            }
        }
    }

    // Measurements
    for (const [key, pattern] of Object.entries(MEASURE_PATTERNS)) {
        pattern.lastIndex = 0;
        let match;
        while ((match = pattern.exec(content)) !== null) {
            addFact(key.toUpperCase(), match[1], key === 'area' ? 'mq' : undefined);
        }
    }

    // Energy class
    ENERGY_CLASS_PATTERN.lastIndex = 0;
    const energyMatch = ENERGY_CLASS_PATTERN.exec(content);
    if (energyMatch) addFact('CLASSE_ENERGETICA', energyMatch[1]);

    // Sector-specific patterns
    const sectorPatterns = SERVICE_PATTERNS[sector];
    if (sectorPatterns) {
        for (const { key, pattern } of sectorPatterns) {
            pattern.lastIndex = 0;
            let match;
            while ((match = pattern.exec(content)) !== null) {
                addFact(key, match[1], 'EUR');
            }
        }
    }

    return facts;
}

// Pre-digest a single document and store facts in DB
export async function digestDocument(docId: string): Promise<ExtractedFact[]> {
    try {
        const result = await pool.query(
            'SELECT id, title, content, sector FROM wa_rag_documents WHERE id = $1',
            [docId]
        );
        if (result.rows.length === 0) return [];

        const doc = result.rows[0];
        const facts = extractAllFacts(`${doc.title}\n${doc.content}`, doc.sector);

        await pool.query(
            `UPDATE wa_rag_documents SET facts_json = $1 WHERE id = $2`,
            [JSON.stringify(facts), docId]
        );

        console.log(`[PREDIGEST] "${doc.title}" → ${facts.length} facts extracted`);
        return facts;
    } catch (err: any) {
        console.error(`[PREDIGEST] Error for doc ${docId}:`, err.message);
        return [];
    }
}

// Digest ALL documents that don't have facts_json yet
export async function digestAllPending(): Promise<number> {
    let total = 0;
    try {
        const docs = await pool.query(
            'SELECT id FROM wa_rag_documents WHERE facts_json IS NULL LIMIT 100'
        );
        for (const doc of docs.rows) {
            await digestDocument(doc.id);
            total++;
        }
        if (total > 0) console.log(`[PREDIGEST] Digested ${total} documents`);
    } catch (err: any) {
        console.error('[PREDIGEST] Batch error:', err.message);
    }
    return total;
}

// Get pre-digested facts for a document (instant lookup, no regex at runtime)
export async function getPredigestedFacts(docId: string): Promise<ExtractedFact[]> {
    try {
        const result = await pool.query(
            'SELECT facts_json FROM wa_rag_documents WHERE id = $1 AND facts_json IS NOT NULL',
            [docId]
        );
        if (result.rows.length > 0 && result.rows[0].facts_json) {
            return typeof result.rows[0].facts_json === 'string'
                ? JSON.parse(result.rows[0].facts_json)
                : result.rows[0].facts_json;
        }
    } catch { /* fallback to runtime extraction */ }
    return [];
}

// Build a facts prompt from pre-digested data (same format as fact-extractor.ts)
export function buildFactsFromDigested(facts: ExtractedFact[]): string {
    if (facts.length === 0) return '';

    const lines = facts.map(f =>
        `• ${f.key}: ${f.value}${f.unit ? ` ${f.unit}` : ''}`
    );

    return `═══ FATTI PRE-ESTRATTI (COPIA ESATTAMENTE) ═══\n${lines.join('\n')}\n═══════════════════════════════════════════\nQUESTI NUMERI SONO IMMUTABILI. Non arrotondare, non modificare, non inventare.`;
}

// Ensure the facts_json column exists
export async function ensureFactsColumn(): Promise<void> {
    try {
        await pool.query(`
            ALTER TABLE wa_rag_documents ADD COLUMN IF NOT EXISTS facts_json JSONB DEFAULT NULL
        `);
    } catch (err: any) {
        console.warn('[PREDIGEST] Column ensure failed (non-fatal):', err.message);
    }
}

export { extractAllFacts };
