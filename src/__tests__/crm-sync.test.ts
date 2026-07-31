// ═══════════════════════════════════════════════════
// crm-sync retry/backoff tests
// Run: npx tsx src/__tests__/crm-sync.test.ts
// ═══════════════════════════════════════════════════
// We mock the global fetch to simulate network behaviour and assert the
// retry ladder + disk-queue fallback. We also shrink the backoff delays
// via monkey-patching setTimeout so a 5-attempt run finishes in < 1s.
// ═══════════════════════════════════════════════════

import assert from 'node:assert/strict';
import { existsSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Configure env BEFORE importing crm-sync so isSyncEnabled() initialises correctly.
process.env.SCALA_BACKEND_URL = 'https://test.local';
process.env.SARA_API_KEY = 'test-key-long-enough-to-pass-length-check-abcdef';

const PENDING_FILE = resolve(process.cwd(), '.pending_crm_syncs.jsonl');
// Start from a clean slate.
if (existsSync(PENDING_FILE)) rmSync(PENDING_FILE);

// Shrink backoff delays — setTimeout wrapper. We only compress long delays
// so other time-sensitive code still behaves normally.
const origSetTimeout = globalThis.setTimeout;
(globalThis as any).setTimeout = ((fn: any, ms: number, ...rest: any[]) => {
    const compressed = ms && ms >= 500 ? 5 : ms;
    return origSetTimeout(fn, compressed, ...rest);
}) as any;

// Install our fetch mock
let fetchCalls = 0;
let fetchPlan: Array<'ok' | 'fail'> = [];
(globalThis as any).fetch = async (_url: string, _init: any) => {
    const plan = fetchPlan[fetchCalls] || 'fail';
    fetchCalls++;
    if (plan === 'ok') {
        return {
            ok: true,
            status: 200,
            text: async () => 'ok',
        } as any;
    }
    return {
        ok: false,
        status: 503,
        text: async () => 'service unavailable',
    } as any;
};

const { syncLeadToSCALA } = await import('../crm-sync.js');

async function testFirstAttemptSuccess(): Promise<void> {
    fetchCalls = 0;
    fetchPlan = ['ok'];
    await syncLeadToSCALA({ phone: '+391234567890', user_name: 'Test' });
    assert.equal(fetchCalls, 1, 'should succeed on first call');
    assert.equal(existsSync(PENDING_FILE) && readFileSync(PENDING_FILE, 'utf8').length > 0, false);
    console.log('✅ testFirstAttemptSuccess: 1 call, no queue entry');
}

async function testSuccessAfterRetries(): Promise<void> {
    fetchCalls = 0;
    fetchPlan = ['fail', 'fail', 'ok'];
    await syncLeadToSCALA({ phone: '+391234567891', user_name: 'Retry' });
    assert.equal(fetchCalls, 3, 'should succeed on 3rd attempt');
    console.log('✅ testSuccessAfterRetries: 3 calls (2 fails + 1 ok)');
}

async function testExhaustionEnqueues(): Promise<void> {
    // Ensure clean queue state
    if (existsSync(PENDING_FILE)) writeFileSync(PENDING_FILE, '', 'utf8');
    fetchCalls = 0;
    fetchPlan = ['fail', 'fail', 'fail', 'fail', 'fail'];
    await syncLeadToSCALA({ phone: '+391234567892', user_name: 'Dead' });
    assert.equal(fetchCalls, 5, 'should exhaust 5 attempts');
    assert.ok(existsSync(PENDING_FILE), 'pending file must exist after exhaustion');
    const content = readFileSync(PENDING_FILE, 'utf8');
    assert.ok(content.includes('+391234567892'), 'lead must be persisted to queue');
    const parsed = JSON.parse(content.trim().split('\n').pop()!);
    assert.equal(parsed._attempts, 5);
    assert.ok(parsed._queuedAt > 0);
    console.log('✅ testExhaustionEnqueues: 5 calls → disk queue');
}

(async () => {
    try {
        await testFirstAttemptSuccess();
        await testSuccessAfterRetries();
        await testExhaustionEnqueues();
        // Cleanup
        if (existsSync(PENDING_FILE)) rmSync(PENDING_FILE);
        console.log('\n🎉 crm-sync tests passed');
        process.exit(0);
    } catch (err: any) {
        console.error('\n❌ crm-sync test failed:', err?.message || err);
        if (existsSync(PENDING_FILE)) rmSync(PENDING_FILE);
        process.exit(1);
    }
})();
