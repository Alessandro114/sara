#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
// preflight.js — run before bot start to catch common issues
// ═══════════════════════════════════════════════════════════
// Usage: npm run preflight
// Checks:
//   - Env vars (DATABASE_URL, GEMINI_API_KEY)
//   - Auth dir writable
//   - Port 3006 not in use
//   - dist/ built
//   - Crash-loop / dead-man flag not tripped

import { existsSync, mkdirSync, accessSync, constants } from 'fs';
import { resolve } from 'path';
import { createServer } from 'net';

const CWD = process.cwd();
const checks = [];

// Check 1: env vars
checks.push({
    name: 'DATABASE_URL env',
    ok: !!process.env.DATABASE_URL || !!process.env.SCALA_DB_URL,
});
checks.push({
    name: 'GEMINI_API_KEY or GROQ_API_KEY env',
    ok: !!process.env.GEMINI_API_KEY || !!process.env.GROQ_API_KEY,
});

// Check 2: auth dir writable
const authDir = resolve(CWD, 'auth_store_baileys_hardened');
let authOk = false;
try {
    if (!existsSync(authDir)) mkdirSync(authDir, { recursive: true });
    accessSync(authDir, constants.W_OK);
    authOk = true;
} catch { authOk = false; }
checks.push({ name: 'auth_store_baileys_hardened writable', ok: authOk });

// Check 3: dist/ built
checks.push({
    name: 'dist/index.js exists',
    ok: existsSync(resolve(CWD, 'dist/index.js')),
});

// Check 4: crash-loop state not tripped
const pausedFile = resolve(CWD, '.wa_paused');
checks.push({
    name: 'dead-man switch not tripped',
    ok: !existsSync(pausedFile),
    hint: existsSync(pausedFile) ? 'run: npm run clear-crash-loop' : undefined,
});

// Check 5: port 3006 free (the SARA API bridge port)
const portCheck = await new Promise((resolvePort) => {
    const srv = createServer();
    srv.once('error', () => resolvePort(false));
    srv.once('listening', () => {
        srv.close(() => resolvePort(true));
    });
    srv.listen(3006, '127.0.0.1');
});
checks.push({ name: 'port 3006 free', ok: portCheck });

// Report
let failed = 0;
for (const c of checks) {
    const mark = c.ok ? '✅' : '❌';
    const hint = c.hint ? ` (${c.hint})` : '';
    // eslint-disable-next-line no-console
    console.log(`${mark} ${c.name}${hint}`);
    if (!c.ok) failed++;
}

if (failed > 0) {
    // eslint-disable-next-line no-console
    console.error(`\n🚨 PREFLIGHT FAILED: ${failed}/${checks.length} checks failed`);
    process.exit(1);
}
// eslint-disable-next-line no-console
console.log(`\n✅ Preflight OK — all ${checks.length} checks passed`);
process.exit(0);
