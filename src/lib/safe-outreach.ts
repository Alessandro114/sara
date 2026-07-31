// ═══════════════════════════════════════════════════
// SARA Safe Outreach — Anti-Ban WhatsApp Campaigns
// Rate-limited, business-hours-only, opt-out-respecting
// ═══════════════════════════════════════════════════

import { pool } from '../config.js';
import { sendHumanized } from '../humanize.js';

type WASocket = any;

// ─── Safety Rules ───

export const OUTREACH_RULES = {
    max_messages_per_hour: 20,           // Meta unofficial safe limit
    max_messages_per_day: 100,
    min_interval_between_messages: 30_000, // 30 seconds minimum
    max_new_conversations_per_day: 50,
    cooldown_after_block: 24 * 60 * 60_000, // 24h if any message fails
    batch_size: 5,                        // send 5, wait, send 5 more
    batch_cooldown: 5 * 60_000,           // 5 min between batches
    business_hours_only: true,            // 9:00-20:00 Europe/Rome (see OUTREACH_TZ)
    no_weekends: false,                   // can send on weekends but reduced volume
    weekend_max_per_day: 30,
    business_hours_start: 9,
    business_hours_end: 20,
};

// ─── Timezone ───
// The host runs UTC (timedatectl = Etc/UTC) and no TZ is set in .env, so Date#getHours()
// returned UTC hours: with Italy on CEST the 9-20 window actually fired 11:00-22:00 local,
// i.e. WhatsApp outreach at 10pm (spam-report/ban risk) while the best morning slot
// (9-11) was blocked. Never offset by a fixed +1/+2: Intl resolves CET/CEST correctly.
const OUTREACH_TZ = process.env.OUTREACH_TZ || 'Europe/Rome';

const TZ_PARTS = new Intl.DateTimeFormat('en-US', {
    timeZone: OUTREACH_TZ,
    hour: '2-digit',
    hour12: false,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
});

/** Wall-clock hour (0-23), weekday and ISO calendar date in OUTREACH_TZ. */
function nowInOutreachTz(at: Date = new Date()): { hour: number; isWeekend: boolean; date: string } {
    const p = Object.fromEntries(TZ_PARTS.formatToParts(at).map(x => [x.type, x.value])) as Record<string, string>;
    // 'en-US' hour12:false renders midnight as '24' — normalise to 0.
    const hour = parseInt(p.hour, 10) % 24;
    return {
        hour,
        isWeekend: p.weekday === 'Sat' || p.weekday === 'Sun',
        date: `${p.year}-${p.month}-${p.day}`,
    };
}

// ─── State ───

let outreachPaused = false;
let lastBlockTime = 0;
// In-memory MIRROR of the DB counters, kept only so getOutreachStatus() can stay sync.
// It is NOT the source of truth: these used to be the only counters, so a restart reset
// them to 0 and the 100/day cap could be bypassed by bouncing the process. The authority
// is now sara_outreach_messages.sent_at (see getSentCounts).
let messagesToday = 0;
let messagesThisHour = 0;
let activeSock: WASocket | null = null;

/**
 * Authoritative counters, derived from what was actually sent.
 * "Today" = calendar day in OUTREACH_TZ (not a 24h window rolling from process boot,
 * which is what the old in-memory reset really did despite the "midnight" comment).
 * No new table: sara_outreach_messages already records status='sent' + sent_at.
 */
async function getSentCounts(): Promise<{ today: number; thisHour: number }> {
    const r = await pool.query(
        `SELECT
             COUNT(*) FILTER (
                 WHERE sent_at >= date_trunc('day', now() AT TIME ZONE $1) AT TIME ZONE $1
             )::int AS today,
             COUNT(*) FILTER (WHERE sent_at >= now() - interval '1 hour')::int AS this_hour
           FROM sara_outreach_messages
          WHERE status = 'sent' AND sent_at IS NOT NULL`,
        [OUTREACH_TZ]
    );
    return { today: r.rows[0]?.today ?? 0, thisHour: r.rows[0]?.this_hour ?? 0 };
}

// ─── Initialize ───

