// ═══════════════════════════════════════════════════════════
// S.C.A.L.A. PII Anonymizer — Strip personal data before LLM calls
// Enterprise requirement: HomePanda, Semeraro
// ═══════════════════════════════════════════════════════════

export interface PIIMap {
    originals: Map<string, string>; // placeholder → original
    anonymized: string;
}

/**
 * Anonymize PII in text before sending to external AI providers.
 * Replaces emails, phone numbers, fiscal codes, and name-like patterns
 * with reversible placeholders.
 */
export function anonymizePII(text: string): PIIMap {
    const originals = new Map<string, string>();
    let anonymized = text;
    const counter = { name: 0, phone: 0, email: 0, fiscal: 0, iban: 0 };

    // Email pattern
    anonymized = anonymized.replace(/[\w.+-]+@[\w.-]+\.\w{2,}/g, (match) => {
        const placeholder = `[EMAIL_${++counter.email}]`;
        originals.set(placeholder, match);
        return placeholder;
    });

    // Italian fiscal code (Codice Fiscale) — 16 chars: 6 letters + 2 digits + 1 letter + 2 digits + 1 letter + 3 digits + 1 letter
    anonymized = anonymized.replace(/\b[A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]\b/gi, (match) => {
        const placeholder = `[CF_${++counter.fiscal}]`;
        originals.set(placeholder, match);
        return placeholder;
    });

    // IBAN (Italian and EU)
    anonymized = anonymized.replace(/\b[A-Z]{2}\d{2}\s?[A-Z0-9]{4}\s?[\dA-Z\s]{10,30}\b/g, (match) => {
        // Only match if it looks like an IBAN (starts with country code + 2 digits)
        if (/^[A-Z]{2}\d{2}/.test(match) && match.replace(/\s/g, '').length >= 15) {
            const placeholder = `[IBAN_${++counter.iban}]`;
            originals.set(placeholder, match);
            return placeholder;
        }
        return match;
    });

    // Italian phone patterns (+39, 3xx, 0xx) — must come after email to avoid matching email local parts
    anonymized = anonymized.replace(/(?<!\w)(\+39[\s.-]?)?[03]\d{1,3}[\s.-]?\d{3}[\s.-]?\d{3,5}(?!\w)/g, (match) => {
        // Require minimum length to avoid false positives
        const digits = match.replace(/\D/g, '');
        if (digits.length < 8) return match;
        const placeholder = `[TEL_${++counter.phone}]`;
        originals.set(placeholder, match);
        return placeholder;
    });

    // P.IVA (Italian VAT number — 11 digits after optional IT prefix)
    anonymized = anonymized.replace(/\b(?:IT)?\d{11}\b/g, (match) => {
        // Only if it looks like a VAT (not a random 11-digit number in context)
        if (/^\d{11}$/.test(match) || /^IT\d{11}$/.test(match)) {
            const placeholder = `[PIVA_${++counter.fiscal}]`;
            originals.set(placeholder, match);
            return placeholder;
        }
        return match;
    });

    // Names (2+ consecutive capitalized words, excluding known non-name patterns)
    const NON_NAMES = /^(Via|Viale|Corso|Piazza|Piazzale|Largo|Milano|Roma|Torino|Napoli|Firenze|Bologna|Genova|Palermo|Catania|Bari|Venezia|Verona|Padova|Italia|Italy|France|Germany|Spain|SCALA|SARA|WhatsApp|Google|Microsoft|Apple|Facebook|Meta|Stripe|Amazon|Process Analyzer|Balance Sheet|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|January|February|March|April|May|June|July|August|September|October|November|December|Gennaio|Febbraio|Marzo|Aprile|Maggio|Giugno|Luglio|Agosto|Settembre|Ottobre|Novembre|Dicembre)$/i;
    anonymized = anonymized.replace(/\b([A-Z\u00C0-\u00DC][a-z\u00E0-\u00FC]{2,}(?:\s+[A-Z\u00C0-\u00DC][a-z\u00E0-\u00FC]{2,})+)\b/g, (match) => {
        // Skip common non-name patterns and single-word matches
        if (NON_NAMES.test(match)) return match;
        // Skip if any word is a known non-name
        const words = match.split(/\s+/);
        if (words.some(w => NON_NAMES.test(w))) return match;
        // Only anonymize 2-4 word sequences (likely names)
        if (words.length > 4) return match;
        const placeholder = `[NOME_${++counter.name}]`;
        originals.set(placeholder, match);
        return placeholder;
    });

    return { originals, anonymized };
}

/**
 * Restore original PII from placeholders in AI response text.
 */
export function deanonymize(text: string, map: Map<string, string>): string {
    let result = text;
    for (const [placeholder, original] of map) {
        result = result.replaceAll(placeholder, original);
    }
    return result;
}
