// ═══════════════════════════════════════════════════
// context-pruner tests
// Run: npx tsx src/__tests__/context-pruner.test.ts
// ═══════════════════════════════════════════════════

import assert from 'node:assert/strict';
import { pruneContext, pruneContextWithStats } from '../lib/context-pruner.js';

function testShortArrayPassthrough(): void {
    const msgs = [
        { role: 'user', content: 'ciao' },
        { role: 'model', content: 'ciao!' },
    ];
    const pruned = pruneContext(msgs, 'come stai', 8, 4);
    assert.equal(pruned.length, 2);
    console.log('✅ testShortArrayPassthrough: short arrays returned as-is');
}

function testLastNAlwaysKept(): void {
    const msgs = Array.from({ length: 30 }, (_, i) => ({
        role: i % 2 === 0 ? 'user' : 'model',
        content: `message ${i} about weather and football`,
        ts: i,
    }));
    const pruned = pruneContext(msgs, 'soccer game tonight', 8, 4);
    assert.equal(pruned.length, 8, 'should cap to 8 messages');
    // Last 4 must be in the output.
    const last4 = msgs.slice(-4);
    for (const m of last4) {
        assert.ok(pruned.includes(m), `last-4 message ${m.content} must be kept`);
    }
    console.log('✅ testLastNAlwaysKept: recent 4 always preserved');
}

function testRelevanceBoost(): void {
    const msgs = [
        { role: 'user', content: 'parliamo di ristorante e food cost', ts: 1 },
        { role: 'model', content: 'il food cost va tenuto basso', ts: 2 },
        { role: 'user', content: 'il mio cane è carino', ts: 3 },
        { role: 'model', content: 'bello!', ts: 4 },
        { role: 'user', content: 'ieri ho fatto sport', ts: 5 },
        { role: 'model', content: 'bene', ts: 6 },
        { role: 'user', content: 'ho visto un film', ts: 7 },
        { role: 'model', content: 'ok', ts: 8 },
        { role: 'user', content: 'come va?', ts: 9 },
        { role: 'model', content: 'tutto bene', ts: 10 },
        { role: 'user', content: 'piove', ts: 11 },
        { role: 'model', content: 'già', ts: 12 },
    ];
    // Current message is about food cost — the old message #1 should be
    // selected above the other irrelevant old messages.
    const pruned = pruneContext(msgs, 'come abbasso il food cost del ristorante', 8, 4);
    assert.equal(pruned.length, 8);
    const contents = pruned.map(m => m.content);
    assert.ok(
        contents.includes('parliamo di ristorante e food cost'),
        `expected food cost message to be selected; got ${JSON.stringify(contents)}`
    );
    console.log('✅ testRelevanceBoost: top-k by Jaccard picks topical messages');
}

function testChronologicalOrder(): void {
    const msgs = Array.from({ length: 15 }, (_, i) => ({
        role: 'user',
        content: `topic ${i}`,
        ts: i,
    }));
    const pruned = pruneContext(msgs, 'topic 2', 8, 4);
    const tss = pruned.map(m => (m as any).ts);
    for (let i = 1; i < tss.length; i++) {
        assert.ok(tss[i] > tss[i - 1], `out of order at index ${i}: ${tss}`);
    }
    console.log('✅ testChronologicalOrder: output stays chronological');
}

function testStatsShape(): void {
    const msgs = Array.from({ length: 20 }, (_, i) => ({ role: 'user', content: `m${i}`, ts: i }));
    const { pruned, stats } = pruneContextWithStats(msgs, 'm5', 8, 4);
    assert.equal(pruned.length, 8);
    assert.equal(stats.original, 20);
    assert.equal(stats.kept, 8);
    assert.equal(stats.droppedOlder, 12);
    console.log('✅ testStatsShape: stats object correct');
}

(async () => {
    try {
        testShortArrayPassthrough();
        testLastNAlwaysKept();
        testRelevanceBoost();
        testChronologicalOrder();
        testStatsShape();
        console.log('\n🎉 context-pruner tests passed');
        process.exit(0);
    } catch (err: any) {
        console.error('\n❌ context-pruner test failed:', err?.message || err);
        process.exit(1);
    }
})();
