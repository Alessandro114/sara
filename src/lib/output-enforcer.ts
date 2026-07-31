// ═══════════════════════════════════════════════════
// S.A.R.A. output enforcer — persona rules, applied AFTER generation
// ═══════════════════════════════════════════════════
// P1 fix 2026-04-12: the system prompt says "MAX 60-80 words", "max 1 emoji",
// "no markdown", but the LLM ignores these ~40% of the time. Regenerating
// is expensive and slow on WhatsApp — instead we truncate/strip at the edge.
// ═══════════════════════════════════════════════════

import pino from 'pino';

const log = pino({ name: 'output-enforcer', level: 'info' });

// Unicode-aware emoji matcher. `\p{Extended_Pictographic}` catches the common
// smiley+symbol set without also eating digits or ASCII punctuation.
const EMOJI_RE = /\p{Extended_Pictographic}/gu;

// Sentence-end anchors — we try to cut on the last one before the word limit
// so the truncation doesn't chop mid-thought.
const SENTENCE_END_RE = /[.!?…](?:\s|$)/g;

function countWords(text: string): number {
    const trimmed = text.trim();
    if (!trimmed) return 0;
    return trimmed.split(/\s+/).length;
}

// Truncate to at most `maxWords`, preferring to cut at the last sentence end
// before the limit. If no sentence end exists, cut cleanly on a word boundary
// and add an ellipsis to signal the hard break.
function truncateToWords(text: string, maxWords: number): string {
    const words = text.trim().split(/\s+/);
    if (words.length <= maxWords) return text;

    const candidate = words.slice(0, maxWords).join(' ');

    // Find the last sentence terminator within the candidate — cut there.
    let lastEnd = -1;
    let m: RegExpExecArray | null;
    const re = new RegExp(SENTENCE_END_RE.source, 'g');
    while ((m = re.exec(candidate)) !== null) {
        lastEnd = m.index + 1; // include the terminator itself
    }
    if (lastEnd >= maxWords * 2) {
        return candidate.slice(0, lastEnd).trim();
    }
    // No graceful cut point — add ellipsis so the user understands it was cut.
    return candidate.trim().replace(/[,;:]+$/, '') + '…';
}

// Remove markdown emphasis when it dominates the message. We don't strip
// single emphasis runs because short bolding is legitimate — but when
// >10% of the text is inside `**` or `*`, the result looks robotic.
function stripExcessMarkdown(text: string): string {
    const emphasised = [...text.matchAll(/\*\*[^*]+\*\*|\*[^*]+\*|__[^_]+__|_[^_]+_/g)]
        .reduce((sum, match) => sum + match[0].length, 0);
    const total = text.length;
    if (total === 0) return text;
    if (emphasised / total < 0.1) return text;

    return text
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/__([^_]+)__/g, '$1')
        .replace(/\*([^*]+)\*/g, '$1')
        .replace(/_([^_]+)_/g, '$1');
}

// Keep at most `max` emoji — drop the rest. Preserves order.
function capEmoji(text: string, max: number): string {
    let kept = 0;
    return text.replace(EMOJI_RE, (ch) => {
        kept++;
        return kept <= max ? ch : '';
    }).replace(/\s{2,}/g, ' ').trim();
}

/**
 * Apply persona rules to a generated message before sending it.
 * - Cap at `maxWords` (default 80) with clean sentence-end truncation.
 * - Strip markdown emphasis when it dominates the text.
 * - Keep at most 3 emoji per message.
 */
export function enforcePersonaRules(text: string, maxWords: number = 80): string {
    if (!text) return text;

    let out = text;

    // 1. Markdown emphasis — fix before counting words so word count is accurate.
    out = stripExcessMarkdown(out);

    // 2. Emoji cap.
    out = capEmoji(out, 3);

    // 3. Word limit — the last step so we don't count markdown chars.
    const wc = countWords(out);
    if (wc > maxWords) {
        const truncated = truncateToWords(out, maxWords);
        log.debug({ originalWords: wc, maxWords, droppedWords: wc - countWords(truncated) }, 'enforced word limit');
        out = truncated;
    }

    return out.trim();
}