export function initOutreach(sock: WASocket): void {
    activeSock = sock;

    // Refresh the in-memory mirror from the DB (counters survive restarts now).
    const refresh = () => getSentCounts()
        .then(c => { messagesToday = c.today; messagesThisHour = c.thisHour; })
        .catch(err => console.error('[OUTREACH] counter refresh failed:', err.message));
    refresh();
    setInterval(refresh, 60_000).unref();

    // Process outreach queue every 30 seconds
    setInterval(() => processOutreachQueue(), 30_000).unref();
    console.log(`[OUTREACH] Initialized with safe limits (tz=${OUTREACH_TZ})`);
}

// ─── Check if sending is allowed right now ───

/**
 * Pure, synchronously testable part of the decision: everything that depends only on the
 * wall clock in OUTREACH_TZ. Exported for tests — do NOT call directly, use canSendNow().
 */
export function checkSchedule(at: Date = new Date()): { allowed: boolean; reason?: string; dailyLimit: number } {
    const { hour, isWeekend } = nowInOutreachTz(at);

    const dailyLimit = isWeekend && OUTREACH_RULES.no_weekends
        ? 0
        : isWeekend
            ? OUTREACH_RULES.weekend_max_per_day
            : OUTREACH_RULES.max_messages_per_day;

    if (OUTREACH_RULES.business_hours_only) {
        if (hour < OUTREACH_RULES.business_hours_start || hour >= OUTREACH_RULES.business_hours_end) {
            return { allowed: false, reason: 'outside_business_hours', dailyLimit };
        }
    }
    return { allowed: true, dailyLimit };
}

async function canSendNow(): Promise<{ allowed: boolean; reason?: string }> {
    if (outreachPaused) return { allowed: false, reason: 'outreach_paused' };

    // Cooldown after block
    if (lastBlockTime > 0 && Date.now() - lastBlockTime < OUTREACH_RULES.cooldown_after_block) {
        return { allowed: false, reason: 'block_cooldown' };
    }

    // Business hours + weekend, evaluated in Europe/Rome
    const schedule = checkSchedule();
    if (!schedule.allowed) return { allowed: false, reason: schedule.reason };

    // Volume caps, read from the DB so a restart cannot wipe them
    let counts: { today: number; thisHour: number };
    try {
        counts = await getSentCounts();
        messagesToday = counts.today;
        messagesThisHour = counts.thisHour;
    } catch (err: any) {
        // Fail CLOSED: if we cannot prove we are under the cap, do not send.
        console.error('[OUTREACH] cap lookup failed — refusing to send:', err.message);
        return { allowed: false, reason: 'cap_check_failed' };
    }

    if (counts.today >= schedule.dailyLimit) {
        return { allowed: false, reason: 'daily_limit_reached' };
    }

    if (counts.thisHour >= OUTREACH_RULES.max_messages_per_hour) {
        return { allowed: false, reason: 'hourly_limit_reached' };
    }

    return { allowed: true };
}

// ─── Schedule Outreach Campaign ───

