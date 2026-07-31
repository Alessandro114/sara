// fingerprints.ts — Pool of realistic desktop browser fingerprints + session persistence
//
// Baileys' `browser` parameter feeds into the Noise handshake payload that identifies
// the "companion device" to Meta. Using a static or too-fresh fingerprint correlates
// reconnects and raises anti-bot flags. We pick one per pair session and persist it.
//
// The selected fingerprint is written to .session_fingerprint.json so that restarts
// reuse the same identity (consistency = trust). On a full re-pair we rotate to a
// different entry from the pool.

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';

export type Fingerprint = [string, string, string]; // [device, browser, version]

// Curated list of realistic desktop browsers — release dates late 2023 / early 2024.
// Keep values ISO-stable so Meta can't tell them apart from real clients.
const POOL: Fingerprint[] = [
  ['Ubuntu', 'Chrome', '120.0.6099.224'],
  ['Windows', 'Edge', '120.0.2210.91'],
  ['macOS', 'Chrome', '120.0.6099.234'],
  ['Debian', 'Firefox', '121.0'],
  ['Windows', 'Chrome', '121.0.6167.85'],
  ['macOS', 'Safari', '17.2.1'],
  ['Fedora', 'Chrome', '120.0.6099.129'],
  ['Windows', 'Firefox', '121.0.1'],
];

const FP_FILE = resolve(process.cwd(), '.session_fingerprint.json');

type Persisted = {
  fingerprint: Fingerprint;
  chosenAt: number; // epoch ms
  rotations: number;
};

function loadPersisted(): Persisted | null {
  try {
    if (!existsSync(FP_FILE)) return null;
    const raw = readFileSync(FP_FILE, 'utf8');
    const parsed = JSON.parse(raw) as Persisted;
    if (!Array.isArray(parsed.fingerprint) || parsed.fingerprint.length !== 3) return null;
    return parsed;
  } catch {
    return null;
  }
}

function savePersisted(p: Persisted): void {
  try {
    writeFileSync(FP_FILE, JSON.stringify(p, null, 2), 'utf8');
  } catch {
    // non-fatal
  }
}

/**
 * Return the fingerprint for this session. Reuses the persisted value unless
 * `forceRotate` is true (new re-pair after a lockout).
 */
export function getOrCreateFingerprint(forceRotate = false): Fingerprint {
  const current = loadPersisted();
  if (current && !forceRotate) return current.fingerprint;

  // Pick a new one — avoid repeating the last used if possible.
  const previousStr = current ? current.fingerprint.join('|') : '';
  const candidates = POOL.filter(f => f.join('|') !== previousStr);
  const chosen = candidates[Math.floor(Math.random() * candidates.length)] || POOL[0];

  savePersisted({
    fingerprint: chosen,
    chosenAt: Date.now(),
    rotations: (current?.rotations || 0) + (forceRotate ? 1 : 0),
  });

  return chosen;
}

/**
 * Force a rotation — called after loggedOut / badSession.
 */
export function rotateFingerprint(): Fingerprint {
  return getOrCreateFingerprint(true);
}
