// ═══════════════════════════════════════════════════
// ai-providers — the failover chain and anonymization — node:assert
// Run: npx tsx src/__tests__/ai-providers-chain.test.ts
//
// Two properties, and both are promises made in writing in the README.
//
// 1. «Multi-provider LLM chain with automatic failover — zero downtime when one
//    provider is rate-limited». If failover doesn't kick in, SARA shuts down
//    as soon as the first provider returns a 429, which is what free plans
//    do under load.
//
// 2. «PII anonymization before every external LLM call — names, phones, emails
//    are masked at the boundary». If this breaks, customers' phone numbers
//    end up in Groq's logs. Nobody had ever verified it.
//
// The keys are read at module import time, so the environment is set up
// BEFORE importing the module, and the module is loaded only once.
// ═══════════════════════════════════════════════════

import assert from 'node:assert/strict';

process.env.GROQ_API_KEY = 'chiave-groq-di-prova';
process.env.CEREBRAS_API_KEY = 'chiave-cerebras-di-prova';
process.env.SAMBANOVA_API_KEY = 'chiave-sambanova-di-prova';
process.env.MISTRAL_API_KEY = 'chiave-mistral-di-prova';

const { chatChain, getProviderStatus, hasGroq, hasCerebras, hasSambaNova, hasMistral } =
    await import('../lib/ai-providers.js');

// ─── fake network layer ───

interface Chiamata { url: string; corpo: string }
let chiamate: Chiamata[] = [];
const fetchVero = globalThis.fetch;

/**
 * @param esiti for each call in order: 'ok' responds, a number is an error
 *              status (429 = rate limit, which is the real-world case).
 */
function fingiRete(esiti: Array<'ok' | number>, testo = 'risposta del modello') {
    let i = 0;
    globalThis.fetch = (async (url: unknown, init: unknown) => {
        const o = (init ?? {}) as { body?: string };
        chiamate.push({ url: String(url), corpo: String(o.body ?? '') });
        const esito = esiti[Math.min(i, esiti.length - 1)];
        i++;
        if (esito !== 'ok') {
            return {
                ok: false, status: esito,
                text: async () => `errore ${esito}`,
                json: async () => ({ error: `errore ${esito}` }),
            } as unknown as Response;
        }
        return {
            ok: true, status: 200,
            text: async () => JSON.stringify({ choices: [{ message: { content: testo } }] }),
            json: async () => ({ choices: [{ message: { content: testo } }] }),
        } as unknown as Response;
    }) as typeof globalThis.fetch;
}

function ripristinaRete() {
    globalThis.fetch = fetchVero;
    chiamate = [];
}

// ─── keys and status ───

function testChiaviLette() {
    assert.ok(hasGroq(), 'groq non risulta configurato');
    assert.ok(hasCerebras(), 'cerebras non risulta configurato');
    assert.ok(hasSambaNova(), 'sambanova non risulta configurato');
    assert.ok(hasMistral(), 'mistral non risulta configurato');
    console.log('✅ testChiaviLette: tutti e quattro i provider risultano configurati');
}

function testStatoProvider() {
    const s = getProviderStatus();
    for (const nome of ['groq', 'cerebras', 'sambanova', 'ollama', 'mistral'] as const) {
        assert.ok(nome in s, `getProviderStatus non riporta ${nome}`);
        assert.equal(typeof s[nome].enabled, 'boolean', `${nome}.enabled non e booleano`);
    }
    // Must NEVER expose the keys: this object ends up in a diagnostics
    // endpoint, and a key in a log is a burned key.
    const serializzato = JSON.stringify(s);
    for (const chiave of ['chiave-groq-di-prova', 'chiave-cerebras-di-prova',
        'chiave-sambanova-di-prova', 'chiave-mistral-di-prova']) {
        assert.ok(!serializzato.includes(chiave), `getProviderStatus espone ${chiave}`);
    }
    console.log('✅ testStatoProvider: 5 provider riportati, nessuna chiave esposta');
}

// ─── failover ───

async function testPrimoProviderRisponde() {
    fingiRete(['ok'], 'ciao');
    const r = await chatChain([{ role: 'user', content: 'ciao' }]);
    assert.equal(r.text, 'ciao');
    assert.equal(chiamate.length, 1, 'ha chiamato piu di un provider pur avendo una risposta');
    ripristinaRete();
    console.log('✅ testPrimoProviderRisponde: una sola chiamata quando il primo risponde');
}

async function testFailoverSuRateLimit() {
    // The real-world case: Groq's free plan returns 429 under load.
    fingiRete([429, 'ok'], 'risposta dal secondo');
    const r = await chatChain([{ role: 'user', content: 'ciao' }]);
    assert.equal(r.text, 'risposta dal secondo');
    assert.ok(chiamate.length >= 2, 'non ha provato il provider successivo dopo un 429');
    assert.notEqual(chiamate[0].url, chiamate[1].url, 'ha richiamato lo stesso provider');
    ripristinaRete();
    console.log('✅ testFailoverSuRateLimit: dopo un 429 passa al provider successivo');
}

