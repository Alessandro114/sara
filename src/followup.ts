// ═══════════════════════════════════════════════════
// SCALA WhatsApp Bot — Follow-up Scheduler (v2 — Dynamic AI Messages)
// ═══════════════════════════════════════════════════
// Runs every 5 minutes. Checks wa_lead_followups table
// for scheduled messages and generates unique messages
// via the LLM chain (Groq→Cerebras→Mistral) at send time (not static templates).
// ═══════════════════════════════════════════════════
import type { SockLike } from './wa-adapter.js';
// The scheduler only ever needs `isReady` + the send path; keep the surface loose for
// callers that pass a wwebjs-compatible object, but require the readiness signal.
type WASocket = Partial<SockLike> & Record<string, any>;
import { getPendingFollowups, markFollowupSent, getLastTopics, pool } from './db.js';
import { generateFollowupMessage, cleanupExpiredCache } from './ai.js';
import { sendHumanized } from './humanize.js';
import { getClientProfile, checkAndGenerateSummary } from './lib/conversation-memory.js';
import pino from 'pino';

const log = pino({ name: 'followup', level: 'info' });
const CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

// STOP keywords across IT/EN/ES/PT. A match in ANY inbound message marks
// the user as opted-out for the purpose of follow-up suppression.
const STOP_KEYWORD_RE = /\b(stop|unsubscribe|opt[-\s]?out|basta|non\s+scrivere(?:mi)?|cancela|cancelar|pare|pare\s+de\s+escrever)\b/i;

function redactPhone(phone: string): string {
    const digits = (phone || '').replace(/\D/g, '');
    return digits.length >= 4 ? `***${digits.slice(-4)}` : '****';
}

/**
 * Return true if the user has opted out of follow-ups.
 * Two signals are checked:
 *   1. wa_sessions.opted_out = true (set by any admin/self-serve flow).
 *   2. Any inbound wa_messages row containing a STOP keyword.
 * On the first STOP match we also persist `opted_out=true` so subsequent
 * checks are cheap.
 */
async function hasOptedOut(phone: string): Promise<boolean> {
    try {
        const s = await pool.query('SELECT opted_out FROM wa_sessions WHERE phone=$1', [phone]);
        if (s.rows[0]?.opted_out === true) return true;

        // Lazy scan for STOP keywords — only inbound messages, capped at 50
        // to avoid full table scans on chatty users.
        const r = await pool.query(
            `SELECT content FROM wa_messages
             WHERE phone=$1 AND direction='in'
             ORDER BY created_at DESC LIMIT 50`,
            [phone]
        );
        for (const row of r.rows as Array<{ content: string }>) {
            if (STOP_KEYWORD_RE.test(row.content || '')) {
                // Persist — next check short-circuits.
                await pool.query(
                    'UPDATE wa_sessions SET opted_out=true, opted_out_at=now() WHERE phone=$1',
                    [phone]
                );
                log.info({ phone: redactPhone(phone) }, 'user opted out via STOP keyword');
                return true;
            }
        }
        return false;
    } catch (err: any) {
        // If the DB lookup fails we err on the side of NOT sending — better to
        // skip a follow-up than to harass a user who opted out.
        log.warn({ phone: redactPhone(phone), err: err.message }, 'opt-out check failed — skipping send');
        return true;
    }
}

/**
 * Start the follow-up scheduler background loop.
 * Called once at bot startup.
 */
