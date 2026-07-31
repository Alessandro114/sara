// ═══════════════════════════════════════════════════
// L9 — Action Memory
// Tracks what SARA has DONE (not just said).
// Detects actions from AI responses and logs them.
// ═══════════════════════════════════════════════════

import { pool } from '../config.js';
import { redactPhone } from './phone-utils.js';

// ─── Types ───

export type ActionType =
    | 'booking_created'
    | 'quote_sent'
    | 'handoff_triggered'
    | 'follow_up_scheduled'
    | 'info_provided'
    | 'complaint_handled'
    | 'contact_saved'
    | 'data_entry';

interface DetectedAction {
    type: ActionType;
    data?: Record<string, any>;
}

// ─── Action Detection Patterns ───

const ACTION_PATTERNS: Array<{ patterns: RegExp[]; type: ActionType }> = [
    {
        type: 'booking_created',
        patterns: [
            /\b(ho prenotato|appuntamento fissato|appointment booked|booking confirmed|prenotazione confermata|reserva confirmada|agendado|cita programada)\b/i,
            /\b(ti ho fissato|confermato per|confermato il|scheduled for|booked for)\b/i,
        ],
    },
    {
        type: 'quote_sent',
        patterns: [
            /\b(il preventivo|il costo [eè]|the price is|the cost is|the quote|el presupuesto|o orçamento)\b/i,
            /\b(ecco il preventivo|ti invio il preventivo|here.s the quote|€\s*\d+|EUR\s*\d+)\b/i,
        ],
    },
    {
        type: 'handoff_triggered',
        patterns: [
            /\b(passo la conversazione|trasferisco|ti metto in contatto|transferring|connecting you with|te paso con|vou transferir)\b/i,
            /\b(un collega ti contatter|will reach out|someone will call)\b/i,
        ],
    },
    {
        type: 'follow_up_scheduled',
        patterns: [
            /\b(ti ricontatto|follow up|ti scrivo|ti aggiorno|I.ll get back|volver[eé] a contactar|entrarei em contato)\b/i,
        ],
    },
    {
        type: 'info_provided',
        patterns: [
            /\b(i nostri orari|our hours|siamo aperti|we.re open|estamos abertos|horario de apertura)\b/i,
            /\b(ecco le informazioni|here.s the info|aqui est[aã]o as informa[cç][oõ]es)\b/i,
            /\b(si trova in|we.re located|our address|il nostro indirizzo|nuestra direcci[oó]n)\b/i,
        ],
    },
    {
        type: 'complaint_handled',
        patterns: [
            /\b(mi dispiace per|ci scusiamo|I.m sorry for|we apologize|lo sentimos|pedimos desculpas)\b/i,
            /\b(risolveremo|provvederemo|we.ll fix|we.ll resolve|lo solucionaremos)\b/i,
        ],
    },
];

/**
 * Detect actions from SARA's AI response.
 */
export function detectActions(aiResponse: string): DetectedAction[] {
    const actions: DetectedAction[] = [];
    const seenTypes = new Set<ActionType>();

    for (const pattern of ACTION_PATTERNS) {
        if (seenTypes.has(pattern.type)) continue;
        for (const regex of pattern.patterns) {
            if (regex.test(aiResponse)) {
                // Extract context data
                const data: Record<string, any> = {};

                // Try to extract price/amount
                const priceMatch = aiResponse.match(/€\s*(\d+(?:[.,]\d+)?)/);
                if (priceMatch) data.amount = priceMatch[0];

                // Try to extract date/time
                const dateMatch = aiResponse.match(/\b(\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{2,4})?)\b/);
                if (dateMatch) data.date = dateMatch[1];

                const timeMatch = aiResponse.match(/\b(\d{1,2}[:.]\d{2})\b/);
                if (timeMatch) data.time = timeMatch[1];

                actions.push({ type: pattern.type, data: Object.keys(data).length > 0 ? data : undefined });
                seenTypes.add(pattern.type);
                break;
            }
        }
    }

    return actions;
}

/**
 * Log detected actions to DB. Fire-and-forget.
 */
export function logActions(
    userId: string | null,
    phone: string,
    aiResponse: string,
): void {
    const actions = detectActions(aiResponse);
    if (actions.length === 0) return;

    for (const action of actions) {
        pool.query(
            `INSERT INTO sara_actions (user_id, phone, action_type, action_data, timestamp)
             VALUES ($1, $2, $3, $4, NOW())`,
            [userId, phone, action.type, action.data ? JSON.stringify(action.data) : null]
        ).catch(err => console.error('[L9] logAction error:', err.message));
    }

    console.log(`[L9] ${redactPhone(phone)}: logged ${actions.length} action(s): ${actions.map(a => a.type).join(', ')}`);
}

/**
 * Get recent actions for a contact (for prompt injection).
 */
export async function getActionContext(phone: string): Promise<string> {
    try {
        const r = await pool.query(
            `SELECT action_type, action_data, timestamp
             FROM sara_actions
             WHERE phone = $1
             ORDER BY timestamp DESC
             LIMIT 10`,
            [phone]
        );

        if (r.rows.length === 0) return '';

        const actionLabels: Record<string, string> = {
            booking_created: 'Booking created',
            quote_sent: 'Quote sent',
            handoff_triggered: 'Handoff to human',
            follow_up_scheduled: 'Follow-up scheduled',
            info_provided: 'Info provided',
            complaint_handled: 'Complaint handled',
            contact_saved: 'Contact saved to CRM',
            data_entry: 'Data entry',
        };

        const lines = r.rows.map((row: any) => {
            const ago = getTimeAgo(new Date(row.timestamp));
            const label = actionLabels[row.action_type] || row.action_type;
            const data = row.action_data;
            let detail = '';
            if (data) {
                const parts: string[] = [];
                if (data.amount) parts.push(data.amount);
                if (data.date) parts.push(data.date);
                if (data.time) parts.push(data.time);
                if (data.description) parts.push(data.description);
                if (parts.length > 0) detail = ` (${parts.join(', ')})`;
            }
            return `- ${ago}: ${label}${detail}`;
        });

        return `[PREVIOUS ACTIONS WITH THIS CONTACT]\n${lines.join('\n')}`;
    } catch (err: any) {
        console.error('[L9] getActionContext error:', err.message);
        return '';
    }
}

/**
 * Simple time-ago formatter.
 */
function getTimeAgo(date: Date): string {
    const now = Date.now();
    const diff = now - date.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days === 1) return '1 day ago';
    if (days < 30) return `${days} days ago`;
    return `${Math.floor(days / 30)} months ago`;
}
