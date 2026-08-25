// ═══════════════════════════════════════════════════
// persistent-memory — i due blocchi che finiscono nel prompt — node:assert
// Run: npx tsx src/__tests__/persistent-memory.test.ts
//
// 618 righe, nessun test. Qui si coprono le due funzioni pure, che sono anche
// le uniche il cui risultato viene consegnato TESTUALMENTE al modello:
// buildProfileContext (chi e il cliente) e buildKBContext (cosa sa l'azienda).
//
// Un errore qui non solleva. Produce un blocco di testo leggermente sbagliato
// che il modello legge come verita, e la conversazione va storta senza che in
// nessun log compaia niente.
// ═══════════════════════════════════════════════════

import assert from 'node:assert/strict';
import { buildProfileContext, buildKBContext } from '../lib/persistent-memory.js';
import type { ContactProfile, KBItem } from '../lib/persistent-memory.js';

const profiloBase = (over: Partial<ContactProfile> = {}): ContactProfile => ({
    name: 'Mario Rossi',
    language: 'it',
    sentiment_avg: 0.5,
    topics: [],
    preferences: {},
    intent_history: [],
    interaction_count: 3,
    first_contact: null,
    last_contact: null,
    profile_summary: null,
    tags: [],
    ...over,
});

// ─── buildProfileContext ───

function testProfiloAssente() {
    // Deve dare stringa vuota, non un blocco vuoto: un '[CONTACT PROFILE]'
    // senza contenuto occuperebbe contesto e direbbe al modello che c'e un
    // profilo, quando non c'e.
    assert.equal(buildProfileContext(null), '');
    console.log('✅ testProfiloAssente: nessun profilo -> stringa vuota, non un involucro');
}

function testCampiEssenziali() {
    const c = buildProfileContext(profiloBase());
    assert.ok(c.includes('[CONTACT PROFILE]'));
    assert.ok(c.includes('Mario Rossi'));
    assert.ok(c.includes('Interactions: 3'));
    console.log('✅ testCampiEssenziali: intestazione, nome e numero di interazioni');
}

function testNomeMancante() {
    const c = buildProfileContext(profiloBase({ name: null }));
    assert.ok(c.includes('Unknown'), 'senza nome deve dire Unknown, non lasciare il campo vuoto');
    assert.ok(!c.includes('Name: null'), 'ha scritto "null" nel prompt');
    console.log('✅ testNomeMancante: "Unknown" e non "null" davanti al modello');
}

function testNessunNullNelPrompt() {
    // Il caso che conta: un profilo quasi vuoto non deve mai produrre la
    // parola "null" o "undefined" dentro il testo che legge il modello.
    const c = buildProfileContext(profiloBase({
        name: null, language: null, sentiment_avg: null, profile_summary: null,
    }));
    assert.ok(!/\bnull\b/.test(c), `"null" e finito nel prompt:\n${c}`);
    assert.ok(!/\bundefined\b/.test(c), `"undefined" e finito nel prompt:\n${c}`);
    console.log('✅ testNessunNullNelPrompt: nessun "null" o "undefined" nel testo');
}

function testTelefonoNonNelProfilo() {
    // Il blocco finisce nel prompt e da li puo arrivare a un provider esterno.
    // ContactProfile non porta il numero, ed e giusto cosi: questo test
    // impedisce che qualcuno lo aggiunga senza accorgersi delle conseguenze.
    const c = buildProfileContext(profiloBase({
        name: 'Mario Rossi',
        preferences: { tavolo: 'vicino alla finestra' },
        tags: ['abituale'],
    }));
    assert.ok(!/\+?\d{9,}/.test(c), `un numero di telefono e finito nel profilo:\n${c}`);
    console.log('✅ testTelefonoNonNelProfilo: nessuna sequenza che somigli a un numero');
}

function testSentimento() {
    const casi: Array<[number, string]> = [
        [0.9, 'positive'], [0.7, 'positive'],
        [0.5, 'neutral'], [0.4, 'neutral'],
        [0.3, 'negative'], [0.0, 'negative'],
    ];
    for (const [valore, etichetta] of casi) {
        const c = buildProfileContext(profiloBase({ sentiment_avg: valore }));
        assert.ok(c.includes(`Sentiment: ${etichetta}`),
            `${valore} doveva essere ${etichetta}, invece: ${c.split('\n').find(r => r.startsWith('Sentiment'))}`);
    }
    console.log(`✅ testSentimento: ${casi.length} valori, comprese le due soglie esatte 0.7 e 0.3`);
}

function testSentimentoAssente() {
    const c = buildProfileContext(profiloBase({ sentiment_avg: null }));
    assert.ok(!c.includes('Sentiment'), 'ha scritto un sentimento che non esiste');
    console.log('✅ testSentimentoAssente: senza dati, la riga non compare affatto');
}

function testStoricoInGiorni() {
    const c = buildProfileContext(profiloBase({
        first_contact: new Date('2026-08-01T10:00:00Z'),
        last_contact: new Date('2026-08-11T10:00:00Z'),
    }));
    assert.ok(c.includes('History: 10 days'), `atteso 10 giorni, riga: ${c.split('\n').find(r => r.startsWith('History'))}`);
    console.log('✅ testStoricoInGiorni: 10 giorni fra primo e ultimo contatto');
}

