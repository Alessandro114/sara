// ═══════════════════════════════════════════════════
// ai-providers — la catena di failover e l'anonimizzazione — node:assert
// Run: npx tsx src/__tests__/ai-providers-chain.test.ts
//
// Due proprieta, e sono tutte e due promesse fatte per iscritto nel README.
//
// 1. «Multi-provider LLM chain with automatic failover — zero downtime when one
//    provider is rate-limited». Se il failover non scatta, SARA si spegne
//    appena il primo provider risponde 429, che e cio che fanno i piani
//    gratuiti sotto carico.
//
// 2. «PII anonymization before every external LLM call — names, phones, emails
//    are masked at the boundary». Se salta, i numeri di telefono dei clienti
//    finiscono nei log di Groq. Nessuno l'aveva mai verificata.
//
// Le chiavi vengono lette all'import del modulo, quindi l'ambiente si prepara
// PRIMA di importarlo e il modulo si carica una volta sola.
// ═══════════════════════════════════════════════════

import assert from 'node:assert/strict';

process.env.GROQ_API_KEY = 'chiave-groq-di-prova';
process.env.CEREBRAS_API_KEY = 'chiave-cerebras-di-prova';
process.env.SAMBANOVA_API_KEY = 'chiave-sambanova-di-prova';
process.env.MISTRAL_API_KEY = 'chiave-mistral-di-prova';

const { chatChain, getProviderStatus, hasGroq, hasCerebras, hasSambaNova, hasMistral } =
    await import('../lib/ai-providers.js');

// ─── finto strato di rete ───

interface Chiamata { url: string; corpo: string }
let chiamate: Chiamata[] = [];
const fetchVero = globalThis.fetch;

/**
 * @param esiti per ogni chiamata in ordine: 'ok' risponde, un numero e uno
 *              stato di errore (429 = rate limit, che e il caso reale).
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

// ─── chiavi e stato ───

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
    // Non deve MAI esporre le chiavi: questo oggetto finisce in un endpoint di
    // diagnostica, e una chiave in un log e una chiave bruciata.
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
    // Il caso reale: il piano gratuito di Groq risponde 429 sotto carico.
    fingiRete([429, 'ok'], 'risposta dal secondo');
    const r = await chatChain([{ role: 'user', content: 'ciao' }]);
    assert.equal(r.text, 'risposta dal secondo');
    assert.ok(chiamate.length >= 2, 'non ha provato il provider successivo dopo un 429');
    assert.notEqual(chiamate[0].url, chiamate[1].url, 'ha richiamato lo stesso provider');
    ripristinaRete();
    console.log('✅ testFailoverSuRateLimit: dopo un 429 passa al provider successivo');
}

async function testFailoverACascata() {
    // Tre provider giu di fila: deve arrivare al quarto, non fermarsi al primo
    // errore ne dopo un solo tentativo.
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
        // Il messaggio deve dire QUALI provider hanno fallito: senza, chi
        // guarda i log non sa se e un guasto o un rate limit.
        assert.match(m, /all providers failed/i);
        for (const p of ['groq', 'cerebras', 'sambanova', 'mistral']) {
            assert.ok(m.includes(p), `il messaggio d'errore non nomina ${p}`);
        }
    }
    assert.ok(sollevato, 'con tutti i provider giu non ha sollevato');
    ripristinaRete();
    console.log('✅ testTuttiGiu: solleva nominando tutti e quattro i provider falliti');
}

// ─── anonimizzazione ───

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
    // Il caso che sfugge: se l'anonimizzazione avvenisse dentro il ramo del
    // primo provider, la seconda chiamata partirebbe con i dati in chiaro.
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
    // Il segnaposto deve tornare a essere il dato vero PRIMA di arrivare
    // all'utente, altrimenti il cliente legge "[TEL_1]" al posto del numero.
    //
    // Il segnaposto si CHIEDE all'anonimizzatore invece di scriverlo a mano:
    // scrivendolo la prima volta avevo inventato "[PHONE_1]" e il test
    // falliva accusando il codice di un difetto che non aveva. Un test che
    // cabla il formato di un altro modulo mente appena quel formato cambia.
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
