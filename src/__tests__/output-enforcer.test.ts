// ═══════════════════════════════════════════════════
// output-enforcer tests
// Run: npx tsx src/__tests__/output-enforcer.test.ts
// ═══════════════════════════════════════════════════

import assert from 'node:assert/strict';
import { enforcePersonaRules } from '../lib/output-enforcer.js';

function testShortMessageUnchanged(): void {
    const msg = 'Capisco. Quanti coperti fai al giorno?';
    assert.equal(enforcePersonaRules(msg, 80), msg);
    console.log('✅ testShortMessageUnchanged');
}

function testWordCap(): void {
    const long = Array.from({ length: 120 }, (_, i) => `word${i}`).join(' ');
    const out = enforcePersonaRules(long, 80);
    const words = out.trim().split(/\s+/).length;
    assert.ok(words <= 81, `expected ≤81 words got ${words}`);
    console.log(`✅ testWordCap: 120 → ${words} words`);
}

function testSentenceAwareTruncation(): void {
    const sentences = Array.from({ length: 20 }, (_, i) => `Frase numero ${i}.`).join(' ');
    const out = enforcePersonaRules(sentences, 30);
    // Should end on a sentence terminator or ellipsis.
    assert.ok(/[.!?…]$/.test(out.trim()), `expected clean end, got "${out.slice(-10)}"`);
    console.log('✅ testSentenceAwareTruncation: clean cut');
}

function testEmojiCap(): void {
    const msg = 'Ciao 😊 tutto 🎉 bene 🚀 oggi 💡 davvero 🔥 perfetto ✨';
    const out = enforcePersonaRules(msg, 80);
    const emojiCount = (out.match(/\p{Extended_Pictographic}/gu) || []).length;
    assert.ok(emojiCount <= 3, `expected ≤3 emoji got ${emojiCount}`);
    console.log(`✅ testEmojiCap: 6 → ${emojiCount} emoji`);
}

function testMarkdownStrip(): void {
    // >10% emphasis triggers strip. Use lots of bold to cross threshold.
    const msg = '**bold1** normal **bold2** text **bold3** more **bold4** end **bold5**';
    const out = enforcePersonaRules(msg, 80);
    assert.ok(!out.includes('**'), `markdown should be stripped, got: ${out}`);
    console.log('✅ testMarkdownStrip: bold markers removed');
}

function testLightMarkdownPreserved(): void {
    // Legit, bounded emphasis should NOT be stripped (below 10% threshold).
    const msg = 'Il punto chiave è **questo**: serve ottimizzare il flusso. Vediamo insieme come partire, step dopo step, così non rischi di perderti.';
    const out = enforcePersonaRules(msg, 80);
    assert.ok(out.includes('**questo**'), `legit emphasis should be preserved, got: ${out}`);
    console.log('✅ testLightMarkdownPreserved: single emphasis kept');
}

(async () => {
    try {
        testShortMessageUnchanged();
        testWordCap();
        testSentenceAwareTruncation();
        testEmojiCap();
        testMarkdownStrip();
        testLightMarkdownPreserved();
        console.log('\n🎉 output-enforcer tests passed');
        process.exit(0);
    } catch (err: any) {
        console.error('\n❌ output-enforcer test failed:', err?.message || err);
        process.exit(1);
    }
})();
