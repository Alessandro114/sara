// ═══════════════════════════════════════════════════
// Shared text-classification patterns.
//
// Single source of truth: these regexes were previously duplicated verbatim
// in conversation-memory.ts and handlers/text.ts, and the copies had already
// drifted apart. Import from here instead of re-declaring inline.
//
// None of these carry the /g flag on purpose — they are used with .test()
// and .match(), where a sticky lastIndex would make results order-dependent.
// ═══════════════════════════════════════════════════

export type Sentiment = 'positive' | 'negative' | 'neutral';

export const SENTIMENT_POSITIVE =
    /\b(grazie|perfetto|ottimo|fantastico|great|thanks|excellent|amazing|bene|bravo|stupendo|wow)\b/i;

export const SENTIMENT_NEGATIVE =
    /\b(problema|difficolt|non funzion|frustrat|deluso|bad|terrible|issue|bug|lento|costoso|troppo caro|delusione|schifo)\b/i;

export const STYLE_TECHNICAL =
    /\b(kpi|roi|cac|ltv|api|sdk|saas|b2b|crm|erp|funnel|churn|retention)\b/i;

export const STYLE_FORMAL =
    /\b(egregio|gentile|cordiali saluti|distinti saluti|pregiat|spettabile)\b/i;

export const ROLE_KEYWORDS =
    /\b(ceo|founder|titolare|proprietario|owner|direttore|manager|responsabile|partner|socio|cto|cfo|coo|amministratore delegato|libero professionista|freelance)\b/i;

/** "SARA riprendi" and friends — hands the conversation back to the bot. */
export const RESUME_COMMAND = /^sara\s+(riprendi|resume|takeover|auto)/i;

/**
 * Positive wins over negative when a message contains both — a message like
 * "grazie, ma ho un problema" is a lead worth keeping warm, not a complaint.
 */
export function detectSentiment(text: string): Sentiment {
    const lower = text.toLowerCase();
    if (SENTIMENT_POSITIVE.test(lower)) return 'positive';
    if (SENTIMENT_NEGATIVE.test(lower)) return 'negative';
    return 'neutral';
}

/** Returns the matched role keyword, or null when the message states none. */
export function detectRole(text: string): string | null {
    const match = text.toLowerCase().match(ROLE_KEYWORDS);
    return match ? match[1] : null;
}
