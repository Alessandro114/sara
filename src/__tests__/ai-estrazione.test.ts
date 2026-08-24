// ═══════════════════════════════════════════════════
// ai.ts — estrazione dei lead e valutazione del recupero — node:assert
// Run: npx tsx src/__tests__/ai-estrazione.test.ts
//
// 1.248 righe, nessun test. Qui si coprono le due funzioni pure, che sono
// anche quelle in cui un errore non si vede: nessuna delle due solleva mai.
//
// extractLeadInfo sbaglia in silenzio in due direzioni opposte, ed entrambe
// costano: se non riconosce un nome si perde l'attribuzione del lead; se lo
// riconosce dove non c'e, il CRM si riempie di contatti che si chiamano
// "Avvocato" o "Nel".
//
// evaluateRetrieval decide se il RAG ha trovato qualcosa di buono. Se dice
// 'correct' quando non lo e, SARA risponde con sicurezza usando un documento
// che non c'entra — che e il modo peggiore di sbagliare per un assistente.
// ═══════════════════════════════════════════════════

import assert from 'node:assert/strict';
import { extractLeadInfo, evaluateRetrieval } from '../ai.js';

// ─── extractLeadInfo: i nomi ───

function testNomiRiconosciuti() {
    const casi: Array<[string, string]> = [
        ['mi chiamo Mario Rossi', 'Mario Rossi'],
        ['Mi chiamo Giulia', 'Giulia'],
        ['il mio nome è Anna Bianchi', 'Anna Bianchi'],
        ['chiamami Luca', 'Luca'],
    ];
    for (const [messaggio, atteso] of casi) {
        const r = extractLeadInfo(messaggio);
        assert.equal(r.name, atteso, `"${messaggio}" -> ${JSON.stringify(r.name)}`);
    }
    console.log(`✅ testNomiRiconosciuti: ${casi.length} presentazioni esplicite`);
}

function testSonoEscluso() {
    // "sono" NON deve produrre un nome, ed e una scelta deliberata: il commento
    // nel codice spiega che causava falsi positivi. Questo test protegge la
    // decisione — senza, il primo che vede "Sono Mario Rossi" non riconosciuto
    // lo aggiunge al pattern e ricrea il problema.
    const trappole = [
        'sono avvocato',
        'sono nel team di Marco',
        'sono un cliente da anni',
        'sono interessato al servizio',
        'Sono Mario Rossi',
    ];
    for (const t of trappole) {
        const r = extractLeadInfo(t);
        assert.equal(r.name, undefined,
            `"${t}" ha prodotto il nome ${JSON.stringify(r.name)}: "sono" e escluso apposta`);
    }
    console.log(`✅ testSonoEscluso: ${trappole.length} frasi con "sono" non producono un nome`);
}

function testNomeMassimoDueParole() {
    // Il pattern prende al massimo nome e cognome: se prendesse tutto il resto
    // della frase, nel CRM finirebbero contatti chiamati "Mario Rossi E Vorrei
    // Sapere Se".
    const r = extractLeadInfo('mi chiamo Mario Rossi e vorrei sapere i prezzi');
    assert.ok(r.name, 'nessun nome estratto');
    assert.ok(r.name!.split(/\s+/).length <= 2, `nome troppo lungo: "${r.name}"`);
    console.log(`✅ testNomeMassimoDueParole: "${r.name}" e non tutta la frase`);
}

// ─── extractLeadInfo: le email ───

function testEmail() {
    const casi: Array<[string, string | undefined]> = [
        ['scrivimi a mario.rossi@acme.it', 'mario.rossi@acme.it'],
        ['la mia mail è a_b+tag@sub.dominio.co.uk', 'a_b+tag@sub.dominio.co.uk'],
        ['nessuna email qui', undefined],
        ['chiocciola senza dominio: mario@', undefined],
    ];
    for (const [messaggio, atteso] of casi) {
        assert.equal(extractLeadInfo(messaggio).email, atteso, `"${messaggio}"`);
    }
    console.log(`✅ testEmail: ${casi.length} casi, comprese due che NON sono email`);
}

function testCampiIndipendenti() {
    // Un messaggio che ha solo l'email non deve inventare nome e azienda.
    const r = extractLeadInfo('mario@acme.it');
    assert.equal(r.email, 'mario@acme.it');
    assert.equal(r.name, undefined);
    assert.equal(r.company, undefined);
    console.log('✅ testCampiIndipendenti: nessun campo viene dedotto dagli altri');
}