export async function scheduleOutreachCampaign(
    userId: string,
    contacts: Array<{ phone: string; name: string; lastContact?: Date }>,
    template: string,
    campaignName: string,
    scheduledAt?: Date,
    customRules?: Partial<typeof OUTREACH_RULES>
): Promise<{ campaignId: number; scheduled: number; skipped: number; reasons: string[] }> {
    const rules = { ...OUTREACH_RULES, ...customRules };
    const reasons: string[] = [];
    let skipped = 0;
    let scheduled = 0;

    try {
        // Create campaign
        const campaign = await pool.query(
            `INSERT INTO sara_outreach_campaigns (user_id, name, template, status, total_contacts, scheduled_at, rules)
             VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
            [userId, campaignName, template, scheduledAt ? 'scheduled' : 'draft',
             contacts.length, scheduledAt || null, JSON.stringify(rules)]
        );
        const campaignId = campaign.rows[0].id;

        // Filter and schedule individual messages
        for (const contact of contacts) {
            // Skip opted-out
            const session = await pool.query(
                'SELECT opted_out, last_message, messages_count FROM wa_sessions WHERE phone = $1',
                [contact.phone]
            );

            if (session.rows[0]?.opted_out) {
                skipped++;
                reasons.push(`${contact.name}: opted out`);
                continue;
            }

            // Skip contacted in last 7 days
            const lastMsg = session.rows[0]?.last_message;
            if (lastMsg && Date.now() - new Date(lastMsg).getTime() < 7 * 24 * 60 * 60_000) {
                skipped++;
                reasons.push(`${contact.name}: contacted within 7 days`);
                continue;
            }

            // Skip if no previous conversation (can't initiate new)
            if (!session.rows[0] || session.rows[0].messages_count === 0) {
                skipped++;
                reasons.push(`${contact.name}: no previous conversation`);
                continue;
            }

            // Personalize template
            const personalizedMessage = template
                .replace(/\{name\}/g, contact.name || '')
                .replace(/\{nome\}/g, contact.name || '');

            // Calculate scheduled time (spread across the day)
            const baseTime = scheduledAt || new Date();
            const offset = scheduled * rules.min_interval_between_messages;
            const batchOffset = Math.floor(scheduled / rules.batch_size) * rules.batch_cooldown;
            const scheduledTime = new Date(baseTime.getTime() + offset + batchOffset);

            await pool.query(
                `INSERT INTO sara_outreach_messages (campaign_id, phone, contact_name, message, status, scheduled_at)
                 VALUES ($1, $2, $3, $4, 'pending', $5)`,
                [campaignId, contact.phone, contact.name, personalizedMessage, scheduledTime]
            );
            scheduled++;
        }

        // Update campaign stats
        await pool.query(
            'UPDATE sara_outreach_campaigns SET total_contacts = $1, status = $2 WHERE id = $3',
            [scheduled, scheduled > 0 ? (scheduledAt ? 'scheduled' : 'ready') : 'empty', campaignId]
        );

        return { campaignId, scheduled, skipped, reasons };
    } catch (err: any) {
        console.error('[OUTREACH] scheduleOutreachCampaign error:', err.message);
        return { campaignId: 0, scheduled: 0, skipped: contacts.length, reasons: [err.message] };
    }
}

// ─── Process Outreach Queue (called by interval) ───

async function processOutreachQueue(): Promise<void> {
    if (!activeSock) return;
    const check = await canSendNow();
    if (!check.allowed) return;

    try {
        // Get next batch of pending messages
        const pending = await pool.query(
            `SELECT om.*, oc.user_id, oc.status as campaign_status
             FROM sara_outreach_messages om
             JOIN sara_outreach_campaigns oc ON om.campaign_id = oc.id
             WHERE om.status = 'pending'
             AND om.scheduled_at <= NOW()
             AND oc.status IN ('ready', 'active', 'scheduled')
             ORDER BY om.scheduled_at
             LIMIT $1`,
            [OUTREACH_RULES.batch_size]
        );

        if (pending.rows.length === 0) return;

        // Mark campaign as active
        const campaignIds = [...new Set(pending.rows.map((r: any) => r.campaign_id))];
        for (const cid of campaignIds) {
            await pool.query(
                "UPDATE sara_outreach_campaigns SET status = 'active', started_at = COALESCE(started_at, NOW()) WHERE id = $1",
                [cid]
            );
        }

        for (const msg of pending.rows) {
            const sendCheck = await canSendNow();
            if (!sendCheck.allowed) {
                console.log(`[OUTREACH] Paused: ${sendCheck.reason}`);
                break;
            }

            try {
                await sendHumanized(activeSock, msg.phone, msg.message);

                await pool.query(
                    "UPDATE sara_outreach_messages SET status = 'sent', sent_at = NOW() WHERE id = $1",
                    [msg.id]
                );

                // Update campaign counters
                await pool.query(
                    'UPDATE sara_outreach_campaigns SET sent_count = sent_count + 1 WHERE id = $1',
                    [msg.campaign_id]
                );

                messagesToday++;
                messagesThisHour++;

                console.log(`[OUTREACH] Sent to ${msg.contact_name || '***'}`);

                // Respect minimum interval
                await new Promise(resolve => setTimeout(resolve, OUTREACH_RULES.min_interval_between_messages));
            } catch (err: any) {
                console.error(`[OUTREACH] Failed for ${msg.phone}:`, err.message);

                // Check for block/ban signals
                if (err.message?.includes('blocked') || err.message?.includes('banned') || err.message?.includes('rate')) {
                    lastBlockTime = Date.now();
                    outreachPaused = true;
                    console.error('[OUTREACH] BLOCK DETECTED — pausing for 24h');

                    await pool.query(
                        "UPDATE sara_outreach_messages SET status = 'failed', error = $1 WHERE id = $2",
                        [err.message, msg.id]
                    );

                    await pool.query(
                        'UPDATE sara_outreach_campaigns SET failed_count = failed_count + 1 WHERE id = $1',
                        [msg.campaign_id]
                    );
                    break;
                }

                await pool.query(
                    "UPDATE sara_outreach_messages SET status = 'failed', error = $1 WHERE id = $2",
                    [err.message?.substring(0, 500), msg.id]
                );

                await pool.query(
                    'UPDATE sara_outreach_campaigns SET failed_count = failed_count + 1 WHERE id = $1',
                    [msg.campaign_id]
                );
            }
        }

        // Check if any campaigns completed
        for (const cid of campaignIds) {
            const remaining = await pool.query(
                "SELECT COUNT(*)::int as c FROM sara_outreach_messages WHERE campaign_id = $1 AND status = 'pending'",
                [cid]
            );
            if (remaining.rows[0]?.c === 0) {
                await pool.query(
                    "UPDATE sara_outreach_campaigns SET status = 'completed', completed_at = NOW() WHERE id = $1",
                    [cid]
                );
                console.log(`[OUTREACH] Campaign ${cid} completed`);
            }
        }
    } catch (err: any) {
        console.error('[OUTREACH] processOutreachQueue error:', err.message);
    }
}

// ─── API Helpers ───

export async function getCampaigns(userId: string): Promise<any[]> {
    try {
        const r = await pool.query(
            `SELECT * FROM sara_outreach_campaigns WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`,
            [userId]
        );
        return r.rows;
    } catch (err: any) {
        console.error('[OUTREACH] getCampaigns failed:', err.message);
        return [];
    }
}

export async function getCampaignDetails(campaignId: number, userId: string): Promise<any> {
    try {
        const campaign = await pool.query(
            'SELECT * FROM sara_outreach_campaigns WHERE id = $1 AND user_id = $2',
            [campaignId, userId]
        );
        if (campaign.rows.length === 0) return null;

        const messages = await pool.query(
            'SELECT * FROM sara_outreach_messages WHERE campaign_id = $1 ORDER BY scheduled_at',
            [campaignId]
        );

        return {
            ...campaign.rows[0],
            messages: messages.rows,
        };
    } catch (err: any) {
        console.error(`[OUTREACH] getCampaignDetails failed for campaign ${campaignId}:`, err.message);
        return null;
    }
}

export async function startCampaign(campaignId: number, userId: string): Promise<boolean> {
    try {
        const r = await pool.query(
            "UPDATE sara_outreach_campaigns SET status = 'ready' WHERE id = $1 AND user_id = $2 AND status IN ('draft', 'scheduled')",
            [campaignId, userId]
        );
        return (r.rowCount || 0) > 0;
    } catch (err: any) {
        console.error(`[OUTREACH] startCampaign failed for campaign ${campaignId}:`, err.message);
        return false;
    }
}

export async function pauseCampaign(campaignId: number, userId: string): Promise<boolean> {
    try {
        const r = await pool.query(
            "UPDATE sara_outreach_campaigns SET status = 'paused' WHERE id = $1 AND user_id = $2 AND status IN ('ready', 'active')",
            [campaignId, userId]
        );
        return (r.rowCount || 0) > 0;
    } catch (err: any) {
        console.error(`[OUTREACH] pauseCampaign failed for campaign ${campaignId}:`, err.message);
        return false;
    }
}

export function getOutreachStatus(): {
    paused: boolean;
    messagesToday: number;
    messagesThisHour: number;
    lastBlockTime: number;
    rules: typeof OUTREACH_RULES;
} {
    return {
        paused: outreachPaused,
        messagesToday,
        messagesThisHour,
        lastBlockTime,
        rules: OUTREACH_RULES,
    };
}
