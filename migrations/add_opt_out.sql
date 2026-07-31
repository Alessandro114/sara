-- ═══════════════════════════════════════════════════
-- Migration: add opted_out to wa_sessions
-- Date: 2026-04-12
-- ═══════════════════════════════════════════════════
-- The column is already added by src/db.ts initDB() at startup,
-- but we keep this file so a fresh/foreign DB can be bootstrapped
-- manually (idempotent — safe to rerun).
-- ═══════════════════════════════════════════════════

ALTER TABLE wa_sessions
    ADD COLUMN IF NOT EXISTS opted_out BOOLEAN DEFAULT false;

ALTER TABLE wa_sessions
    ADD COLUMN IF NOT EXISTS opted_out_at TIMESTAMPTZ;

-- Backfill opted_out_at from opted_out flag for rows that were flipped
-- before this column existed.
UPDATE wa_sessions
SET opted_out_at = now()
WHERE opted_out = true AND opted_out_at IS NULL;
