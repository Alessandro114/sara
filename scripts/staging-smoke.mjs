// ═══════════════════════════════════════════════════
// Staging smoke test — boots the API against a throwaway database and
// checks it actually serves traffic.
//
// Run by .github/workflows/staging.yml against a Postgres service container
// that is created and destroyed with the job. Never point DATABASE_URL at
// anything you care about: this creates schema and writes to it.
//
//   DATABASE_URL=postgresql://... node scripts/staging-smoke.mjs
// ═══════════════════════════════════════════════════

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const PORT = process.env.SARA_API_PORT || '3006';
const BASE = `http://127.0.0.1:${PORT}`;
const TIMEOUT_MS = 60_000;

function fail(msg) {
    console.error(`\n❌ ${msg}`);
    process.exit(1);
}

if (!process.env.DATABASE_URL) fail('DATABASE_URL is not set');
if (/@(prod|65\.108\.)/.test(process.env.DATABASE_URL)) {
    fail('DATABASE_URL looks like production — refusing to run');
}

// ── 1. schema on an empty database ──
const { initDB } = await import('../dist/db.js');
const { pool } = await import('../dist/config.js');

await initDB();
console.log('✅ schema created');

const migrations = readdirSync('migrations').filter(f => f.endsWith('.sql')).sort();
for (const f of migrations) {
    await pool.query(readFileSync(join('migrations', f), 'utf8'));
}
console.log(`✅ ${migrations.length} migration(s) applied`);

// ── 2. boot the API (sara-api starts its own listener on import) ──
await import('../dist/sara-api.js');

// ── 3. it must actually answer. The listen() call is wrapped in a catch that
//       only logs, so a failed bind is silent — polling is the only proof. ──
const deadline = Date.now() + TIMEOUT_MS;
let health = null;
while (Date.now() < deadline) {
    try {
        const r = await fetch(`${BASE}/api/sara/health`);
        if (r.ok) { health = await r.json(); break; }
    } catch { /* not up yet */ }
    await new Promise(r => setTimeout(r, 1000));
}
if (!health) fail(`/api/sara/health did not respond within ${TIMEOUT_MS / 1000}s`);

console.log('✅ health responded:');
console.log(JSON.stringify(health, null, 2).split('\n').map(l => '   ' + l).join('\n'));

// ── 4. every table the health endpoint probes must exist on a fresh schema.
//       A "missing_or_broken" here means initDB and the endpoint disagree. ──
// crm_contacts belongs to the SCALA backend, not to the bot: crm-sync.ts
// writes into it, but a self-hosted install without SCALA will not have it.
// Missing means "integration not configured", not "install broken".
const OPTIONAL_TABLES = ['crm_contacts'];

const checks = health.checks ?? {};
const broken = Object.entries(checks).filter(([k, v]) => v !== 'ok' && !OPTIONAL_TABLES.includes(k));
const absent = Object.entries(checks).filter(([k, v]) => v !== 'ok' && OPTIONAL_TABLES.includes(k));
if (broken.length) {
    fail(`tables missing after a clean init: ${broken.map(([k]) => k).join(', ')}`);
}
for (const [k] of absent) console.log(`ℹ️  ${k} absent — optional SCALA integration, not required`);
console.log(`✅ ${Object.keys(checks).length - absent.length} required table check(s) ok`);

// ── 5. read-only endpoints must not 5xx on an empty database ──
const endpoints = ['/api/sara/stats', '/api/sara/conversations', '/api/sara/analytics', '/api/sara/leads'];
const failures = [];
for (const path of endpoints) {
    try {
        const r = await fetch(`${BASE}${path}`);
        if (r.status >= 500) failures.push(`${path} → ${r.status}`);
        else console.log(`✅ ${path} → ${r.status}`);
    } catch (e) {
        failures.push(`${path} → ${e.message}`);
    }
}
if (failures.length) fail(`endpoints failing on an empty database:\n   ${failures.join('\n   ')}`);

console.log('\n🎉 staging smoke passed');
process.exit(0);
