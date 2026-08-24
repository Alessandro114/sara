// ═══════════════════════════════════════════════════
// tool-dispatcher — vanilla node:assert
// Run: npx tsx src/__tests__/tool-dispatcher.test.ts
//
// 1.419 righe senza un test. E il modulo che decide QUALE strumento eseguire
// quando il modello lo chiede: un errore qui non solleva un'eccezione, fa fare
// a SARA la cosa sbagliata col cliente.
//
// Il primo test scritto ha trovato un difetto vero: normalizeDate usava
// toISOString(), che converte in UTC. Su una macchina a fuso positivo, fra
// mezzanotte e l'offset, "oggi" restituiva IERI e "domani" restituiva OGGI.
// Un tavolo prenotato all'una di notte per domani finiva sul giorno sbagliato,
// senza nessun errore. In produzione il server e su UTC e non si vedeva; ma
// questo repository e pubblico e auto-ospitabile, e chi lo installa in Italia
// lo prende in pieno ogni notte.
// ═══════════════════════════════════════════════════

import assert from 'node:assert/strict';
import { normalizeDate, getToolRisk, saraToolsToOpenAI } from '../lib/tool-dispatcher.js';

/** YYYY-MM-DD nel fuso locale, che e cio che il bot deve scrivere nel database. */
function locale(offsetGiorni = 0): string {
    const d = new Date();
    d.setDate(d.getDate() + offsetGiorni);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ─── normalizeDate ───

function testOggi() {
    for (const parola of ['oggi', 'today', 'hoy', 'hoje', 'OGGI', '  oggi  ']) {
        assert.equal(normalizeDate(parola), locale(0), `"${parola}" non risolve a oggi`);
    }
    console.log('✅ testOggi: 6 forme di "oggi" in 4 lingue');
}

function testDomani() {
    for (const parola of ['domani', 'tomorrow', 'manana', 'amanha']) {
        assert.equal(normalizeDate(parola), locale(1), `"${parola}" non risolve a domani`);
    }
    console.log('✅ testDomani: 4 lingue');
}

function testDopodomani() {
    for (const parola of ['dopodomani', 'day after tomorrow', 'pasado manana']) {
        assert.equal(normalizeDate(parola), locale(2), `"${parola}" non risolve a dopodomani`);
    }
    console.log('✅ testDopodomani: 3 forme');
}

function testFusoOrario() {
    // Il difetto trovato scrivendo questi test: con toISOString() la data
    // veniva calcolata in UTC. Questo controllo lo prende su qualsiasi fuso,
    // perche confronta con i componenti LOCALI della data.
    const d = new Date();
    const atteso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    assert.equal(normalizeDate('oggi'), atteso,
        `"oggi" deve essere la data LOCALE (offset fuso: ${d.getTimezoneOffset()} min), non quella UTC`);
    // e domani deve essere esattamente un giorno dopo, non zero e non due
    const o = new Date(normalizeDate('oggi') + 'T12:00:00');
    const dom = new Date(normalizeDate('domani') + 'T12:00:00');
    assert.equal(Math.round((dom.getTime() - o.getTime()) / 86_400_000), 1,
        'fra oggi e domani deve passare esattamente un giorno');
    console.log(`✅ testFusoOrario: data locale rispettata (offset ${d.getTimezoneOffset()} min)`);
}

function testGiorniDellaSettimana() {
    const giorni = ['lunedi', 'monday', 'martedi', 'tuesday', 'mercoledi', 'wednesday',
        'giovedi', 'thursday', 'venerdi', 'friday', 'sabato', 'saturday', 'domenica', 'sunday'];
    const oggi = new Date();
    for (const g of giorni) {
        const r = normalizeDate(g);
        assert.match(r, /^\d{4}-\d{2}-\d{2}$/, `"${g}" non produce una data`);
        const d = new Date(r + 'T12:00:00');
        const scarto = Math.round((d.getTime() - new Date(locale(0) + 'T12:00:00').getTime()) / 86_400_000);
        // Sempre in avanti, mai oggi: "lunedi" detto di lunedi vuol dire il
        // lunedi prossimo, non adesso.
        assert.ok(scarto >= 1 && scarto <= 7, `"${g}" cade a ${scarto} giorni da oggi`);
    }
    console.log(`✅ testGiorniDellaSettimana: 14 forme, tutte fra 1 e 7 giorni avanti (oggi e ${oggi.getDay()})`);
}

function testAccenti() {
    // Il modello scrive "lunedì" con l'accento: se non venisse normalizzato
    // cadrebbe nel ramo del parsing generico e produrrebbe una data a caso.
    for (const [con, senza] of [['lunedì', 'lunedi'], ['martedì', 'martedi'], ['venerdì', 'venerdi']]) {
        assert.equal(normalizeDate(con), normalizeDate(senza), `"${con}" e "${senza}" devono coincidere`);
    }
    console.log('✅ testAccenti: le forme accentate coincidono con quelle senza');
}

function testGiaIso() {
    for (const d of ['2026-12-25', '2026-01-01', '2099-06-30']) {
        assert.equal(normalizeDate(d), d, `"${d}" era gia in formato ISO e non va toccata`);
    }
    console.log('✅ testGiaIso: le date ISO passano intatte');
}

function testNonRiconosciuto() {
    // Deve restituire l'input, non sollevare: meglio che il database rifiuti
    // un valore strano che far cadere la conversazione col cliente.
    for (const spazzatura of ['', 'quando vuoi', 'asdfgh', 'il mese prossimo']) {
        assert.doesNotThrow(() => normalizeDate(spazzatura), `"${spazzatura}" fa cadere il normalizzatore`);
    }
    assert.equal(normalizeDate(''), '');
    assert.equal(normalizeDate('asdfgh'), 'asdfgh');
    console.log('✅ testNonRiconosciuto: input incomprensibile torna intatto, senza eccezioni');
}

// ─── getToolRisk ───

function testRischioPredefinito() {
    // Il livello di rischio governa l'autonomia: uno strumento sconosciuto
    // DEVE ricadere su un valore prudente, mai su 'low'. Se un domani qualcuno
    // aggiunge uno strumento e dimentica di classificarlo, non deve diventare
    // eseguibile in automatico per omissione.
    assert.equal(getToolRisk('strumento_mai_visto'), 'medium');
    assert.notEqual(getToolRisk('strumento_mai_visto'), 'low');
    console.log('✅ testRischioPredefinito: uno strumento non classificato e "medium", non "low"');
}

function testRischioDichiarato() {
    const noti = ['get_project_status', 'generate_sal', 'parse_bando', 'checklist_gara', 'scadenze_gare'];
    for (const n of noti) {
        assert.ok(['low', 'medium', 'high', 'critical'].includes(getToolRisk(n)), `${n}: rischio non valido`);
    }
    console.log(`✅ testRischioDichiarato: ${noti.length} strumenti noti hanno un livello valido`);
}

// ─── saraToolsToOpenAI ───

function testConversioneSchema() {
    const strumenti = saraToolsToOpenAI('dine');
    assert.ok(strumenti.length > 0, 'il settore dine non produce strumenti');
    for (const t of strumenti) {
        assert.equal(t.type, 'function');
        assert.equal(typeof t.function.name, 'string');
        assert.equal(typeof t.function.description, 'string');
        assert.equal(t.function.parameters.type, 'object');
        assert.ok(Array.isArray(t.function.parameters.required), `${t.function.name}: required non e un elenco`);
    }
    console.log(`✅ testConversioneSchema: ${strumenti.length} strumenti nel formato che le API di function calling accettano`);
}

function testParametriFacoltativi() {
    // notes, category e compagnia non devono MAI finire fra i required:
    // se ci finissero, il modello inventerebbe un valore pur di riempirli.
    const facoltativi = ['notes', 'category', 'area', 'sector', 'trade_in', 'complexity', 'budget_range', 'color'];
    for (const settore of ['dine', 'beauty', 'property']) {
        for (const t of saraToolsToOpenAI(settore)) {
            const obbligatori = t.function.parameters.required ?? [];
            for (const f of facoltativi) {
                assert.ok(!obbligatori.includes(f),
                    `${settore}/${t.function.name}: "${f}" e facoltativo ma risulta obbligatorio`);
            }
        }
    }
    console.log('✅ testParametriFacoltativi: 8 campi facoltativi mai marcati obbligatori, su 3 settori');
}

function testSettoreIgnoto() {
    assert.doesNotThrow(() => saraToolsToOpenAI('settore_inventato'));
    console.log('✅ testSettoreIgnoto: un settore sconosciuto non fa cadere la conversione');
}

(async () => {
    try {
        testOggi();
        testDomani();
        testDopodomani();
        testFusoOrario();
        testGiorniDellaSettimana();
        testAccenti();
        testGiaIso();
        testNonRiconosciuto();
        testRischioPredefinito();
        testRischioDichiarato();
        testConversioneSchema();
        testParametriFacoltativi();
        testSettoreIgnoto();
        console.log('\n🎉 tool-dispatcher tests passed');
        process.exit(0);
    } catch (err: any) {
        console.error('\n❌ tool-dispatcher test failed:', err?.message || err);
        process.exit(1);
    }
})();
