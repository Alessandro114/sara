// ═══════════════════════════════════════════════════
// ai.ts — lead extraction and retrieval evaluation — node:assert
// Run: npx tsx src/__tests__/ai-estrazione.test.ts
//
// 1,248 lines, no tests. This covers the two pure functions, which are also
// the ones where an error doesn't show: neither of them ever throws.
//
// extractLeadInfo fails silently in two opposite directions, and both cost
// something: if it fails to recognize a name, the lead's attribution is
// lost; if it recognizes one where there isn't one, the CRM fills up with
// contacts named "Avvocato" (Lawyer) or "Nel" (In the).
//
// evaluateRetrieval decides whether the RAG found something good. If it
// says 'correct' when it isn't, SARA answers confidently using a document
// that has nothing to do with the question — which is the worst way an
// assistant can be wrong.
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
    // "sono" must NOT produce a name, and this is a deliberate choice: the
    // comment in the code explains it caused false positives. This test
    // protects that decision — without it, the first person to see "Sono
    // Mario Rossi" go unrecognized will add it to the pattern and recreate
    // the problem.
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
    // The pattern takes at most a first and last name: if it took the rest
    // of the sentence too, the CRM would end up with contacts named "Mario
    // Rossi And I'd Like To Know If".
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
    // A message that only has the email must not invent a name and company.
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
    // The case that matters: high similarity but on a different topic. It
    // must NOT be 'correct', otherwise SARA answers confidently using a
    // document that has nothing to do with the question.
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
    // "how", "what", "can" and similar words must not trigger a match: they
    // appear in every question and in half of every document.
    const r = evaluateRetrieval([doc(0.5, 'Come posso aiutarti', 'cosa vorrei sapere')],
        'come posso fare', 'dine');
    assert.notEqual(r.verdict, 'correct',
        'una corrispondenza fatta solo di parole vuote non vale "correct"');
    console.log(`✅ testParoleVuoteIgnorate: solo stopword -> ${r.verdict}`);
}

function testMotivazioneSemprePresente() {
    // The reason ends up in the logs: without it, a wrong verdict can't be
    // explained after the fact.
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