function testStoricoMinimoUnGiorno() {
    // Primo e ultimo contatto nello stesso momento: deve dire 1 giorno, non 0.
    // "History: 0 days" al modello suona come "non l'ho mai sentito".
    const adesso = new Date('2026-08-11T10:00:00Z');
    const c = buildProfileContext(profiloBase({ first_contact: adesso, last_contact: adesso }));
    assert.ok(c.includes('History: 1 days'), `atteso almeno 1 giorno, riga: ${c.split('\n').find(r => r.startsWith('History'))}`);
    console.log('✅ testStoricoMinimoUnGiorno: mai "0 days"');
}

function testTopicLimitatiADieci() {
    // Senza il limite, un cliente con centinaia di argomenti riempirebbe il
    // contesto da solo e spingerebbe fuori tutto il resto.
    const molti = Array.from({ length: 30 }, (_, i) => `argomento${i}`);
    const c = buildProfileContext(profiloBase({ topics: molti }));
    const riga = c.split('\n').find(r => r.startsWith('Previous topics')) ?? '';
    const elencati = riga.replace('Previous topics: ', '').split(', ');
    assert.equal(elencati.length, 10, `elencati ${elencati.length} argomenti invece di 10`);
    // e devono essere gli ULTIMI, cioe i piu recenti
    assert.ok(riga.includes('argomento29'), 'ha tenuto i piu vecchi invece dei piu recenti');
    assert.ok(!riga.includes('argomento0,'), 'ha incluso il primo argomento, che e il piu vecchio');
    console.log('✅ testTopicLimitatiADieci: gli ultimi 10, non i primi');
}

function testCampiFacoltativiOmessi() {
    const c = buildProfileContext(profiloBase());
    for (const assente of ['Summary', 'Previous topics', 'Preferences', 'Tags']) {
        assert.ok(!c.includes(assente), `"${assente}" compare pur essendo vuoto`);
    }
    console.log('✅ testCampiFacoltativiOmessi: le sezioni vuote non occupano contesto');
}

// ─── buildKBContext ───

const kb = (over: Partial<KBItem> = {}): KBItem => ({
    id: 1, category: null, question: null, answer: 'una risposta',
    keywords: [], priority: 0, ...over,
});

function testKBVuota() {
    assert.equal(buildKBContext([]), '');
    assert.equal(buildKBContext(null as never), '');
    console.log('✅ testKBVuota: elenco vuoto o assente -> stringa vuota');
}

function testKBDomandaERisposta() {
    const c = buildKBContext([kb({ question: 'Siete aperti la domenica?', answer: 'Si, a pranzo.' })]);
    assert.ok(c.includes('Q: Siete aperti la domenica?'));
    assert.ok(c.includes('A: Si, a pranzo.'));
    console.log('✅ testKBDomandaERisposta: la coppia domanda/risposta e leggibile');
}

function testKBSenzaDomanda() {
    const c = buildKBContext([kb({ category: 'orari', answer: 'Chiusi il lunedi.' })]);
    assert.ok(c.includes('[orari] Chiusi il lunedi.'));
    console.log('✅ testKBSenzaDomanda: senza domanda usa la categoria come etichetta');
}

function testKBSenzaCategoria() {
    const c = buildKBContext([kb({ answer: 'Parcheggio gratuito.' })]);
    assert.ok(c.includes('[info] Parcheggio gratuito.'), 'senza categoria deve ripiegare su "info"');
    assert.ok(!c.includes('[null]'), 'ha scritto "[null]" nel prompt');
    console.log('✅ testKBSenzaCategoria: ripiega su "info", non su "null"');
}

function testKBIstruzioneDiOnesta() {
    // La riga di chiusura dice al modello di ammettere quando non sa. Senza,
    // il modello riempie il vuoto inventando — che per un bot che risponde ai
    // clienti di un ristorante e il difetto peggiore possibile.
    const c = buildKBContext([kb()]);
    assert.ok(c.includes('[END KB]'), 'manca la chiusura del blocco');
    assert.ok(/not covered here, say so honestly/i.test(c),
        'manca l istruzione di ammettere quando la risposta non c e');
    console.log('✅ testKBIstruzioneDiOnesta: il blocco chiude dicendo al modello di non inventare');
}

function testKBPiuVoci() {
    const c = buildKBContext([
        kb({ id: 1, question: 'Domanda uno', answer: 'Risposta uno' }),
        kb({ id: 2, category: 'menu', answer: 'Abbiamo opzioni vegane' }),
    ]);
    assert.ok(c.includes('Risposta uno') && c.includes('Abbiamo opzioni vegane'),
        'una delle due voci e sparita');
    console.log('✅ testKBPiuVoci: nessuna voce viene persa');
}

(async () => {
    try {
        testProfiloAssente();
        testCampiEssenziali();
        testNomeMancante();
        testNessunNullNelPrompt();
        testTelefonoNonNelProfilo();
        testSentimento();
        testSentimentoAssente();
        testStoricoInGiorni();
        testStoricoMinimoUnGiorno();
        testTopicLimitatiADieci();
        testCampiFacoltativiOmessi();
        testKBVuota();
        testKBDomandaERisposta();
        testKBSenzaDomanda();
        testKBSenzaCategoria();
        testKBIstruzioneDiOnesta();
        testKBPiuVoci();
        console.log('\n🎉 persistent-memory tests passed');
        process.exit(0);
    } catch (err: any) {
        console.error('\n❌ persistent-memory test failed:', err?.message || err);
        process.exit(1);
    }
})();
