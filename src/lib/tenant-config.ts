// ═══════════════════════════════════════════════════
// SARA — Per-tenant runtime config (added 2026-04-16)
// ═══════════════════════════════════════════════════
// Reads `sara_confidence_threshold` and `tone_preset` from the tenants
// table (if present) with a small in-memory TTL cache so we don't hit
// the DB on every inbound message.

import { pool } from '../config.js';
import { DEFAULT_TONE, type ToneKey, resolveTone } from './tone-presets.js';
import { DEFAULT_RAG_CONFIDENCE_THRESHOLD } from './sara-bot-guardrails.js';

export interface TenantConfig {
    tenant_id: string | null;
    confidenceThreshold: number;
    tonePreset: ToneKey;
    escalationName: string;
    escalationEmail: string | null;
    escalationPhone: string | null;
}

const DEFAULTS: TenantConfig = {
    tenant_id: null,
    confidenceThreshold: DEFAULT_RAG_CONFIDENCE_THRESHOLD,
    tonePreset: DEFAULT_TONE,
    escalationName: 'il team dedicato',
    escalationEmail: 'contact@get-scala.com',
    escalationPhone: null,
};

// Very small TTL cache — tenant config doesn't change on the hot path.
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 min
const cache = new Map<string, { value: TenantConfig; expires: number }>();

/**
 * Ensure the tenants table has the columns we need. Called once on boot;
 * safe to call many times (IF NOT EXISTS).
 */
export async function ensureTenantColumns(): Promise<void> {
    try {
        // The `tenants` table may not exist in every deployment. Build a
        // minimal one if missing so WA bot can store per-tenant overrides.
        await pool.query(`
            CREATE TABLE IF NOT EXISTS tenants (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                user_id UUID,
                name TEXT,
                sara_confidence_threshold NUMERIC(4,3) DEFAULT 0.650,
                tone_preset TEXT DEFAULT 'caloroso',
                escalation_name TEXT,
                escalation_email TEXT,
                escalation_phone TEXT,
                created_at TIMESTAMPTZ DEFAULT now()
            );
            ALTER TABLE tenants ADD COLUMN IF NOT EXISTS sara_confidence_threshold NUMERIC(4,3) DEFAULT 0.650;
            ALTER TABLE tenants ADD COLUMN IF NOT EXISTS tone_preset TEXT DEFAULT 'caloroso';
            ALTER TABLE tenants ADD COLUMN IF NOT EXISTS escalation_name TEXT;
            ALTER TABLE tenants ADD COLUMN IF NOT EXISTS escalation_email TEXT;
            ALTER TABLE tenants ADD COLUMN IF NOT EXISTS escalation_phone TEXT;
        `);
    } catch (err: any) {
        // Non-fatal — continue with defaults.
        console.warn('[tenant-config] ensure columns failed:', err.message);
    }
}

/**
 * Load tenant config for a given scala_user_id (from wa_sessions).
 * Falls back to DEFAULTS if tenant row not found.
 */
export async function getTenantConfig(scalaUserId: string | null | undefined): Promise<TenantConfig> {
    if (!scalaUserId) return { ...DEFAULTS };
    const cached = cache.get(scalaUserId);
    if (cached && cached.expires > Date.now()) return cached.value;

    let cfg: TenantConfig = { ...DEFAULTS };
    try {
        const r = await pool.query(
            `SELECT id, sara_confidence_threshold, tone_preset,
                    escalation_name, escalation_email, escalation_phone
               FROM tenants WHERE user_id = $1 LIMIT 1`,
            [scalaUserId]
        );
        if (r.rows[0]) {
            const row = r.rows[0];
            cfg = {
                tenant_id: row.id,
                confidenceThreshold: row.sara_confidence_threshold != null
                    ? Number(row.sara_confidence_threshold)
                    : DEFAULTS.confidenceThreshold,
                tonePreset: resolveTone(row.tone_preset),
                escalationName: row.escalation_name || DEFAULTS.escalationName,
                escalationEmail: row.escalation_email || DEFAULTS.escalationEmail,
                escalationPhone: row.escalation_phone || DEFAULTS.escalationPhone,
            };
        }
    } catch { /* table may not exist yet — use defaults */ }

    cache.set(scalaUserId, { value: cfg, expires: Date.now() + CACHE_TTL_MS });
    return cfg;
}

/**
 * Clear cached config (used by backend route after tenant update).
 */
export function clearTenantConfigCache(scalaUserId?: string): void {
    if (scalaUserId) cache.delete(scalaUserId);
    else cache.clear();
}
