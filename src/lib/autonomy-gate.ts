// ═══════════════════════════════════════════════════════════
// SARA Autonomy Gate — WhatsApp bot integration
// Queries sara_autonomy_settings from SCALA DB and decides
// whether to execute (send) or enqueue for human approval.
//
// Level semantics (mirrors scala-backend/src/lib/sara-autonomy.ts):
//   0 = OFF       — pass-through, current behavior unchanged
//   1 = OSSERVA   — always queue, never auto-send
//   2 = SEMI-AUTO — queue promo/upsell; send reply/faq/reminder
//   3 = FULL-AUTO — always send
// ═══════════════════════════════════════════════════════════

import { createRequire } from 'module';

const LOW_RISK_TYPES = new Set(['reply', 'faq', 'reminder', 'booking_confirm', 'reactivation', 'info', 'check']);

type AutonomyLevel = 0 | 1 | 2 | 3;
type ActionRisk = 'low' | 'medium' | 'high' | 'critical';

function classifyActionType(proposedMessage: string): string {
    const m = proposedMessage.toLowerCase();
    if (/offerta|promo|sconto|upgrade|piano pro|piano growth/i.test(m)) return 'promo';
    if (/upsell|abbonamento|acquista|compra/i.test(m)) return 'upsell';
    if (/prenotazione confermata|appuntamento confermato|booking confirmed/i.test(m)) return 'booking_confirm';
    if (/promemoria|reminder|ti ricordiamo/i.test(m)) return 'reminder';
    return 'reply'; // default = low risk
}

/**
 * Agentic risk classification — classifies by concrete action, not message tone.
 * Used by the agentic flow to decide whether to execute or queue a tool call.
 */
export function shouldQueueAgenticAction(
    level: AutonomyLevel,
    actionRisk: ActionRisk,
): boolean {
    if (level === 0) return false; // OFF = pass-through (no agentic)
    if (level === 1) return true;  // OBSERVE = always queue
    if (level === 2) {
        // SEMI-AUTO: auto-execute low risk, queue medium+
        return actionRisk !== 'low';
    }
    if (level === 3) {
        // FULL-AUTO: auto-execute low + medium, queue high + critical
        return actionRisk === 'high' || actionRisk === 'critical';
    }
    return true; // default: queue
}

let _scalaPool: any = null;

async function getScalaPool() {
    if (_scalaPool) return _scalaPool;
    const scalaDbUrl = process.env.SCALA_DB_URL;
    if (!scalaDbUrl) return null;
    try {
        const pg = (await import('pg')).default;
        _scalaPool = new pg.Pool({ connectionString: scalaDbUrl, max: 2 });
        _scalaPool.on('error', (err: any) => console.error('[pool] idle client error', err));
        return _scalaPool;
    } catch {
        return null;
    }
}

/**
 * Check the tenant's autonomy level and either queue or pass-through.
 *
 * Returns `true` if the action was QUEUED (caller must NOT send the message).
 * Returns `false` if the caller should send normally.
 */
export async function autonomyGate(
    adminUserId: string,
    customerPhone: string,
    proposedMessage: string,
    contextSummary: string,
): Promise<boolean> {
    const pool = await getScalaPool();
    if (!pool) return false; // No DB → pass-through

    let level: AutonomyLevel = 0;
    try {
        const res = await pool.query(
            'SELECT level FROM sara_autonomy_settings WHERE user_id = $1',
            [adminUserId],
        );
        level = ((res.rows[0]?.level as number) ?? 0) as AutonomyLevel;
    } catch {
        return false; // DB error → fail open (send normally)
    }

    if (level === 0) return false; // OFF → pass-through

    const actionType = classifyActionType(proposedMessage);
    const isLowRisk = LOW_RISK_TYPES.has(actionType);

    let shouldQueue = false;
    if (level === 1) shouldQueue = true;                    // OSSERVA: always queue
    if (level === 2 && !isLowRisk) shouldQueue = true;     // SEMI-AUTO: queue high-risk only
    // level 3 or (level 2 + low risk) → pass-through

    if (shouldQueue) {
        try {
            const riskLevel = isLowRisk ? 'low' : 'high';
            await pool.query(
                `INSERT INTO sara_action_queue
                   (user_id, phone_number, action_type, risk_level, proposed_message, context_summary)
                 VALUES ($1, $2, $3, $4, $5, $6)`,
                [adminUserId, customerPhone, actionType, riskLevel, proposedMessage, contextSummary.substring(0, 200)],
            );
            console.log(`[AUTONOMY] level=${level} queued ${actionType}(${riskLevel}) for ${customerPhone}`);
        } catch (err: any) {
            console.error('[AUTONOMY] queue insert failed, sending normally:', err.message);
            return false; // fail open
        }
        return true; // queued → caller must skip sendHumanized
    }

    return false; // execute → caller sends normally
}
