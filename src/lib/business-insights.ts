// ═══════════════════════════════════════════════════
// L7 — Cross-contact Business Insights
// Learns patterns across ALL contacts for a single business.
// Runs as background job, NOT on every message.
// ═══════════════════════════════════════════════════

import { pool } from '../config.js';

// ─── Types ───

export interface BusinessInsight {
    insight_type: string;
    insight_data: any;
    confidence: number;
    sample_size: number;
}

// ─── Message counter for triggering refresh ───
const messageCounters = new Map<string, number>();
const lastRefresh = new Map<string, number>();
const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000; // 1 day
const REFRESH_MESSAGE_THRESHOLD = 100;

/**
 * Called after each message. Checks if insights should be refreshed.
 * Fire-and-forget — never blocks message flow.
 */
export function maybeRefreshInsights(userId: string): void {
    if (!userId) return;

    const count = (messageCounters.get(userId) || 0) + 1;
    messageCounters.set(userId, count);

    const lastTime = lastRefresh.get(userId) || 0;
    const now = Date.now();
    const shouldRefresh = count >= REFRESH_MESSAGE_THRESHOLD || (now - lastTime > REFRESH_INTERVAL_MS);

    if (shouldRefresh) {
        messageCounters.set(userId, 0);
        lastRefresh.set(userId, now);
        refreshInsights(userId).catch(err => console.error('[L7] refreshInsights error:', err.message));
    }
}

/**
 * Refresh all business insights for a given user (business owner).
 * Calculates peak hours, common questions, and conversion triggers.
 */
export async function refreshInsights(userId: string): Promise<void> {
    console.log(`[L7] Refreshing business insights for user ${userId}`);

    await Promise.all([
        computePeakHours(userId).catch(err => console.error('[L7] peakHours error:', err.message)),
        computeCommonQuestions(userId).catch(err => console.error('[L7] commonQuestions error:', err.message)),
        computeConversionTriggers(userId).catch(err => console.error('[L7] conversionTriggers error:', err.message)),
    ]);

    console.log(`[L7] Insights refreshed for user ${userId}`);
}

// ─── Peak Hours ───

async function computePeakHours(userId: string): Promise<void> {
    // Get message timestamps for this business's contacts
    const r = await pool.query(`
        SELECT EXTRACT(HOUR FROM m.created_at) AS hour,
               EXTRACT(DOW FROM m.created_at) AS dow,
               COUNT(*) AS cnt
        FROM wa_messages m
        JOIN wa_sessions s ON m.phone = s.phone
        WHERE s.scala_user_id = $1 AND m.direction = 'in'
          AND m.created_at > NOW() - INTERVAL '90 days'
        GROUP BY hour, dow
        ORDER BY cnt DESC
    `, [userId]);

    if (r.rows.length < 5) return; // not enough data

    const totalMessages = r.rows.reduce((sum: number, row: any) => sum + parseInt(row.cnt), 0);

    // Aggregate by hour
    const hourCounts = new Map<number, number>();
    for (const row of r.rows) {
        const h = parseInt(row.hour);
        hourCounts.set(h, (hourCounts.get(h) || 0) + parseInt(row.cnt));
    }

    // Top hours (above average)
    const avgPerHour = totalMessages / 24;
    const peakHours = [...hourCounts.entries()]
        .filter(([_, cnt]) => cnt > avgPerHour * 1.5)
        .sort((a, b) => b[1] - a[1])
        .map(([h]) => h);

    const quietHours = [...hourCounts.entries()]
        .filter(([_, cnt]) => cnt < avgPerHour * 0.3)
        .map(([h]) => h)
        .sort((a, b) => a - b);

    // Aggregate by day of week
    const dowCounts = new Map<number, number>();
    const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    for (const row of r.rows) {
        const d = parseInt(row.dow);
        dowCounts.set(d, (dowCounts.get(d) || 0) + parseInt(row.cnt));
    }
    const avgPerDay = totalMessages / 7;
    const peakDays = [...dowCounts.entries()]
        .filter(([_, cnt]) => cnt > avgPerDay * 1.3)
        .sort((a, b) => b[1] - a[1])
        .map(([d]) => dayNames[d]);

    const insightData = {
        peak_hours: peakHours.slice(0, 6),
        peak_days: peakDays,
        quiet_hours: quietHours,
    };

    await upsertInsight(userId, 'peak_hours', insightData, 0.7, totalMessages);
}

// ─── Common Questions ───

async function computeCommonQuestions(userId: string): Promise<void> {
    // Get inbound messages for this business's contacts
    const r = await pool.query(`
        SELECT m.content
        FROM wa_messages m
        JOIN wa_sessions s ON m.phone = s.phone
        WHERE s.scala_user_id = $1 AND m.direction = 'in'
          AND m.media_type = 'text'
          AND LENGTH(m.content) > 10
          AND m.content LIKE '%?%'
          AND m.created_at > NOW() - INTERVAL '90 days'
        ORDER BY m.created_at DESC
        LIMIT 500
    `, [userId]);

    if (r.rows.length < 10) return; // not enough data

    // Simple frequency analysis: normalize questions and count duplicates
    const questionCounts = new Map<string, number>();
    for (const row of r.rows) {
        const normalized = normalizeQuestion(row.content);
        if (normalized.length < 5) continue;
        questionCounts.set(normalized, (questionCounts.get(normalized) || 0) + 1);
    }

    const topQuestions = [...questionCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([text, count]) => ({ text, count }));

    if (topQuestions.length === 0) return;

    const insightData = { questions: topQuestions };
    await upsertInsight(userId, 'common_questions', insightData, 0.6, r.rows.length);
}

