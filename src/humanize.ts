// ═══════════════════════════════════════════════════
// SCALA WhatsApp Bot — Human-Like Messaging (v4)
// ═══════════════════════════════════════════════════
// Ultra-realistic human behavior:
// - "Read" pause (1.5-4s) before typing starts
// - Typing delays PROPORTIONAL to message length (5-15s)
// - Aggressive splitting: 120 chars threshold, up to 4 chunks
// - Chunk delays 3-6s (simulates "thinking before next part")
// ═══════════════════════════════════════════════════
// Use adapter's SockLike interface
type WASocket = any;
import { logMessage } from './db.js';

// ── Plan-price hallucination guard ──
// The LLM sometimes quotes a wrong price for a SCALA plan even when the correct
// figure is in context (observed: "Growth €149/mese", "Starter €49: 2 utenti").
// Authoritative monthly prices: Growth €97, Scale €197, SOLO SARA €9,90, Free €0.
// "Starter" is NOT a SCALA plan — it is the dead name of the entry paid tier
// (legacy €49), so it is normalized to Growth €97.
//
// ── Why this does not mangle third-party price lists ──
// SARA also answers from tenant knowledge bases (e.g. a client selling sofas at
// €490, or ladders — "scale" is a common Italian noun). Three limits keep the
// guard inside SCALA territory:
//   1. A price is only ever touched when a plan NAME sits before it. "divani a
//      €490" has no plan name, so it can never match.
//   2. Two match strengths, deliberately asymmetric:
//        • a "/mese"-style suffix is a strong signal on its own → the original
//          loose 45-char window is kept, ungated (legacy behaviour, unchanged);
//        • WITHOUT a month suffix the price must be glued to the plan name
//          (max 6 chars of separators — "Starter €49" ✓, "to scale your
//          business, plans start at €97" ✗) AND the message must contain SCALA
//          plan vocabulary. Both conditions, not either.
//   3. Annual prices are explicitly protected: €970/anno and €1.970/anno are
//      legitimate, so a price followed by a year unit is never rewritten.
const MONTH = '(\\s*(?:/|per\\s+|al\\s+|par\\s+|pro\\s+)?\\s*(?:mes(?:e|es)?|months?|mo|mois|monats?|m[êe]s)\\b)';
const PRICE = '€\\s?\\d{1,4}(?:[.,]\\d{1,3})?';
// Guard against rewriting the legitimate annual figures (€970/anno, €1970/year).
const NOT_YEAR = '(?!\\s*(?:/|per\\s+|al\\s+|a\\s+|pro\\s+)?\\s*(?:ann[oi]|añ[oa]s?|years?|yr|jahr)\\b)';
const LOOSE_GAP = '[^.\\n€]{0,45}?';
const TIGHT_GAP = '[ \\t—–\\-:()]{0,6}';
// Plan vocabulary — proof we are talking about SCALA subscriptions and not a
// tenant's own catalogue. Plan NAMES are deliberately excluded from this list:
// including them would make the check circular.
const SCALA_CONTEXT = /\b(?:scala|s\.c\.a\.l\.a|sara|pian[oi]|plans?|planes?|planos?|abbonament\w*|subscription|utent[ie]|users?|usuari\w*|verticali?|verticals?|verticais|verticales|credits?|crediti|creditos|trial)\b/i;
const PLAN_PRICES: Array<[string, string]> = [
    ['Growth', '97'],
    ['Scale', '197'],
    ['SOLO\\s?SARA', '9,90'],
];

export function guardPlanPrices(text: string): string {
    if (!text || typeof text !== 'string') return text;
    const scalaCtx = SCALA_CONTEXT.test(text);

    const rewrite = (s: string, name: string, right: string, gap: string, suffixRequired: boolean): string =>
        s.replace(
            new RegExp(
                '(\\b' + name + '\\b' + gap + ')' + PRICE + NOT_YEAR +
                (suffixRequired ? MONTH : '(?:' + MONTH + ')?'),
                'gi'
            ),
            (m, pre, suf) => {
                // Suffix-less rewrites only fire inside explicit SCALA plan talk.
                if (!suffixRequired && !scalaCtx) return m;
                return pre + '€' + right + (suf || '');
            }
        );

    let t = text;

    // Phantom plan: "Starter" does not exist. Normalize name AND price.
    t = t.replace(
        new RegExp('\\bStarter\\b(' + TIGHT_GAP + ')' + PRICE + NOT_YEAR + '(?:' + MONTH + ')?', 'gi'),
        (m, pre, suf) => (scalaCtx ? 'Growth' + pre + '€97' + (suf || '') : m)
    );
    // "Free" is €0. Tight gap only: it must be a plan label sitting on a price,
    // never the adjective in "free trial on GROWTH (€97/mo)".
    t = t.replace(
        new RegExp('(\\bFree\\b' + TIGHT_GAP + ')' + PRICE + NOT_YEAR + '(?:' + MONTH + ')?', 'gi'),
        (m, pre, suf) => (scalaCtx ? pre + '€0' + (suf || '') : m)
    );

    for (const [plan, right] of PLAN_PRICES) {
        t = rewrite(t, plan, right, LOOSE_GAP, true);   // strong signal: month suffix
        t = rewrite(t, plan, right, TIGHT_GAP, false);  // suffix-less, context-gated
    }
    return t;
}

/**
 * Simulate a human "reading" the incoming message before starting to type.
 */
export function readDelay(): number {
    return Math.round(1500 + Math.random() * 2500); // 1.5 - 4s
}

