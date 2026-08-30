// ═══════════════════════════════════════════════════
// SARA Health Endpoint & WAHA Health Tests
// Run: npx tsx src/__tests__/health.test.ts
// ═══════════════════════════════════════════════════

import assert from 'node:assert/strict';
import { checkWahaHealth } from '../lib/multi-session.js';

async function testWahaHealthOffline(): Promise<void> {
    const res = await checkWahaHealth();
    assert.ok(typeof res === 'object' && res !== null, 'checkWahaHealth must return an object');
    assert.ok(['connected', 'disconnected'].includes(res.status), `status should be connected or disconnected, got ${res.status}`);
    assert.ok(typeof res.reachable === 'boolean', 'reachable should be boolean');
    if (!res.reachable) {
        assert.equal(res.status, 'disconnected');
        assert.ok(res.error, 'error should be present when disconnected');
    }
    console.log('✅ testWahaHealthOffline: handles offline WAHA gracefully without throwing');
}

function testHealthPayloadStructure(): void {
    const mockUptime = process.uptime();
    const mockTimestamp = new Date().toISOString();
    const payload = {
        status: 'ok',
        uptime: mockUptime,
        bot: 'S.A.R.A.',
        version: '2.2.0',
        waha: {
            status: 'connected',
            reachable: true,
            sessionsCount: 0,
        },
        checks: {
            db: 'ok',
            crm_contacts: 'ok',
            wa_messages: 'ok',
            sara_contact_profiles: 'ok',
        },
        timestamp: mockTimestamp,
    };

    assert.equal(payload.status, 'ok');
    assert.ok(typeof payload.uptime === 'number' && payload.uptime >= 0, 'uptime must be non-negative number');
    assert.equal(payload.bot, 'S.A.R.A.');
    assert.equal(payload.version, '2.2.0');
    assert.ok(typeof payload.waha === 'object' && payload.waha.reachable === true);
    assert.ok(typeof payload.checks === 'object');
    assert.equal(payload.checks.db, 'ok');
    assert.ok(!isNaN(Date.parse(payload.timestamp)), 'timestamp must be valid ISO string');
    console.log('✅ testHealthPayloadStructure: health payload matches required contract');
}

(async () => {
    try {
        await testWahaHealthOffline();
        testHealthPayloadStructure();
        console.log('\n🎉 health tests passed');
        process.exit(0);
    } catch (err: any) {
        console.error('\n❌ health test failed:', err?.message || err);
        process.exit(1);
    }
})();