function testMessaggioVuoto() {
    for (const m of ['', '   ', '???']) {
        assert.doesNotThrow(() => extractLeadInfo(m));
        assert.deepEqual(extractLeadInfo(m), {}, `"${m}" non deve produrre campi`);
    }
    console.log('✅ testMessaggioVuoto: input vuoto o insensato produce un oggetto vuoto');
}

// ─── evaluateRetrieval ───

const doc = (score: number, title = 'Menu del ristorante', content = 'contenuto qualsiasi') =>
    ({ score, title, content } as never);

function testNessunRisultato() {
    const r = evaluateRetrieval([], 'quali sono gli orari', 'dine');
    assert.equal(r.verdict, 'incorrect');
    assert.equal(r.reason, 'no_matches');
    console.log('✅ testNessunRisultato: nessun documento -> incorrect');
}

function testPunteggioAltoConParolaChiave() {
    const r = evaluateRetrieval([doc(0.9, 'Orari di apertura')], 'quali sono gli orari', 'dine');
    assert.equal(r.verdict, 'correct', `atteso correct, ottenuto ${r.verdict} (${r.reason})`);
    console.log('✅ testPunteggioAltoConParolaChiave: 0.9 + titolo pertinente -> correct');
}

function testPunteggioAltoSenzaParolaChiave() {
    // Il caso che conta: somiglianza alta ma su un argomento diverso. NON deve
    // essere 'correct', altrimenti SARA risponde con sicurezza usando un
    // documento che non c'entra.
    const r = evaluateRetrieval([doc(0.9, 'Regolamento parcheggio', 'sbarre e telecomandi')],
        'quali allergeni contiene la carbonara', 'dine');
    assert.notEqual(r.verdict, 'correct',
        'un punteggio alto senza alcuna parola in comune non puo valere "correct"');
    console.log(`✅ testPunteggioAltoSenzaParolaChiave: -> ${r.verdict}, non correct`);
}

function testPunteggioBasso() {
    const r = evaluateRetrieval([doc(0.1, 'Tutt altro', 'niente in comune')],
        'quali allergeni contiene la carbonara', 'dine');
    assert.equal(r.verdict, 'incorrect', `atteso incorrect, ottenuto ${r.verdict}`);
    console.log('✅ testPunteggioBasso: 0.1 senza parole in comune -> incorrect');
}

function testZonaAmbigua() {
    const r = evaluateRetrieval([doc(0.45, 'Tutt altro', 'niente in comune')],
        'quali allergeni contiene la carbonara', 'dine');
    assert.equal(r.verdict, 'ambiguous', `atteso ambiguous, ottenuto ${r.verdict}`);
    console.log('✅ testZonaAmbigua: 0.45 -> ambiguous, cioe allarga la ricerca');
}

function testParoleVuoteIgnorate() {
    // "come", "cosa", "posso" e simili non devono far scattare una
    // corrispondenza: sono in ogni domanda e in mezzo documento.
    const r = evaluateRetrieval([doc(0.5, 'Come posso aiutarti', 'cosa vorrei sapere')],
        'come posso fare', 'dine');
    assert.notEqual(r.verdict, 'correct',
        'una corrispondenza fatta solo di parole vuote non vale "correct"');
    console.log(`✅ testParoleVuoteIgnorate: solo stopword -> ${r.verdict}`);
}

function testMotivazioneSemprePresente() {
    // La motivazione finisce nei log: senza, un verdetto sbagliato non si
    // riesce a spiegare a posteriori.
    for (const punteggio of [0.05, 0.45, 0.9]) {
        const r = evaluateRetrieval([doc(punteggio)], 'quali sono gli orari', 'dine');
        assert.ok(r.reason && r.reason.length > 0, `verdetto senza motivazione a ${punteggio}`);
    }
    console.log('✅ testMotivazioneSemprePresente: ogni verdetto porta una motivazione');
}

(async () => {
    try {
        testNomiRiconosciuti();
        testSonoEscluso();
        testNomeMassimoDueParole();
        testEmail();
        testCampiIndipendenti();
        testMessaggioVuoto();
        testNessunRisultato();
        testPunteggioAltoConParolaChiave();
        testPunteggioAltoSenzaParolaChiave();
        testPunteggioBasso();
        testZonaAmbigua();
        testParoleVuoteIgnorate();
        testMotivazioneSemprePresente();
        console.log('\n🎉 ai-estrazione tests passed');
        process.exit(0);
    } catch (err: any) {
        console.error('\n❌ ai-estrazione test failed:', err?.message || err);
        process.exit(1);
    }
})();
