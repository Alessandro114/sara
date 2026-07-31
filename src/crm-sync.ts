// ═══════════════════════════════════════════════════
// S.A.R.A. → SCALA CRM Sync
// v2: Auto-sync EVERY contact on first message + progressive enrichment.
// v1: Pushed only qualified leads via webhook.
// ═══════════════════════════════════════════════════
// P1 fix 2026-04-12: exponential backoff retry + disk-backed queue.
// Backend restarts and network blips must never cause a lost lead.
// ═══════════════════════════════════════════════════
// 2026-04-17: Direct DB upsert (same DB via Docker), auto-tagging,
// debounced progressive enrichment on every message.
// ═══════════════════════════════════════════════════

import { existsSync, appendFileSync, readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import pino from 'pino';
import { pool } from './config.js';
import { normalizePhone, redactPhone } from './lib/phone-utils.js';

const SCALA_BACKEND_URL = process.env.SCALA_BACKEND_URL || 'https://api.get-scala.com';
// SECURITY: never fall back to a well-known default — must be set in env.
const SARA_API_KEY = process.env.SARA_API_KEY || '';
const PENDING_FILE = resolve(process.cwd(), '.pending_crm_syncs.jsonl');

const log = pino({ name: 'crm-sync', level: 'info' });

// ═══════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════

export interface LeadPayload {
    phone: string;
    user_name?: string;
    company_name?: string;
    company_size?: string;
    estimated_revenue?: string;
    email?: string;
    lead_score?: number;
    lead_stage?: string;
    sector?: string;
}

interface QueueEntry extends LeadPayload {
    _queuedAt: number;
    _attempts: number;
}

/** Payload for the new auto-sync on every message */
export interface CRMSyncPayload {
    phone: string;
    name?: string;
    company?: string;
    email?: string;
    sector?: string;
    company_size?: string;
    estimated_revenue?: string;
    lead_score: number;
    tags: string[];
    note?: string;
    /** The SCALA admin user_id who owns this SARA instance */
    owner_user_id: string;
}

// ═══════════════════════════════════════════════════
// Auto-tag detection
// ═══════════════════════════════════════════════════

/** Detect CRM-relevant tags from a message + AI response */
export function detectCRMTags(text: string, aiResponse?: string): string[] {
    const tags: string[] = [];
    const lower = text.toLowerCase();

    // pricing_interested
    if (/\b(quanto costa|prezzo|costo|tariff[ae]|listino|pricing|abbonamento|piano[i]?|mensile|annuale|sconto|offerta|how much|price|plan)\b/i.test(lower)) {
        tags.push('pricing_interested');
    }

    // demo_requested
    if (/\b(demo|mostrami|far[me]i vedere|come funziona|video demo|tutorial|provare|prova|trial|show me|can i see)\b/i.test(lower)) {
        tags.push('demo_requested');
    }

    // competitor_mentioned
    if (/\b(bitrix|odoo|salesforce|hubspot|zoho|pipedrive|monday|clickup|freshsales|sugar.?crm|vtiger|notion|asana|trello)\b/i.test(lower)) {
        tags.push('competitor_mentioned');
    }

    // budget_mentioned
    if (/\b(budget|investimento|spesa|investire|spending|quanto posso|quanto dovrei|cifra|importo)\b/i.test(lower)) {
        tags.push('budget_mentioned');
    }
    // Also detect numeric budget signals
    if (/\b\d+\s*(k|mila|thousand|euro|eur|\$|usd)\b/i.test(lower)) {
        tags.push('budget_mentioned');
    }

    // decision_maker
    if (/\b(titolare|fondatore|founder|ceo|proprietario|socio|partner|direttore|amministratore|owner|io decido|decido io|gestisco|la mia azienda|il mio studio|il mio ristorante|il mio hotel|cto|cfo|coo|managing director|general manager)\b/i.test(lower)) {
        tags.push('decision_maker');
    }

    // multi_branch
    if (/\b(sedi|filiali|punti vendita|branch|location[si]?|multi.?sede|più sedi|diverse sedi|catena|franchis)\b/i.test(lower)) {
        tags.push('multi_branch');
    }

    // urgent
    if (/\b(urgente|subito|immediatamente|al più presto|ho bisogno ora|ho fretta|asap|urgently|right away|entro domani|entro oggi|critical|emergenz)\b/i.test(lower)) {
        tags.push('urgent');
    }

    // Deduplicate
    return [...new Set(tags)];
}

// ═══════════════════════════════════════════════════
// Debounce: max 1 sync per phone per 5 minutes
// ═══════════════════════════════════════════════════

const DEBOUNCE_MS = 5 * 60 * 1000; // 5 minutes
const lastSyncTime = new Map<string, number>();

function shouldSync(phone: string): boolean {
    const now = Date.now();
    const last = lastSyncTime.get(phone) || 0;
    if (now - last < DEBOUNCE_MS) return false;
    lastSyncTime.set(phone, now);
    // Hard cap to prevent unbounded growth under extreme load
    if (lastSyncTime.size > 50000) {
        const cutoff = Date.now() - DEBOUNCE_MS;
        for (const [p, ts] of lastSyncTime) {
            if (ts < cutoff) lastSyncTime.delete(p);
        }
    }
    return true;
}

// Clean up stale entries every 30 min to prevent memory leak
setInterval(() => {
    const cutoff = Date.now() - DEBOUNCE_MS * 2;
    for (const [phone, ts] of lastSyncTime) {
        if (ts < cutoff) lastSyncTime.delete(phone);
    }
}, 30 * 60 * 1000).unref();

// ═══════════════════════════════════════════════════
// Auto-sync: upsert contact in crm_contacts (direct DB)
// Called on EVERY incoming message (debounced).
// ═══════════════════════════════════════════════════

/**
 * Sync a WhatsApp contact to SCALA CRM on every message.
 * - First message: creates a new CRM contact with source=whatsapp_sara
 * - Subsequent: progressive enrichment (name, company, email, tags, score)
 * - Debounced: max 1 DB write per phone per 5 minutes
 * - Non-blocking: errors are logged, never thrown
 */
export async function syncContactToCRM(payload: CRMSyncPayload): Promise<void> {
    try {
        const cleanPhone = normalizePhone(payload.phone);
        if (!cleanPhone || cleanPhone.length < 5) return;

        // Debounce check
        if (!shouldSync(cleanPhone)) {
            log.debug({ phone: redactPhone(cleanPhone) }, 'crm sync debounced');
            return;
        }

        // Build the note (timestamp + snippet)
        const noteEntry = payload.note
            ? `[${new Date().toISOString().slice(0, 16)}] ${payload.note.substring(0, 200)}`
            : null;

        // Filter out empty tags
        const tags = (payload.tags || []).filter(t => t && t.length > 0);

        // Upsert into crm_contacts
        // ON CONFLICT on (user_id, phone) — the unique index from migration 094
        await pool.query(`
            INSERT INTO crm_contacts (
                user_id, name, email, phone, company, lead_score,
                status, source, tags, notes, data,
                last_message_at, wa_messages_count,
                created_at, updated_at
            ) VALUES (
                $1::uuid, $2, $3, $4, $5, $6,
                'lead', 'whatsapp_sara', $7, $8,
                jsonb_build_object(
                    'sector', $9,
                    'company_size', $10,
                    'estimated_revenue', $11,
                    'wa_phone_raw', $12
                ),
                NOW(), 1,
                NOW(), NOW()
            )
            ON CONFLICT (user_id, phone) WHERE phone IS NOT NULL
            DO UPDATE SET
                name = COALESCE(NULLIF(EXCLUDED.name, ''), crm_contacts.name),
                company = COALESCE(NULLIF(EXCLUDED.company, ''), crm_contacts.company),
                email = COALESCE(NULLIF(EXCLUDED.email, ''), crm_contacts.email),
                lead_score = GREATEST(crm_contacts.lead_score, EXCLUDED.lead_score),
                tags = (
                    SELECT ARRAY(SELECT DISTINCT unnest(
                        COALESCE(crm_contacts.tags, '{}') || COALESCE(EXCLUDED.tags, '{}')
                    ))
                ),
                notes = CASE
                    WHEN EXCLUDED.notes IS NOT NULL AND EXCLUDED.notes != ''
                    THEN COALESCE(crm_contacts.notes, '') || E'\n' || EXCLUDED.notes
                    ELSE crm_contacts.notes
                END,
                data = crm_contacts.data || COALESCE(
                    jsonb_strip_nulls(EXCLUDED.data),
                    '{}'::jsonb
                ),
                last_message_at = NOW(),
                wa_messages_count = COALESCE(crm_contacts.wa_messages_count, 0) + 1,
                updated_at = NOW()
        `, [
            payload.owner_user_id,                          // $1 user_id
            payload.name || null,                           // $2 name
            payload.email || null,                          // $3 email
            cleanPhone,                                     // $4 phone
            payload.company || null,                        // $5 company
            payload.lead_score || 10,                       // $6 lead_score
            tags.length > 0 ? tags : [],                    // $7 tags
            noteEntry || null,                              // $8 notes
            payload.sector || null,                         // $9 sector (in data JSONB)
            payload.company_size || null,                   // $10 company_size (in data JSONB)
            payload.estimated_revenue || null,              // $11 estimated_revenue (in data JSONB)
            payload.phone,                                  // $12 wa_phone_raw (in data JSONB)
        ]);

        log.info(
            {
                phone: redactPhone(cleanPhone),
                tags: tags.length > 0 ? tags : undefined,
                score: payload.lead_score,
            },
            'crm contact synced'
        );
    } catch (err: any) {
        // Non-blocking — CRM sync failures must never crash the bot
        log.error({ phone: redactPhone(payload.phone), err: err.message }, 'crm sync failed');
    }
}

// ═══════════════════════════════════════════════════
// Helper: resolve the SCALA admin user_id for CRM ownership
// ═══════════════════════════════════════════════════

let _cachedAdminUserId: string | null = null;

/**
 * Get the SCALA admin user_id to own CRM contacts created by SARA.
 * Tries env var first, then looks up the first admin user in the DB.
 * Cached after first successful lookup.
 */
export async function getAdminUserId(): Promise<string | null> {
    if (_cachedAdminUserId) return _cachedAdminUserId;

    // 1. Try env var (fastest, explicit)
    const envId = process.env.SCALA_ADMIN_USER_ID;
    if (envId && envId.length > 10) {
        _cachedAdminUserId = envId;
        return envId;
    }

    // 2. Lookup from DB — same pool (Docker, same DB)
    try {
        const scalaDbUrl = process.env.SCALA_DB_URL;
        if (scalaDbUrl) {
            const pg = (await import('pg')).default;
            const scalaPool = new pg.Pool({ connectionString: scalaDbUrl });
            scalaPool.on('error', (err: any) => log.error({ err: err?.message }, 'idle client error'));
            try {
                const r = await scalaPool.query(
                    `SELECT id FROM profiles WHERE is_admin = true ORDER BY created_at ASC LIMIT 1`
                );
                if (r.rows.length > 0) {
                    _cachedAdminUserId = r.rows[0].id;
                    log.info({ userId: _cachedAdminUserId }, 'admin user_id resolved from SCALA DB');
                    return _cachedAdminUserId;
                }
            } finally {
                await scalaPool.end();
            }
        }

        // 3. Fallback: try the bot's own pool (if same DB)
        const r = await pool.query(
            `SELECT id FROM profiles WHERE is_admin = true ORDER BY created_at ASC LIMIT 1`
        );
        if (r.rows.length > 0) {
            _cachedAdminUserId = r.rows[0].id;
            log.info({ userId: _cachedAdminUserId }, 'admin user_id resolved from local DB');
            return _cachedAdminUserId;
        }
    } catch (err: any) {
        log.warn({ err: err.message }, 'failed to resolve admin user_id');
    }

    return null;
}

// ═══════════════════════════════════════════════════
// Legacy: HTTP-based webhook sync (for qualified leads)
// Kept for backward compatibility
// ═══════════════════════════════════════════════════

let _syncEnabled: boolean | null = null;

function isSyncEnabled(): boolean {
    if (_syncEnabled === null) {
        const key = process.env.SARA_API_KEY || '';
        _syncEnabled = !!(process.env.SCALA_BACKEND_URL && key &&
            key !== 'sara-dev-key-change-in-production' &&
            key.length >= 32);
    }
    return _syncEnabled;
}


// Single attempt. Throws on non-2xx or network error so retry loop can catch.
async function postLeadOnce(lead: LeadPayload): Promise<void> {
    const res = await fetch(`${SCALA_BACKEND_URL}/api/sara/lead-webhook`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Sara-Api-Key': SARA_API_KEY,
        },
        body: JSON.stringify(lead),
        // Generous per-attempt timeout — 5 attempts × 10s max = 50s upper bound
        signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
}

/**
 * Push a qualified lead to SCALA CRM with exponential backoff.
 * Backoff: 1s → 2s → 4s → 8s → 16s (5 attempts total).
 * On final failure, the lead is appended to a JSONL queue for later drain.
 */
export async function syncLeadToSCALA(lead: LeadPayload): Promise<void> {
    if (!isSyncEnabled()) {
        log.info({ phone: redactPhone(lead.phone) }, 'sync skipped — backend not configured');
        return;
    }

    const delays = [1000, 2000, 4000, 8000, 16000];
    let lastErr: Error | null = null;

    for (let attempt = 0; attempt < delays.length; attempt++) {
        try {
            await postLeadOnce(lead);
            if (attempt > 0) {
                log.info(
                    { phone: redactPhone(lead.phone), attempt: attempt + 1, stage: lead.lead_stage },
                    'lead synced after retries'
                );
            } else {
                log.info(
                    { phone: redactPhone(lead.phone), stage: lead.lead_stage },
                    'lead synced'
                );
            }
            return;
        } catch (err: any) {
            lastErr = err;
            const isLast = attempt === delays.length - 1;
            log.info(
                {
                    phone: redactPhone(lead.phone),
                    attempt: attempt + 1,
                    nextDelayMs: isLast ? null : delays[attempt],
                    err: err.message,
                },
                isLast ? 'sync failed — queueing for drain' : 'sync attempt failed, backing off'
            );
            if (!isLast) {
                await new Promise(r => setTimeout(r, delays[attempt]));
            }
        }
    }

    // All retries exhausted — persist to disk so a later drain can retry.
    enqueueForLaterDrain(lead, lastErr?.message || 'unknown');
}

// Append-only JSONL queue — crash-safe, no locking overhead for single writer.
function enqueueForLaterDrain(lead: LeadPayload, reason: string): void {
    try {
        const entry: QueueEntry = { ...lead, _queuedAt: Date.now(), _attempts: 5 };
        appendFileSync(PENDING_FILE, JSON.stringify(entry) + '\n', 'utf8');
        log.warn(
            { phone: redactPhone(lead.phone), reason },
            'lead persisted to pending queue'
        );
    } catch (err: any) {
        // Non-recoverable (e.g. disk full) — must not crash the bot.
        log.error({ phone: redactPhone(lead.phone), err: err.message }, 'failed to persist pending lead');
    }
}

// Drain pending leads from disk. Runs on interval — safe to call concurrently
// because we rewrite the file atomically per pass (read → clear → retry → reappend-failures).
let draining = false;
export async function drainPendingCrmSyncs(): Promise<void> {
    if (draining) return; // prevent overlap if a drain is slow
    if (!existsSync(PENDING_FILE)) return;
    if (!isSyncEnabled()) return;

    draining = true;
    try {
        const raw = readFileSync(PENDING_FILE, 'utf8');
        const lines = raw.split('\n').filter(l => l.trim().length > 0);
        if (lines.length === 0) {
            writeFileSync(PENDING_FILE, '', 'utf8');
            return;
        }

        log.info({ count: lines.length }, 'draining pending crm syncs');

        // Clear the file up-front so new fail-through entries don't collide
        // with the ones we are currently retrying.
        writeFileSync(PENDING_FILE, '', 'utf8');

        const stillFailing: QueueEntry[] = [];
        for (const line of lines) {
            let entry: QueueEntry;
            try {
                entry = JSON.parse(line);
            } catch {
                continue; // drop malformed line
            }

            try {
                // Single attempt per drain pass — the 5-min interval is the retry cadence here.
                await postLeadOnce(entry);
                log.info(
                    { phone: redactPhone(entry.phone), ageMin: Math.round((Date.now() - entry._queuedAt) / 60000) },
                    'pending lead drained successfully'
                );
            } catch (err: any) {
                entry._attempts = (entry._attempts || 5) + 1;
                stillFailing.push(entry);
                log.info(
                    { phone: redactPhone(entry.phone), attempts: entry._attempts, err: err.message },
                    'pending lead still failing'
                );
            }
        }

        // Re-append survivors. If they've been failing for 7+ days, drop to prevent infinite growth.
        const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
        const keepers = stillFailing.filter(e => Date.now() - e._queuedAt < SEVEN_DAYS);
        const dropped = stillFailing.length - keepers.length;
        if (dropped > 0) {
            log.warn({ dropped }, 'dropping pending leads older than 7 days');
        }
        for (const e of keepers) {
            appendFileSync(PENDING_FILE, JSON.stringify(e) + '\n', 'utf8');
        }
    } catch (err: any) {
        log.error({ err: err.message }, 'drain pass failed');
    } finally {
        draining = false;
    }
}

// Kick off background drain loop (5 min cadence). Idempotent.
let drainTimer: NodeJS.Timeout | null = null;
export function startCrmSyncDrainLoop(): void {
    if (drainTimer) return;
    // Run first pass after 30s so backend has time to come up on cold start.
    setTimeout(() => { drainPendingCrmSyncs().catch(() => { }); }, 30_000);
    drainTimer = setInterval(() => {
        drainPendingCrmSyncs().catch(err => log.error({ err: err.message }, 'drain timer error'));
    }, 5 * 60 * 1000);
    // Allow Node to exit cleanly during tests / shutdown
    if (typeof drainTimer.unref === 'function') drainTimer.unref();
    log.info('crm sync drain loop started (5min interval)');

    // Pre-warm admin user_id cache — log P0 warning if not resolvable
    getAdminUserId().then(id => {
        if (!id) {
            log.error(
                '🚨 CRM SYNC DISABLED: No SCALA admin profile found in the database. ' +
                'Log in to app.get-scala.com at least once to create your profile, ' +
                'then restart SARA. All WA contacts will NOT be saved to CRM until fixed.'
            );
        } else {
            log.info({ userId: id }, '✅ CRM sync active — contacts will be saved under admin account');
        }
    }).catch(() => { });
}