export function startFollowupScheduler(sock: WASocket): void {
    console.log('[FOLLOWUP] Scheduler started — checking every 5 minutes');

    let cacheCleanupCounter = 0;
    const CACHE_CLEANUP_EVERY_N = 288; // 288 * 5min = ~24h

    setInterval(async () => {
        try {
            // Cache cleanup every ~24h
            cacheCleanupCounter++;
            if (cacheCleanupCounter >= CACHE_CLEANUP_EVERY_N) {
                cacheCleanupCounter = 0;
                await cleanupExpiredCache();
            }

            // Skip if no active WhatsApp session — avoids "Cannot read properties of null"
            // inside whatsapp-web.js puppeteer when the bot process is up but
            // the client hasn't paired with a number yet.
            // NOTE: this used to read `sock.isReady === false`, but `isReady` did not exist
            // on the adapter at all — `undefined === false` is false, so the guard never
            // fired and follow-ups were pushed at an unpaired client. `isReady` is now a
            // real getter on SockLike (wa-adapter.ts). Test for "not ready" (not "=== false")
            // so a sock missing the property is treated as unsafe rather than ready.
            if (!sock || sock.isReady !== true) {
                log.debug('WhatsApp client not ready — skipping follow-up cycle');
                return;
            }

            const pending = await getPendingFollowups();
            if (pending.length === 0) return;

            console.log(`[FOLLOWUP] Processing ${pending.length} pending follow-ups`);

            for (const followup of pending) {
                try {
                    // Don't send to converted or lost leads
                    if (followup.lead_stage === 'converted' || followup.lead_stage === 'lost') {
                        await markFollowupSent(followup.id);
                        continue;
                    }

                    // P1 fix: respect opt-out (column + STOP keywords in history).
                    // Mark as sent so we stop retrying this row forever.
                    if (await hasOptedOut(followup.phone)) {
                        log.info(
                            { phone: redactPhone(followup.phone), type: followup.followup_type },
                            'followup skipped — user opted out'
                        );
                        await markFollowupSent(followup.id);
                        continue;
                    }

                    // P0 fix: never send proactive messages to a raw WhatsApp LID
                    // (@lid) JID. Since May 2026 WhatsApp exposes some chats as
                    // "<id>@lid" with no stable mapping to a real phone number;
                    // the live wwjs adapter stores that raw, and firing a cold
                    // re-engagement at it can mis-deliver to the wrong contact.
                    // Skip + mark sent so we stop retrying this row forever.
                    if (/@lid$/i.test(followup.phone)) {
                        log.warn(
                            { phone: redactPhone(followup.phone), type: followup.followup_type },
                            'followup skipped — unresolved @lid JID (no real phone)'
                        );
                        await markFollowupSent(followup.id);
                        continue;
                    }

                    // Extract the day count from the followup type (e.g. 'reengagement_7d' → 7)
                    const daysMatch = followup.followup_type.match(/(\d+)d$/);
                    const days = daysMatch ? parseInt(daysMatch[1]) : 7;

                    // Get recent topics for context + memory profile
                    const lastTopics = await getLastTopics(followup.phone);
                    const language = followup.user_language || 'it';

                    // Enrich follow-up with profile memory
                    let enrichedTopics = lastTopics || '';
                    try {
                        const profile = await getClientProfile(followup.phone);
                        if (profile) {
                            const extras: string[] = [];
                            if (profile.interests?.length > 0) extras.push(`Interessi: ${profile.interests.join(', ')}`);
                            if (profile.pain_points?.length > 0) extras.push(`Problemi: ${profile.pain_points.join(', ')}`);
                            if (profile.budget_range) extras.push(`Budget: ${profile.budget_range}`);
                            if (profile.company) extras.push(`Azienda: ${profile.company}`);
                            if (profile.decision_timeline) extras.push(`Timeline: ${profile.decision_timeline}`);
                            if (extras.length > 0) {
                                enrichedTopics = `${enrichedTopics}\nProfilo cliente: ${extras.join('. ')}`;
                            }
                        }
                    } catch { /* profile enrichment is non-blocking */ }

                    // Generate a unique message via AI (falls back to static if API unavailable)
                    const message = await generateFollowupMessage(
                        days,
                        followup.user_name || '',
                        followup.sector || 'general',
                        enrichedTopics,
                        language
                    );

                    await sendHumanized(sock, followup.phone, message);
                    await markFollowupSent(followup.id);

                    console.log(`[FOLLOWUP] Sent ${followup.followup_type} to ${redactPhone(followup.phone)}`);

                    // Small delay between follow-ups to avoid flooding
                    await new Promise(resolve => setTimeout(resolve, 3000));
                } catch (err: any) {
                    console.error(`[FOLLOWUP] Error sending to ${followup.phone}:`, err.message);
                }
            }
        } catch (err: any) {
            console.error('[FOLLOWUP] Scheduler error:', err.message);
        }
    }, CHECK_INTERVAL_MS).unref();
}
