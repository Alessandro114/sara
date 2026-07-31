// reconnect-backoff.ts — persistent exponential backoff state machine
//
// Baileys' connection.update close events come in bursts. We DO NOT want to
// crash the process or reconnect instantly (both look bot-like and ring Meta's
// alarm bells). Instead: exponential schedule, max attempts per 24h window,
// persisted to disk so systemd/Docker restarts don't reset the counter.

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const STATE_FILE = resolve(process.cwd(), '.reconnect_state.json');
const WINDOW_MS = 24 * 60 * 60 * 1000; // 24h

// Exponential schedule: 15s, 30s, 60s, 2m, 4m, 8m, 16m, 30m, 30m, 30m, 30m, 30m → then DEAD.
// 12 attempts over 24h: very resilient to WhatsApp 503 bursts.
const SCHEDULE_MS = [
  15_000, 30_000, 60_000, 120_000, 240_000, 480_000,
  960_000, 1_800_000, 1_800_000, 1_800_000, 1_800_000, 1_800_000,
];
const MAX_ATTEMPTS = SCHEDULE_MS.length;

type State = {
  attempts: { at: number }[]; // rolling list of attempt timestamps
  lastReason: string | null;
};

function emptyState(): State {
  return { attempts: [], lastReason: null };
}

function load(): State {
  try {
    if (!existsSync(STATE_FILE)) return emptyState();
    const raw = readFileSync(STATE_FILE, 'utf8');
    const parsed = JSON.parse(raw) as State;
    if (!parsed || !Array.isArray(parsed.attempts)) return emptyState();
    return parsed;
  } catch {
    return emptyState();
  }
}

function save(s: State): void {
  try {
    writeFileSync(STATE_FILE, JSON.stringify(s, null, 2), 'utf8');
  } catch {
    /* non-fatal */
  }
}

/** Remove attempts outside the 24h rolling window. */
function prune(s: State): State {
  const cutoff = Date.now() - WINDOW_MS;
  s.attempts = s.attempts.filter(a => a.at >= cutoff);
  return s;
}

export type BackoffDecision =
  | { action: 'wait'; delayMs: number; attempt: number }
  | { action: 'dead'; reason: string };

/**
 * Record a new disconnect and return the next delay, or DEAD if we've blown
 * past the budget.
 */
export function nextBackoff(reason: string): BackoffDecision {
  const s = prune(load());
  const idx = s.attempts.length;
  if (idx >= MAX_ATTEMPTS) {
    return { action: 'dead', reason: `max reconnect attempts (${MAX_ATTEMPTS}) in 24h window; last=${reason}` };
  }
  s.attempts.push({ at: Date.now() });
  s.lastReason = reason;
  save(s);
  return { action: 'wait', delayMs: SCHEDULE_MS[idx]!, attempt: idx + 1 };
}

/** Called when we successfully connect — clears the budget so we go back to 30s. */
export function resetBackoff(): void {
  save(emptyState());
}

/** For diagnostics / dead-man log. */
export function snapshotBackoff(): State {
  return prune(load());
}
