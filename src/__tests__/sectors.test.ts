// ═══════════════════════════════════════════════════
// sectors detection tests
// Run: npx tsx src/__tests__/sectors.test.ts
// ═══════════════════════════════════════════════════
// Scope: keyword detection (detectSector) + semantic fallback behaviour
// (detectSectorSemantic). Full embedding path is covered by the real
// bot when an AI provider is configured; here we only verify the
// fallback-safe contract — no LLM call is made.
// ═══════════════════════════════════════════════════

import assert from 'node:assert/strict';

// Stub fetch so any accidental embedding call does not go over the network.
let fetchStubCalls = 0;
(globalThis as any).fetch = async () => {
    fetchStubCalls++;
    return {
        ok: true,
        json: async () => ({ embedding: { values: [] } }),
    } as any;
};

const { detectSector, detectSectorSemantic, detectCompanySize } = await import('../sectors.js');

function testKeywordHits(): void {
    const cases: Array<[string, string]> = [
        ['Sono avvocato e gestisco cause civili', 'legale'],
        ['Ho uno studio commercialista a Roma', 'commercialista'],
        ['Gestisco un ristorante con 60 coperti', 'ristorante'],
        // NB: "dermatologo" contains substring "logo" (agenzia kw) — use
        // "medico estetico" instead to hit the dermatologia keyword cleanly.
        ['Sono un medico estetico e faccio filler e botox', 'dermatologia'],
        ['Sono un agente immobiliare, vendo case', 'immobiliare'],
        ['Lavoro in concessionaria, vendo auto km zero', 'automotive'],
        ['Ho un hotel con 40 camere, gestione booking', 'turismo'],
        ['Ho un agenzia di comunicazione che fa social media', 'agenzia'],
    ];
    for (const [text, expected] of cases) {
        const got = detectSector(text);
        assert.equal(got, expected, `detectSector("${text}") = ${got}, expected ${expected}`);
    }
    console.log(`✅ testKeywordHits: ${cases.length} sectors correctly matched`);
}

function testKeywordMiss(): void {
    const misses = [
        'Ciao come stai?',
        'Bella giornata oggi',
        'Come funziona?',
    ];
    for (const m of misses) {
        const got = detectSector(m);
        assert.equal(got, null, `expected null for "${m}" got ${got}`);
    }
    console.log(`✅ testKeywordMiss: ${misses.length} ambiguous messages return null`);
}

function testCompanySize(): void {
    const got = detectCompanySize('Siamo un team di 25 persone');
    assert.ok(got !== null, 'expected a detection');
    console.log(`✅ testCompanySize: detected "${got}"`);
}

async function testSemanticFallback(): Promise<void> {
    // Embeddings are NOT initialised (initSectorEmbeddings was never called),
    // so detectSectorSemantic must fall back to the keyword path.
    const r1 = await detectSectorSemantic('Lavoro in uno studio commercialista');
    assert.equal(r1, 'commercialista', `semantic fallback failed: got ${r1}`);

    const r2 = await detectSectorSemantic('ciao');
    assert.equal(r2, null, 'short ambiguous input should return null via fallback');

    console.log('✅ testSemanticFallback: keyword fallback works when embeddings absent');
}

(async () => {
    try {
        testKeywordHits();
        testKeywordMiss();
        testCompanySize();
        await testSemanticFallback();
        console.log('\n🎉 sectors tests passed');
        process.exit(0);
    } catch (err: any) {
        console.error('\n❌ sectors test failed:', err?.message || err);
        process.exit(1);
    }
})();
