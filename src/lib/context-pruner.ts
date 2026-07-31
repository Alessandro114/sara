// ═══════════════════════════════════════════════════
// Conversation context pruner
// ═══════════════════════════════════════════════════
// P1 fix 2026-04-12: we were shipping up to 30 messages to the LLM on every
// call. At 3 calls/message that's ~90 message-tokens of context per user
// turn — expensive and slow. This module picks the last-4 messages (always)
// plus the top-4 older messages by relevance to the current message.
// ═══════════════════════════════════════════════════

export interface ContextMessage {
    role: string;
    content: string;
    // Optional timestamp for chronological reordering. When absent we assume
    // the input array is already chronological.
    ts?: Date | number | string;
    created_at?: Date | number | string;
}

// Very conservative stopword set covering IT/EN/ES/PT + punctuation noise.
// Kept inline to avoid a dependency — good enough for a 4-8 token relevance
// score on short WhatsApp messages.
const STOPWORDS = new Set([
    // IT
    'il', 'lo', 'la', 'i', 'gli', 'le', 'un', 'una', 'uno', 'di', 'a', 'da', 'in',
    'con', 'su', 'per', 'tra', 'fra', 'e', 'o', 'ma', 'che', 'non', 'si', 'no',
    'io', 'tu', 'lui', 'lei', 'noi', 'voi', 'loro', 'come', 'cosa', 'più', 'mi',
    'ti', 'ci', 'vi', 'ne', 'ho', 'hai', 'ha', 'sono', 'sei', 'è', 'essere', 'al',
    'alla', 'del', 'della', 'dei', 'degli', 'delle',
    // EN
    'the', 'a', 'an', 'of', 'to', 'and', 'or', 'but', 'in', 'on', 'for', 'with',
    'at', 'by', 'from', 'as', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'i', 'you', 'he', 'she', 'it',
    'we', 'they', 'my', 'your', 'this', 'that', 'what', 'how',
    // ES
    'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'de', 'del', 'al',
    'y', 'o', 'pero', 'que', 'no', 'si', 'en', 'con', 'por', 'para', 'como',
    'yo', 'tu', 'el', 'ella', 'nosotros', 'vosotros', 'ellos',
    // PT
    'o', 'a', 'os', 'as', 'um', 'uma', 'uns', 'umas', 'de', 'do', 'da', 'dos',
    'das', 'no', 'na', 'nos', 'nas', 'ao', 'à', 'e', 'ou', 'mas', 'que', 'não',
    'eu', 'você', 'ele', 'ela', 'nós', 'vocês', 'eles', 'elas',
]);

function tokenize(text: string): Set<string> {
    const tokens = text
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .split(/\s+/)
        .filter(w => w.length >= 3 && !STOPWORDS.has(w));
    return new Set(tokens);
}

// Jaccard similarity on token sets. Cheap, deterministic, and does not need
// an embedding call — critical because we prune on every user message.
function jaccard(a: Set<string>, b: Set<string>): number {
    if (a.size === 0 || b.size === 0) return 0;
    let inter = 0;
    for (const t of a) if (b.has(t)) inter++;
    const union = a.size + b.size - inter;
    return union === 0 ? 0 : inter / union;
}

function tsToNumber(m: ContextMessage): number {
    const raw = m.ts ?? m.created_at;
    if (!raw) return 0;
    if (raw instanceof Date) return raw.getTime();
    if (typeof raw === 'number') return raw;
    const parsed = Date.parse(String(raw));
    return isNaN(parsed) ? 0 : parsed;
}

export interface PruneStats {
    original: number;
    kept: number;
    droppedOlder: number;
}

/**
 * Prune a conversation history down to the most relevant messages.
 *
 * Strategy:
 *   - Always keep the last `keepRecent` messages (default 4) — immediate
 *     context is never up for debate.
 *   - From the remaining older messages, pick the top `maxMessages-keepRecent`
 *     by Jaccard overlap with `currentMsg`.
 *   - Return the resulting set in chronological order.
 *
 * Designed to be O(n) so it can run inline with no caching.
 */
export function pruneContext<T extends ContextMessage>(
    messages: T[],
    currentMsg: string,
    maxMessages: number = 8,
    keepRecent: number = 4
): T[] {
    if (!messages || messages.length === 0) return [];
    if (messages.length <= maxMessages) return messages;

    // Ensure chronological order — older first. Callers (db.ts) already return
    // chronological, but we re-sort defensively for safety.
    const sorted = [...messages].sort((a, b) => tsToNumber(a) - tsToNumber(b));

    const recent = sorted.slice(-keepRecent);
    const older = sorted.slice(0, -keepRecent);

    const slotsForOlder = Math.max(0, maxMessages - recent.length);
    if (slotsForOlder === 0 || older.length === 0) {
        return recent;
    }

    const queryTokens = tokenize(currentMsg);
    const scored = older.map((msg, idx) => ({
        idx,
        msg,
        score: jaccard(queryTokens, tokenize(msg.content)),
    }));
    // Stable sort: highest score first, ties broken by most recent.
    scored.sort((a, b) => (b.score - a.score) || (b.idx - a.idx));

    const picked = scored.slice(0, slotsForOlder);
    // Rehydrate into chronological order so the LLM sees a coherent timeline.
    picked.sort((a, b) => a.idx - b.idx);

    return [...picked.map(p => p.msg), ...recent];
}

/**
 * Convenience helper that also returns a stats object for logging.
 */
export function pruneContextWithStats<T extends ContextMessage>(
    messages: T[],
    currentMsg: string,
    maxMessages: number = 8,
    keepRecent: number = 4
): { pruned: T[]; stats: PruneStats } {
    const pruned = pruneContext(messages, currentMsg, maxMessages, keepRecent);
    return {
        pruned,
        stats: {
            original: messages.length,
            kept: pruned.length,
            droppedOlder: Math.max(0, messages.length - pruned.length),
        },
    };
}
