// ═══════════════════════════════════════════════════
// SARA Proactive Client Alerts
// Notifies operators about clients needing attention
// ═══════════════════════════════════════════════════

import { pool } from '../config.js';

const ALERT_CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

interface AlertConfig {
    inactive_days: number;       // days without contact
    slow_response_hours: number; // hours before flagging new leads
    sentiment_threshold: number; // number of negative sentiments to trigger
}

const DEFAULT_CONFIG: AlertConfig = {
    inactive_days: 14,
    slow_response_hours: 2,
    sentiment_threshold: 2,
};

function redactPhone(phone: string): string {
    const digits = (phone || '').replace(/\D/g, '');
    return digits.length >= 4 ? `***${digits.slice(-4)}` : '****';
}

// ─── Generate Alerts ───

async function generateAlerts(): Promise<void> {
    try {
        // 1. Clients inactive for 14+ days (who had previous engagement)
        const inactive = await pool.query(`
            SELECT s.phone, s.user_name, s.sector, s.lead_stage, s.scala_user_id,
                   s.last_message, s.messages_count
            FROM wa_sessions s
            WHERE s.last_message < NOW() - INTERVAL '${DEFAULT_CONFIG.inactive_days} days'
            AND s.messages_count >= 3
            AND s.lead_stage NOT IN ('converted', 'lost')
            AND s.opted_out IS NOT TRUE
            ORDER BY s.last_message ASC
            LIMIT 50
        `);

        for (const client of inactive.rows) {
            const daysSince = Math.floor((Date.now() - new Date(client.last_message).getTime()) / (1000 * 60 * 60 * 24));
            // Get last message content for context
            const lastMsg = await pool.query(
                `SELECT content FROM wa_messages WHERE phone = $1 AND direction = 'in' ORDER BY created_at DESC LIMIT 1`,
                [client.phone]
            );
            const lastContent = lastMsg.rows[0]?.content?.substring(0, 100) || '';

            await createAlert({
                userId: client.scala_user_id,
                alertType: 'inactive_client',
                clientPhone: client.phone,
                clientName: client.user_name || redactPhone(client.phone),
                message: `${client.user_name || 'Cliente'} non risponde da ${daysSince} giorni. Ultimo messaggio: "${lastContent}"`,
                suggestion: `Ricontattarlo con nuove proposte ${client.sector !== 'general' ? `nel settore ${client.sector}` : ''}`,
                priority: daysSince > 30 ? 'high' : 'medium',
            });
        }

        // 2. Clients with negative sentiment in last interactions
        const negativeSentiment = await pool.query(`
            SELECT p.phone, p.name, p.sentiment_history, p.total_interactions,
                   s.scala_user_id
            FROM wa_client_profiles p
            JOIN wa_sessions s ON p.phone = s.phone
            WHERE p.sentiment_history IS NOT NULL
            -- 3444 rows store sentiment_history as a jsonb OBJECT (not array);
            -- jsonb_array_length() throws "cannot get array length of a non-array"
            -- on those. A bare jsonb_typeof guard isn't enough (planner may eval
            -- jsonb_array_length first), so CASE is required to short-circuit.
            AND CASE WHEN jsonb_typeof(p.sentiment_history) = 'array'
                     THEN jsonb_array_length(p.sentiment_history) ELSE 0 END >= 2
            AND s.lead_stage NOT IN ('lost')
        `);

        for (const client of negativeSentiment.rows) {
            const history = client.sentiment_history || [];
            const lastN = history.slice(-3);
            const negativeCount = lastN.filter((s: any) => s.sentiment === 'negative').length;
            if (negativeCount >= DEFAULT_CONFIG.sentiment_threshold) {
                await createAlert({
                    userId: client.scala_user_id,
                    alertType: 'negative_sentiment',
                    clientPhone: client.phone,
                    clientName: client.name || redactPhone(client.phone),
                    message: `${client.name || 'Cliente'} mostra sentiment negativo nelle ultime ${lastN.length} interazioni`,
                    suggestion: 'Contattare personalmente per capire il problema e offrire supporto',
                    priority: 'high',
                });
            }
        }

        // 3. Pending action items from conversation summaries
        const pendingActions = await pool.query(`
            SELECT cs.phone, cs.action_items, cs.created_at,
                   s.user_name, s.scala_user_id
            FROM wa_conversation_summaries cs
            JOIN wa_sessions s ON cs.phone = s.phone
            WHERE cs.action_items IS NOT NULL
            AND array_length(cs.action_items, 1) > 0
            AND cs.created_at > NOW() - INTERVAL '7 days'
            AND s.lead_stage NOT IN ('converted', 'lost')
            ORDER BY cs.created_at DESC
            LIMIT 30
        `);

        for (const item of pendingActions.rows) {
            const actions = item.action_items || [];
            if (actions.length > 0) {
                await createAlert({
                    userId: item.scala_user_id,
                    alertType: 'pending_action',
                    clientPhone: item.phone,
                    clientName: item.user_name || redactPhone(item.phone),
                    message: `Azioni pendenti per ${item.user_name || 'cliente'}: ${actions.join(', ')}`,
                    suggestion: 'Completare le azioni pendenti per mantenere la fiducia del cliente',
                    priority: 'medium',
                });
            }
        }

        // 4. Clients with approaching decision timelines
        const deadlineClients = await pool.query(`
            SELECT p.phone, p.name, p.decision_timeline, p.interests, p.company,
                   s.scala_user_id, s.user_name
            FROM wa_client_profiles p
            JOIN wa_sessions s ON p.phone = s.phone
            WHERE p.decision_timeline IS NOT NULL
            AND p.decision_timeline != ''
            AND s.lead_stage NOT IN ('converted', 'lost')
        `);

        for (const client of deadlineClients.rows) {
            const timeline = (client.decision_timeline || '').toLowerCase();
            // Check for urgency keywords
            const isUrgent = /\b(1\s*(giorn|day|dia)|domani|tomorrow|ama[nñ]|questa settimana|this week|esta semana)\b/i.test(timeline);
            const isSoon = /\b(2|3|4|5)\s*(giorn|day|dia)|prossima settimana|next week|semana que vem\b/i.test(timeline);
            if (isUrgent || isSoon) {
                const interests = (client.interests || []).join(', ');
                await createAlert({
                    userId: client.scala_user_id,
                    alertType: 'deadline_approaching',
                    clientPhone: client.phone,
                    clientName: client.name || client.user_name || redactPhone(client.phone),
                    message: `${client.name || client.user_name || 'Cliente'}${client.company ? ` (${client.company})` : ''} ha una deadline: "${client.decision_timeline}"${interests ? `. Interessi: ${interests}` : ''}`,
                    suggestion: isUrgent
                        ? 'URGENTE: contattare OGGI con proposta concreta e pricing'
                        : 'Preparare proposta personalizzata e contattare entro 2 giorni',
                    priority: isUrgent ? 'urgent' : 'high',
                });
            }
        }

        // 5. Clients with high interest but went silent (profile-enriched reengagement)
        const silentInterested = await pool.query(`
            SELECT p.phone, p.name, p.interests, p.pain_points, p.company, p.budget_range,
                   p.total_interactions, p.last_interaction,
                   s.scala_user_id, s.user_name, s.sector
            FROM wa_client_profiles p
            JOIN wa_sessions s ON p.phone = s.phone
            WHERE p.last_interaction < NOW() - INTERVAL '7 days'
            AND p.last_interaction > NOW() - INTERVAL '30 days'
            AND p.total_interactions >= 5
            AND (array_length(p.interests, 1) > 0 OR p.budget_range IS NOT NULL)
            AND s.lead_stage NOT IN ('converted', 'lost')
            AND s.opted_out IS NOT TRUE
        `);

        for (const client of silentInterested.rows) {
            const daysSince = Math.floor((Date.now() - new Date(client.last_interaction).getTime()) / (1000 * 60 * 60 * 24));
            const interests = (client.interests || []).join(', ');
            const painPoints = (client.pain_points || []).join(', ');
            await createAlert({
                userId: client.scala_user_id,
                alertType: 'silent_interested',
                clientPhone: client.phone,
                clientName: client.name || client.user_name || redactPhone(client.phone),
                message: `${client.name || 'Cliente qualificato'}${client.company ? ` (${client.company})` : ''} silenzioso da ${daysSince}gg. ${interests ? `Interessi: ${interests}.` : ''} ${painPoints ? `Pain: ${painPoints}.` : ''} ${client.budget_range ? `Budget: ${client.budget_range}.` : ''} ${client.total_interactions} interazioni totali.`,
                suggestion: `Ricontattare con proposta mirata${client.sector !== 'general' ? ` per settore ${client.sector}` : ''}. Ha mostrato interesse concreto.`,
                priority: client.budget_range ? 'high' : 'medium',
            });
        }

        // 6. New leads not responded to in 2+ hours
        const slowResponse = await pool.query(`
            SELECT s.phone, s.user_name, s.sector, s.scala_user_id,
                   s.first_seen
            FROM wa_sessions s
            WHERE s.messages_count = 1
            AND s.first_seen < NOW() - INTERVAL '${DEFAULT_CONFIG.slow_response_hours} hours'
            AND s.first_seen > NOW() - INTERVAL '48 hours'
            AND s.lead_stage = 'new'
            AND s.opted_out IS NOT TRUE
        `);

        for (const lead of slowResponse.rows) {
            const hoursSince = Math.floor((Date.now() - new Date(lead.first_seen).getTime()) / (1000 * 60 * 60));
            await createAlert({
                userId: lead.scala_user_id,
                alertType: 'slow_response',
                clientPhone: lead.phone,
                clientName: lead.user_name || redactPhone(lead.phone),
                message: `Nuovo lead non ha ricevuto risposta personalizzata da ${hoursSince} ore`,
                suggestion: 'Rispondere rapidamente per non perdere il lead. I primi 5 minuti sono critici!',
                priority: hoursSince > 12 ? 'urgent' : 'high',
            });
        }

        console.log('[ALERTS] Check completed');
    } catch (err: any) {
        console.error('[ALERTS] Error generating alerts:', err.message);
    }
}

