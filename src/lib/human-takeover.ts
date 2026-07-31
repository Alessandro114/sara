// ═══════════════════════════════════════════════════════════
// SARA Human Takeover — Toggle AI/Human control per chat
//
// Modes per conversation:
//   'ai'      → SARA responds normally (default)
//   'human'   → SARA stops responding, only listens silently (CRM enrichment continues)
//   'hybrid'  → SARA drafts response, human approves before sending
//
// Trigger:
//   - Backend API: POST /api/sara/takeover { phone, mode }
//   - WhatsApp command: operator sends "SARA stop" / "SARA riprendi"
//   - Dashboard toggle button
// ═══════════════════════════════════════════════════════════

import type pg from 'pg';
import pino from 'pino';
import { normalizePhone as normalizePhoneUtil, redactPhone } from './phone-utils.js';

const log = pino({ name: 'takeover' });

export type TakeoverMode = 'ai' | 'human' | 'hybrid';

interface TakeoverState {
  phone: string;
  mode: TakeoverMode;
  taken_by?: string; // operator name/id
  reason?: string;
  since: Date;
  auto_resume_at?: Date; // optional: auto-resume AI after X hours
}

// In-memory cache (fast lookup on every message)
const takeoverCache = new Map<string, TakeoverState>();

// ─── Core Functions ─────────────────────────────────────

/**
 * Check if a conversation is in human takeover mode.
 * Called on EVERY incoming message before SARA responds.
 */
export function isHumanTakeover(phone: string): boolean {
  const state = takeoverCache.get(normalizePhone(phone));
  if (!state) return false;

  // Check auto-resume
  if (state.auto_resume_at && new Date() > state.auto_resume_at) {
    takeoverCache.delete(normalizePhone(phone));
    return false;
  }

  // Both 'human' and 'hybrid' stop AI from auto-responding.
  // Hybrid drafts are not yet implemented — treated as human until then.
  return state.mode === 'human' || state.mode === 'hybrid';
}

/**
 * Get current mode for a conversation.
 */
export function getTakeoverMode(phone: string): TakeoverMode {
  const state = takeoverCache.get(normalizePhone(phone));
  if (!state) return 'ai';

  if (state.auto_resume_at && new Date() > state.auto_resume_at) {
    takeoverCache.delete(normalizePhone(phone));
    return 'ai';
  }

  return state.mode;
}

/**
 * Set takeover mode for a conversation.
 */
export async function setTakeoverMode(
  phone: string,
  mode: TakeoverMode,
  pool: pg.Pool,
  options?: {
    taken_by?: string;
    reason?: string;
    auto_resume_hours?: number;
  }
): Promise<void> {
  const normalized = normalizePhone(phone);

  if (mode === 'ai') {
    // Resume AI
    takeoverCache.delete(normalized);
    await pool.query(
      `UPDATE wa_sessions SET takeover_mode = 'ai', takeover_by = NULL, takeover_at = NULL WHERE phone = $1`,
      [normalized]
    );
    log.info({ phone: redact(normalized), mode }, 'AI resumed');
    return;
  }

  const state: TakeoverState = {
    phone: normalized,
    mode,
    taken_by: options?.taken_by,
    reason: options?.reason,
    since: new Date(),
    auto_resume_at: options?.auto_resume_hours
      ? new Date(Date.now() + options.auto_resume_hours * 3600000)
      : undefined,
  };

  // Prevent unbounded growth — evict expired auto-resume entries
  if (takeoverCache.size > 5000) {
      const now = new Date();
      for (const [key, val] of takeoverCache) {
          if (val.auto_resume_at && now > val.auto_resume_at) {
              takeoverCache.delete(key);
          }
      }
      // If still too large, evict oldest entries
      if (takeoverCache.size > 5000) {
          const sorted = [...takeoverCache.entries()].sort((a, b) => a[1].since.getTime() - b[1].since.getTime());
          const toEvict = sorted.slice(0, sorted.length - 4000);
          for (const [key] of toEvict) takeoverCache.delete(key);
      }
  }

  takeoverCache.set(normalized, state);

  // Persist to DB
  await pool.query(
    `UPDATE wa_sessions
     SET takeover_mode = $1, takeover_by = $2, takeover_at = NOW()
     WHERE phone = $3`,
    [mode, options?.taken_by || 'operator', normalized]
  );

  log.info({ phone: redact(normalized), mode, taken_by: options?.taken_by }, 'takeover mode changed');
}

/**
 * List all conversations currently in human takeover.
 */
export async function listTakeovers(pool: pg.Pool): Promise<TakeoverState[]> {
  const { rows } = await pool.query(
    `SELECT phone, takeover_mode, takeover_by, takeover_at
     FROM wa_sessions
     WHERE takeover_mode != 'ai' AND takeover_mode IS NOT NULL
     ORDER BY takeover_at DESC`
  );

  return rows.map(r => ({
    phone: r.phone,
    mode: r.takeover_mode as TakeoverMode,
    taken_by: r.takeover_by,
    since: r.takeover_at,
  }));
}

/**
 * Check if an incoming WhatsApp message from an OPERATOR contains a takeover command.
 * Returns the requested mode or null if not a command.
 *
 * Supported commands (case-insensitive, multilingual):
 *   "SARA stop" / "SARA fermati" / "prendo io" → human
 *   "SARA riprendi" / "SARA resume" / "SARA vai" → ai
 *   "SARA draft" / "SARA bozza" → hybrid
 */
export function detectTakeoverCommand(message: string): TakeoverMode | null {
  const lower = message.toLowerCase().trim();

  // Human takeover
  if (/^sara\s+(stop|fermati|pausa|pause|basta)$/i.test(lower)) return 'human';
  if (/^prendo\s+io$/i.test(lower)) return 'human';
  if (/^takeover$/i.test(lower)) return 'human';

  // Resume AI
  if (/^sara\s+(riprendi|resume|vai|go|continua|torna)$/i.test(lower)) return 'ai';
  if (/^sara\s+ok$/i.test(lower)) return 'ai';

  // Hybrid mode
  if (/^sara\s+(draft|bozza|suggerisci|suggest)$/i.test(lower)) return 'hybrid';

  return null;
}

/**
 * Load takeover states from DB into memory cache (called on startup).
 */
export async function loadTakeoverStates(pool: pg.Pool): Promise<void> {
  try {
    // Ensure columns exist
    await pool.query(`
      ALTER TABLE wa_sessions ADD COLUMN IF NOT EXISTS takeover_mode TEXT DEFAULT 'ai';
      ALTER TABLE wa_sessions ADD COLUMN IF NOT EXISTS takeover_by TEXT;
      ALTER TABLE wa_sessions ADD COLUMN IF NOT EXISTS takeover_at TIMESTAMPTZ;
    `);

    const { rows } = await pool.query(
      `SELECT phone, takeover_mode, takeover_by, takeover_at
       FROM wa_sessions
       WHERE takeover_mode IS NOT NULL AND takeover_mode != 'ai'`
    );

    for (const r of rows) {
      takeoverCache.set(r.phone, {
        phone: r.phone,
        mode: r.takeover_mode as TakeoverMode,
        taken_by: r.takeover_by,
        since: r.takeover_at || new Date(),
      });
    }

    log.info({ count: takeoverCache.size }, 'loaded takeover states from DB');
  } catch (err) {
    log.warn({ err }, 'could not load takeover states — first run?');
  }
}

// ─── Helpers ────────────────────────────────────────────

function normalizePhone(phone: string): string {
  return normalizePhoneUtil(phone);
}

function redact(phone: string): string {
  return redactPhone(phone);
}