/**
 * Calculate a human-like typing delay in ms based on text length.
 * A real human types ~40 WPM on a phone = ~120ms per word.
 * Range: 4s minimum, 15s maximum. Longer messages = much longer wait.
 */
export function humanDelay(text: string): number {
    const words = text.split(/\s+/).length;
    // ~120ms per word (phone typing speed), min 4s, max 15s
    const base = Math.min(15000, Math.max(4000, words * 120));
    const jitter = Math.random() * 2000 - 500; // -500 to +1500ms
    return Math.round(base + jitter);
}

/**
 * Delay between split message chunks.
 * Simulates "pausing to think, then typing next part".
 */
export function chunkDelay(): number {
    return Math.round(3000 + Math.random() * 3000); // 3 - 6s
}

/**
 * Aggressively split AI responses into 2-4 natural WhatsApp-sized chunks.
 * Threshold: 120 chars. A real WhatsApp message is usually 1-3 lines.
 */
export function splitMessage(text: string): string[] {
    const cleanText = text.trim();

    // Very short messages: send as-is
    if (cleanText.length <= 120) return [cleanText];

    // Try splitting at double newlines (paragraphs) first
    const paragraphs = cleanText.split(/\n\n+/).filter(p => p.trim());

    if (paragraphs.length >= 2) {
        // Each paragraph becomes its own message (up to 4)
        if (paragraphs.length <= 4) return paragraphs.map(p => p.trim());

        // 5+ paragraphs: group into 3-4 chunks
        if (paragraphs.length <= 8) {
            const chunkSize = Math.ceil(paragraphs.length / 3);
            const chunks: string[] = [];
            for (let i = 0; i < paragraphs.length; i += chunkSize) {
                chunks.push(paragraphs.slice(i, i + chunkSize).join('\n\n').trim());
            }
            return chunks;
        }

        // 9+ paragraphs: group into 4 chunks
        const chunkSize = Math.ceil(paragraphs.length / 4);
        const chunks: string[] = [];
        for (let i = 0; i < paragraphs.length; i += chunkSize) {
            chunks.push(paragraphs.slice(i, i + chunkSize).join('\n\n').trim());
        }
        return chunks;
    }

    // Single paragraph but long: split at sentence boundaries
    const sentences = cleanText.match(/[^.!?]+[.!?]+/g);
    if (sentences && sentences.length >= 2) {
        // Group sentences into chunks of ~120 chars
        const chunks: string[] = [];
        let current = '';
        for (const sentence of sentences) {
            if (current.length + sentence.length > 150 && current.length > 0) {
                chunks.push(current.trim());
                current = sentence;
            } else {
                current += sentence;
            }
        }
        if (current.trim()) chunks.push(current.trim());
        // Cap at 4 chunks
        if (chunks.length > 4) {
            const merged: string[] = [];
            const perChunk = Math.ceil(chunks.length / 4);
            for (let i = 0; i < chunks.length; i += perChunk) {
                merged.push(chunks.slice(i, i + perChunk).join(' ').trim());
            }
            return merged;
        }
        return chunks;
    }

    // Fallback for very long single-sentence text: split at comma or mid-point
    if (cleanText.length > 200) {
        const mid = Math.floor(cleanText.length / 2);
        // Find nearest comma, semicolon, or space near midpoint
        let splitPoint = -1;
        for (let offset = 0; offset < 50; offset++) {
            const pos = mid + offset;
            const negPos = mid - offset;
            if (pos < cleanText.length && /[,;]/.test(cleanText[pos])) { splitPoint = pos + 1; break; }
            if (negPos >= 0 && /[,;]/.test(cleanText[negPos])) { splitPoint = negPos + 1; break; }
        }
        if (splitPoint === -1) {
            // Find nearest space
            for (let offset = 0; offset < 30; offset++) {
                if (mid + offset < cleanText.length && cleanText[mid + offset] === ' ') { splitPoint = mid + offset + 1; break; }
                if (mid - offset >= 0 && cleanText[mid - offset] === ' ') { splitPoint = mid - offset + 1; break; }
            }
        }
        if (splitPoint > 0) {
            return [cleanText.substring(0, splitPoint).trim(), cleanText.substring(splitPoint).trim()];
        }
    }

    return [cleanText];
}

/**
 * Send a response in a human-like way:
 * 1. Pause as if reading the incoming message
 * 2. Show "composing" indicator
 * 3. Wait PROPORTIONALLY to message length (4-15s)
 * 4. Split into 2-4 chunks with 3-6s delays between them
 * 5. Log each outgoing message
 */
export async function sendHumanized(
    sock: WASocket,
    phone: string,
    fullText: string,
    mediaType: string = 'text'
): Promise<void> {
    fullText = guardPlanPrices(fullText);
    const chunks = splitMessage(fullText);

    for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];

        // First chunk: add a "reading" pause before typing
        if (i === 0) {
            await new Promise(resolve => setTimeout(resolve, readDelay()));
        }

        // Show typing indicator ("sta scrivendo...")
        try {
            await sock.sendPresenceUpdate('composing', phone);
        } catch { /* ignore presence errors */ }

        // Wait proportional to THIS chunk's length
        const delay = humanDelay(chunk);
        await new Promise(resolve => setTimeout(resolve, delay));

        // Send the chunk
        await sock.sendMessage(phone, { text: chunk });
        await logMessage(phone, 'out', chunk, mediaType);

        // Between chunks: pause composing, then restart
        if (i < chunks.length - 1) {
            try {
                await sock.sendPresenceUpdate('paused', phone);
            } catch { /* ignore */ }
            // "Thinking" pause before typing next chunk
            await new Promise(resolve => setTimeout(resolve, chunkDelay()));
        }
    }
}