/**
 * Normalize a question for grouping similar questions together.
 */
function normalizeQuestion(text: string): string {
    return text
        .toLowerCase()
        .replace(/[^\w\s?àèéìòùáóú]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .substring(0, 100);
}

// ─── Conversion Triggers ───

async function computeConversionTriggers(userId: string): Promise<void> {
    // Find contacts that reached 'qualified' or 'converted' stage
    // and analyze their early messages for patterns
    const r = await pool.query(`
        SELECT s.phone, s.lead_stage,
               (SELECT m.content FROM wa_messages m
                WHERE m.phone = s.phone AND m.direction = 'in' AND m.media_type = 'text'
                ORDER BY m.created_at LIMIT 1) AS first_msg,
               (SELECT m.content FROM wa_messages m
                WHERE m.phone = s.phone AND m.direction = 'in' AND m.media_type = 'text'
                ORDER BY m.created_at OFFSET 1 LIMIT 1) AS second_msg,
               s.messages_count
        FROM wa_sessions s
        WHERE s.scala_user_id = $1
          AND s.lead_stage IN ('qualified', 'converted')
          AND s.messages_count >= 3
        LIMIT 200
    `, [userId]);

    if (r.rows.length < 5) return;

    // Analyze patterns in first/second messages of converted contacts
    const pricingEarly = r.rows.filter((row: any) => {
        const combined = ((row.first_msg || '') + ' ' + (row.second_msg || '')).toLowerCase();
        return /\b(prezzo|costo|quanto|price|cost|how much|tariff)\b/.test(combined);
    });

    const bookingEarly = r.rows.filter((row: any) => {
        const combined = ((row.first_msg || '') + ' ' + (row.second_msg || '')).toLowerCase();
        return /\b(prenotare|appuntamento|booking|appointment|reserve|prenota|disponibil)\b/.test(combined);
    });

    const triggers: any[] = [];
    const totalConverted = r.rows.length;

    if (pricingEarly.length > 0) {
        triggers.push({
            pattern: 'pricing_inquiry_early',
            description: `Clients who ask about pricing within first 2 messages`,
            count: pricingEarly.length,
            rate: Math.round((pricingEarly.length / totalConverted) * 100),
        });
    }
    if (bookingEarly.length > 0) {
        triggers.push({
            pattern: 'booking_inquiry_early',
            description: `Clients who ask about bookings/appointments early`,
            count: bookingEarly.length,
            rate: Math.round((bookingEarly.length / totalConverted) * 100),
        });
    }

    if (triggers.length === 0) return;

    const insightData = { triggers, total_converted: totalConverted };
    await upsertInsight(userId, 'conversion_triggers', insightData, 0.5, totalConverted);
}

// ─── Upsert helper ───

async function upsertInsight(
    userId: string,
    insightType: string,
    insightData: any,
    confidence: number,
    sampleSize: number,
): Promise<void> {
    await pool.query(`
        INSERT INTO sara_business_insights (user_id, insight_type, insight_data, confidence, sample_size, generated_at, expires_at)
        VALUES ($1, $2, $3, $4, $5, NOW(), NOW() + INTERVAL '30 days')
        ON CONFLICT (user_id, insight_type) DO UPDATE SET
            insight_data = $3, confidence = $4, sample_size = $5,
            generated_at = NOW(), expires_at = NOW() + INTERVAL '30 days'
    `, [userId, insightType, JSON.stringify(insightData), confidence, sampleSize]);
}

// ─── Get Insights for prompt injection ───

export async function getBusinessInsightsContext(userId: string): Promise<string> {
    try {
        const r = await pool.query(
            `SELECT insight_type, insight_data, confidence, sample_size
             FROM sara_business_insights
             WHERE user_id = $1 AND expires_at > NOW()
             ORDER BY confidence DESC`,
            [userId]
        );
        if (r.rows.length === 0) return '';

        const parts: string[] = ['[BUSINESS INSIGHTS]'];
        for (const row of r.rows) {
            const data = typeof row.insight_data === 'string' ? JSON.parse(row.insight_data) : row.insight_data;
            switch (row.insight_type) {
                case 'peak_hours': {
                    if (data.peak_hours?.length > 0) {
                        const hrs = data.peak_hours.map((h: number) => `${h}:00`).join(', ');
                        parts.push(`- Peak hours: ${hrs}${data.peak_days?.length ? ` (${data.peak_days.join(', ')} are busiest)` : ''}`);
                    }
                    break;
                }
                case 'common_questions': {
                    if (data.questions?.length > 0) {
                        const qs = data.questions.slice(0, 5).map((q: any) => `"${q.text}" (${q.count}x)`).join(', ');
                        parts.push(`- Top questions clients ask: ${qs}`);
                    }
                    break;
                }
                case 'conversion_triggers': {
                    if (data.triggers?.length > 0) {
                        for (const t of data.triggers.slice(0, 3)) {
                            parts.push(`- Tip: ${t.description} (${t.rate}% of converted clients)`);
                        }
                    }
                    break;
                }
            }
        }

        return parts.length > 1 ? parts.join('\n') : '';
    } catch (err: any) {
        console.error('[L7] getBusinessInsightsContext error:', err.message);
        return '';
    }
}
