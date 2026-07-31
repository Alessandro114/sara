// ═══════════════════════════════════════════════════
// L8 — Sentiment History Tracker
// Tracks sentiment trends per contact over time.
// Detects drops and flags for empathetic handling.
// ═══════════════════════════════════════════════════

import { pool } from '../config.js';

// ─── Sentiment Analysis (keyword-based, fast) ───

const POSITIVE_WORDS = new Set([
    'grazie', 'perfetto', 'ottimo', 'bene', 'fantastico', 'stupendo', 'bravo',
    'eccellente', 'meraviglioso', 'bellissimo', 'grande', 'wow', 'super',
    'thanks', 'great', 'excellent', 'amazing', 'perfect', 'wonderful', 'awesome',
    'love', 'fantastic', 'brilliant', 'outstanding',
    'genial', 'excelente', 'maravilloso', 'perfecto', 'estupendo',
    'obrigado', 'perfeito', 'excelente', 'maravilhoso',
]);

const NEGATIVE_WORDS = new Set([
    'problema', 'male', 'delusione', 'reclamo', 'schifo', 'terribile',
    'pessimo', 'orribile', 'inaccettabile', 'vergogna', 'furioso',
    'arrabbiato', 'frustrato', 'deluso', 'lento', 'costoso', 'troppo caro',
    'non funziona', 'rotto', 'difettoso', 'inutile',
    'bad', 'terrible', 'awful', 'horrible', 'unacceptable', 'disgusting',
    'angry', 'frustrated', 'disappointed', 'broken', 'useless',
    'problema', 'malo', 'terrible', 'horrible', 'inaceptable',
]);

/**
 * Analyze sentiment of a message. Returns 0.0-1.0 numeric score.
 */
export function analyzeSentiment(text: string): { score: number; intent: string | null } {
    const lower = text.toLowerCase();
    const words = lower.split(/[\s,.!?;:()\[\]{}"']+/);

    let positiveCount = 0;
    let negativeCount = 0;

    for (const w of words) {
        if (POSITIVE_WORDS.has(w)) positiveCount++;
        if (NEGATIVE_WORDS.has(w)) negativeCount++;
    }

    // Check multi-word negative phrases
    if (/non funziona|troppo caro|non va|fa schifo|doesn't work|too expensive/.test(lower)) {
        negativeCount += 2;
    }

    // Detect intent
    let intent: string | null = null;
    if (/\b(prezzo|costo|quanto|price|cost|how much|tariff)\b/.test(lower)) intent = 'pricing';
    else if (/\b(prenotare|appuntamento|booking|appointment|reserve|prenota)\b/.test(lower)) intent = 'booking';
    else if (/\b(info|informazioni|orari|apertura|hours|schedule|opening)\b/.test(lower)) intent = 'info';
    else if (/\b(reclamo|complaint|problema|issue|return|reso|rimborso|refund)\b/.test(lower)) intent = 'complaint';
    else if (/\b(help|aiuto|supporto|support|assistenza)\b/.test(lower)) intent = 'support';

    // Calculate score
    const total = positiveCount + negativeCount;
    if (total === 0) return { score: 0.5, intent }; // neutral

    if (negativeCount > 0 && positiveCount === 0) {
        return { score: Math.max(0.0, 0.3 - negativeCount * 0.1), intent };
    }
    if (positiveCount > 0 && negativeCount === 0) {
        return { score: Math.min(1.0, 0.7 + positiveCount * 0.1), intent };
    }

    // Mixed
    const ratio = positiveCount / (positiveCount + negativeCount);
    return { score: Math.round(ratio * 100) / 100, intent };
}

/**
 * Log sentiment for a contact. Fire-and-forget.
 */
export function logSentiment(userId: string | null, phone: string, text: string): void {
    const { score, intent } = analyzeSentiment(text);

    pool.query(
        `INSERT INTO sara_sentiment_log (user_id, phone, sentiment, intent, timestamp)
         VALUES ($1, $2, $3, $4, NOW())`,
        [userId, phone, score, intent]
    ).catch(err => console.error('[L8] logSentiment error:', err.message));

    // Update running average on wa_client_profiles (if column exists)
    pool.query(
        `UPDATE wa_client_profiles SET
            sentiment_avg = COALESCE(
                (sentiment_avg * total_interactions + $2) / (total_interactions + 1),
                $2
            )
         WHERE phone = $1`,
        [phone, score]
    ).catch(() => { /* column may not exist yet — silently ignore */ });
}

/**
 * Check if sentiment is dropping for this contact.
 * Returns 'dropping' if last 3 messages show >0.3 drop, null otherwise.
 */
export async function getSentimentTrend(phone: string): Promise<{ trend: string | null; avg: number | null }> {
    try {
        const r = await pool.query(
            `SELECT sentiment FROM sara_sentiment_log
             WHERE phone = $1
             ORDER BY timestamp DESC LIMIT 6`,
            [phone]
        );

        if (r.rows.length < 3) return { trend: null, avg: null };

        const scores = r.rows.map((row: any) => parseFloat(row.sentiment));
        const recent3 = scores.slice(0, 3);
        const older3 = scores.slice(3, 6);
        const recentAvg = recent3.reduce((a, b) => a + b, 0) / recent3.length;

        if (older3.length >= 2) {
            const olderAvg = older3.reduce((a, b) => a + b, 0) / older3.length;
            if (olderAvg - recentAvg > 0.3) {
                return { trend: 'dropping', avg: Math.round(recentAvg * 100) / 100 };
            }
        }

        // Classify overall trend
        const allAvg = scores.reduce((a, b) => a + b, 0) / scores.length;
        let trend: string | null = null;
        if (allAvg >= 0.7) trend = 'positive';
        else if (allAvg <= 0.3) trend = 'negative';
        else trend = 'neutral';

        return { trend, avg: Math.round(allAvg * 100) / 100 };
    } catch (err: any) {
        console.error('[L8] getSentimentTrend error:', err.message);
        return { trend: null, avg: null };
    }
}

/**
 * Build sentiment context string for prompt injection.
 */
export async function getSentimentContext(phone: string): Promise<string> {
    try {
        const { trend, avg } = await getSentimentTrend(phone);
        if (!trend) return '';

        const parts: string[] = [];
        if (trend === 'dropping') {
            parts.push(`[SENTIMENT ALERT] This contact's sentiment is DROPPING (avg: ${avg}). Be extra careful, empathetic, and proactive in resolving concerns.`);
        } else if (trend === 'negative') {
            parts.push(`[SENTIMENT] Contact tends to be dissatisfied (avg: ${avg}). Use empathetic tone, ask about concerns.`);
        } else if (trend === 'positive') {
            parts.push(`[SENTIMENT] Contact is generally satisfied (avg: ${avg}). Good candidate for upsells/referrals.`);
        }

        return parts.join('\n');
    } catch {
        return '';
    }
}
