// ═══════════════════════════════════════════════════
// circuit-breaker state transition tests
// Run: npx tsx src/__tests__/circuit-breaker.test.ts
// ═══════════════════════════════════════════════════

import assert from 'node:assert/strict';
import { CircuitBreaker } from '../circuit-breaker.js';

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

function newBreaker() {
    return new CircuitBreaker({
        name: 'test',
        failureThreshold: 5,
        windowMs: 5_000,
        initialTimeoutMs: 200, // short for tests
        maxTimeoutMs: 5_000,
    });
}

function testClosedToOpen(): void {
    const b = newBreaker();
    assert.equal(b.getState(), 'CLOSED');
    for (let i = 0; i < 4; i++) b.recordFailure(new Error('boom'));
    assert.equal(b.getState(), 'CLOSED', '4 failures should not yet open');
    b.recordFailure(new Error('boom'));
    assert.equal(b.getState(), 'OPEN', '5th failure should open the breaker');
    assert.equal(b.canAttempt(), false);
    console.log('✅ testClosedToOpen: opens on 5 consecutive failures');
}

async function testOpenToHalfOpen(): Promise<void> {
    const b = newBreaker();
    for (let i = 0; i < 5; i++) b.recordFailure(new Error('boom'));
    assert.equal(b.getState(), 'OPEN');
    // Wait slightly longer than initialTimeoutMs (200ms) so the next
    // getState() transitions OPEN → HALF_OPEN.
    await sleep(250);
    assert.equal(b.getState(), 'HALF_OPEN');
    assert.equal(b.canAttempt(), true, 'half-open should allow probe');
    console.log('✅ testOpenToHalfOpen: transitions after timeout');
}

async function testHalfOpenSuccess(): Promise<void> {
    const b = newBreaker();
    for (let i = 0; i < 5; i++) b.recordFailure(new Error('boom'));
    await sleep(250);
    assert.equal(b.getState(), 'HALF_OPEN');
    b.recordSuccess();
    assert.equal(b.getState(), 'CLOSED', 'success in half-open closes breaker');
    console.log('✅ testHalfOpenSuccess: probe success → CLOSED');
}

async function testHalfOpenFailure(): Promise<void> {
    const b = newBreaker();
    for (let i = 0; i < 5; i++) b.recordFailure(new Error('boom'));
    await sleep(250);
    assert.equal(b.getState(), 'HALF_OPEN');
    b.recordFailure(new Error('still broken'));
    assert.equal(b.getState(), 'OPEN', 'half-open failure reopens breaker');
    console.log('✅ testHalfOpenFailure: probe failure → OPEN with backoff');
}

function testWindowReset(): void {
    // Failures outside the window should not accumulate.
    const b = new CircuitBreaker({
        name: 'win',
        failureThreshold: 3,
        windowMs: 50, // 50ms window
        initialTimeoutMs: 500,
        maxTimeoutMs: 5000,
    });
    b.recordFailure(new Error('1'));
    b.recordFailure(new Error('2'));
    // Wait past the window so the counter resets.
    const start = Date.now();
    while (Date.now() - start < 100) { /* spin */ }
    b.recordFailure(new Error('3'));
    assert.equal(b.getState(), 'CLOSED', 'old failures should have expired from window');
    console.log('✅ testWindowReset: failures outside window are not counted');
}

(async () => {
    try {
        testClosedToOpen();
        await testOpenToHalfOpen();
        await testHalfOpenSuccess();
        await testHalfOpenFailure();
        testWindowReset();
        console.log('\n🎉 circuit-breaker tests passed');
        process.exit(0);
    } catch (err: any) {
        console.error('\n❌ circuit-breaker test failed:', err?.message || err);
        process.exit(1);
    }
})();