// ─── Create Alert (with dedup) ───

async function createAlert(params: {
    userId?: string;
    alertType: string;
    clientPhone: string;
    clientName: string;
    message: string;
    suggestion: string;
    priority: string;
}): Promise<void> {
    // Skip if no operator to notify
    if (!params.userId) return;

    try {
        // Dedup: don't create duplicate alerts for same client+type within 24h
        const existing = await pool.query(
            `SELECT id FROM sara_alerts
             WHERE user_id = $1 AND alert_type = $2 AND client_phone = $3
             AND created_at > NOW() - INTERVAL '24 hours'
             AND dismissed = false
             LIMIT 1`,
            [params.userId, params.alertType, params.clientPhone]
        );

        if (existing.rows.length > 0) return; // Already alerted

        await pool.query(
            `INSERT INTO sara_alerts (user_id, alert_type, client_phone, client_name, message, suggestion, priority)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [params.userId, params.alertType, params.clientPhone, params.clientName,
             params.message, params.suggestion, params.priority]
        );
    } catch (err: any) {
        console.error('[ALERTS] createAlert error:', err.message);
    }
}

// ─── Start Alert Scheduler ───

export function startAlertScheduler(): void {
    console.log('[ALERTS] Scheduler started — checking every hour');

    // Run once at startup after 30 seconds
    setTimeout(() => generateAlerts(), 30_000);

    // Then every hour
    setInterval(() => generateAlerts(), ALERT_CHECK_INTERVAL_MS).unref();
}

// ─── API: Get alerts for a user ───

export async function getAlertsForUser(userId: string, options?: {
    unreadOnly?: boolean;
    limit?: number;
}): Promise<any[]> {
    const limit = options?.limit || 50;
    const unreadFilter = options?.unreadOnly ? 'AND read = false' : '';

    try {
        const r = await pool.query(
            `SELECT * FROM sara_alerts
             WHERE user_id = $1 AND dismissed = false ${unreadFilter}
             ORDER BY
                CASE priority
                    WHEN 'urgent' THEN 1
                    WHEN 'high' THEN 2
                    WHEN 'medium' THEN 3
                    WHEN 'low' THEN 4
                END,
                created_at DESC
             LIMIT $2`,
            [userId, limit]
        );
        return r.rows;
    } catch (err: any) {
        console.error('[ALERTS] getAlertsForUser error:', err.message);
        return [];
    }
}

export async function markAlertRead(alertId: number, userId: string): Promise<boolean> {
    try {
        const r = await pool.query(
            'UPDATE sara_alerts SET read = true WHERE id = $1 AND user_id = $2',
            [alertId, userId]
        );
        return (r.rowCount || 0) > 0;
    } catch { return false; }
}

export async function dismissAlert(alertId: number, userId: string): Promise<boolean> {
    try {
        const r = await pool.query(
            'UPDATE sara_alerts SET dismissed = true WHERE id = $1 AND user_id = $2',
            [alertId, userId]
        );
        return (r.rowCount || 0) > 0;
    } catch { return false; }
}

export async function getAlertCount(userId: string): Promise<number> {
    try {
        const r = await pool.query(
            'SELECT COUNT(*)::int as count FROM sara_alerts WHERE user_id = $1 AND read = false AND dismissed = false',
            [userId]
        );
        return r.rows[0]?.count || 0;
    } catch { return 0; }
}
