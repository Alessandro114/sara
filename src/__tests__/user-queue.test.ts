// ═══════════════════════════════════════════════════
// user-queue smoke test (vanilla, no test runner)
// Run: npx tsx src/__tests__/user-queue.test.ts
// ═══════════════════════════════════════════════════

import assert from 'node:assert/strict';
import { enqueueUserMessage, getUserQueueStats } from '../user-queue.js';

// Helper: sleep for ms
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

async function testOrdering(): Promise<void> {
    const order: number[] = [];

    // Enqueue 3 tasks back-to-back for the same user. Task 1 intentionally
    // sleeps longer than tasks 2 and 3 — without FIFO serialization, task 3
    // would finish first. With serialization, they must finish 1→2→3.
    const p1 = enqueueUserMessage('user-A', async () => {
        await sleep(120);
        order.push(1);
    });
    const p2 = enqueueUserMessage('user-A', async () => {
        await sleep(20);
        order.push(2);
    });
    const p3 = enqueueUserMessage('user-A', async () => {
        await sleep(10);
        order.push(3);
    });

    await Promise.all([p1, p2, p3]);
    assert.deepEqual(order, [1, 2, 3], `expected [1,2,3] got ${JSON.stringify(order)}`);
    console.log('✅ testOrdering: tasks ran in FIFO order');
}

async function testCrossUserConcurrency(): Promise<void> {
    const start = Date.now();
    const pa = enqueueUserMessage('user-B', async () => { await sleep(100); });
    const pb = enqueueUserMessage('user-C', async () => { await sleep(100); });
    await Promise.all([pa, pb]);
    const elapsed = Date.now() - start;
    // If they ran serially it would be ~200ms; parallel should be ~100ms.
    assert.ok(elapsed < 180, `expected parallel execution (~100ms) got ${elapsed}ms`);
    console.log(`✅ testCrossUserConcurrency: different users parallelized (${elapsed}ms)`);
}

async function testBackpressure(): Promise<void> {
    // Block user-D with a slow task, then try to flood past the cap.
    const results: Array<'ok' | 'dropped'> = [];
    const blocker = enqueueUserMessage('user-D', async () => { await sleep(300); });

    // Fill the queue to 10 + try 3 overflow enqueues that should reject.
    const attempts: Array<Promise<'ok' | 'dropped'>> = [];
    for (let i = 0; i < 13; i++) {
        attempts.push(
            enqueueUserMessage('user-D', async () => { await sleep(5); })
                .then(() => 'ok' as const)
                .catch(() => 'dropped' as const)
        );
    }
    const out = await Promise.all(attempts);
    await blocker;
    results.push(...out);

    const dropped = results.filter(r => r === 'dropped').length;
    assert.ok(dropped >= 3, `expected ≥3 drops, got ${dropped}`);
    console.log(`✅ testBackpressure: ${dropped} overflow messages dropped as expected`);
}

async function testStats(): Promise<void> {
    // Fresh stats snapshot after the chaos above — should be empty.
    await sleep(50);
    const stats = getUserQueueStats();
    assert.equal(stats.activeUsers, 0, `expected activeUsers=0 got ${stats.activeUsers}`);
    console.log('✅ testStats: queue drains cleanly');
}

(async () => {
    try {
        await testOrdering();
        await testCrossUserConcurrency();
        await testBackpressure();
        await testStats();
        console.log('\n🎉 user-queue tests passed');
        process.exit(0);
    } catch (err: any) {
        console.error('\n❌ user-queue test failed:', err?.message || err);
        process.exit(1);
    }
})();