async function testFailoverACascata() {
    // Three providers down in a row: it must reach the fourth, not stop at
    // the first error nor after a single attempt.
    fingiRete([429, 500, 503, 'ok'], 'risposta dal quarto');
    const r = await chatChain([{ role: 'user', content: 'ciao' }]);
    assert.equal(r.text, 'risposta dal quarto');
    assert.ok(chiamate.length >= 4, `si e fermato dopo ${chiamate.length} tentativi invece di arrivare al quarto`);
    ripristinaRete();
    console.log('✅ testFailoverACascata: attraversa tre provider caduti e usa il quarto');
}

async function testTuttiGiu() {
    fingiRete([429]);
    let sollevato = false;
    try { await chatChain([{ role: 'user', content: 'ciao' }]); }
    catch (err) {
        sollevato = true;
        const m = (err as Error).message;
        // The message must say WHICH providers failed: without that, anyone
        // looking at the logs can't tell whether it's an outage or a rate limit.
        assert.match(m, /all providers failed/i);
        for (const p of ['groq', 'cerebras', 'sambanova', 'mistral']) {
            assert.ok(m.includes(p), `il messaggio d'errore non nomina ${p}`);
        }
    }
    assert.ok(sollevato, 'con tutti i provider giu non ha sollevato');
    ripristinaRete();
    console.log('✅ testTuttiGiu: solleva nominando tutti e quattro i provider falliti');
}

// ─── anonymization ───

async function testTelefonoNonEsceMai() {
    fingiRete(['ok'], 'ricevuto');
    await chatChain([{ role: 'user', content: 'Sono Mario Rossi, il mio numero e +39 333 1234567' }]);
    assert.ok(chiamate.length > 0, 'nessuna chiamata registrata');
    for (const c of chiamate) {
        assert.ok(!c.corpo.includes('3331234567') && !c.corpo.includes('333 1234567'),
            'il numero di telefono e uscito verso il provider');
    }
    ripristinaRete();
    console.log('✅ testTelefonoNonEsceMai: il numero non compare nel corpo inviato');
}

async function testEmailNonEsceMai() {
    fingiRete(['ok'], 'ricevuto');
    await chatChain([{ role: 'user', content: 'scrivimi a mario.rossi@esempio.it' }]);
    for (const c of chiamate) {
        assert.ok(!c.corpo.includes('mario.rossi@esempio.it'),
            'l indirizzo email e uscito verso il provider');
    }
    ripristinaRete();
    console.log('✅ testEmailNonEsceMai: l indirizzo non compare nel corpo inviato');
}

async function testAnonimizzaAnchePrimaDelFailover() {
    // The case that's easy to miss: if anonymization happened inside the
    // first provider's branch, the second call would go out with the raw
    // data.
    fingiRete([429, 'ok'], 'ricevuto');
    await chatChain([{ role: 'user', content: 'chiamami al +39 333 1234567' }]);
    assert.ok(chiamate.length >= 2, 'non c e stato failover, il caso non e coperto');
    for (const c of chiamate) {
        assert.ok(!c.corpo.includes('3331234567') && !c.corpo.includes('333 1234567'),
            'dopo il failover il numero e uscito in chiaro verso il secondo provider');
    }
    ripristinaRete();
    console.log('✅ testAnonimizzaAnchePrimaDelFailover: mascherato anche nella seconda chiamata');
}

async function testDeanonimizzaAlRitorno() {
    // The placeholder must turn back into the real data BEFORE reaching the
    // user, otherwise the customer reads "[TEL_1]" instead of the number.
    //
    // The placeholder is ASKED FROM the anonymizer instead of hardcoded:
    // hardcoding it the first time, I had invented "[PHONE_1]" and the test
    // failed, blaming the code for a defect it didn't have. A test that
    // hardcodes another module's format lies as soon as that format changes.
    const { anonymizePII } = await import('../lib/pii-anonymizer.js');
    const numero = '+39 333 1234567';
    const segnaposto = [...anonymizePII(`chiamami al ${numero}`).originals.keys()][0];
    assert.ok(segnaposto, 'l anonimizzatore non ha prodotto nessun segnaposto per un numero');

    fingiRete(['ok'], `Ti richiamo al ${segnaposto}`);
    const r = await chatChain([{ role: 'user', content: `chiamami al ${numero}` }]);
    assert.ok(!r.text.includes(segnaposto),
        `il segnaposto ${segnaposto} e arrivato fino alla risposta per l utente`);
    assert.ok(r.text.includes(numero),
        'il numero vero non e stato ripristinato nella risposta');
    ripristinaRete();
    console.log(`✅ testDeanonimizzaAlRitorno: ${segnaposto} torna a essere il numero vero`);
}

(async () => {
    try {
        testChiaviLette();
        testStatoProvider();
        await testPrimoProviderRisponde();
        await testFailoverSuRateLimit();
        await testFailoverACascata();
        await testTuttiGiu();
        await testTelefonoNonEsceMai();
        await testEmailNonEsceMai();
        await testAnonimizzaAnchePrimaDelFailover();
        await testDeanonimizzaAlRitorno();
        console.log('\n🎉 ai-providers chain tests passed');
        process.exit(0);
    } catch (err: any) {
        ripristinaRete();
        console.error('\n❌ ai-providers chain test failed:', err?.message || err);
        process.exit(1);
    }
})();
