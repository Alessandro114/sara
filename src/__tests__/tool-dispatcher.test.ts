// ═══════════════════════════════════════════════════
// tool-dispatcher — vanilla node:assert
// Run: npx tsx src/__tests__/tool-dispatcher.test.ts
//
// 1,419 lines without a single test. This is the module that decides WHICH
// tool to run when the model asks for one: an error here doesn't throw an
// exception, it makes SARA do the wrong thing with the customer.
//
// The first test written found a real defect: normalizeDate used
// toISOString(), which converts to UTC. On a machine in a positive time
// zone, between midnight and the offset, "today" would return YESTERDAY and
// "tomorrow" would return TODAY. A table booked at 1am for tomorrow would
// end up on the wrong day, with no error at all. In production the server
// runs on UTC so it never showed up; but this repository is public and
// self-hostable, and anyone who installs it in Italy hits it head-on every
// night.
// ═══════════════════════════════════════════════════

import assert from 'node:assert/strict';
import { normalizeDate, getToolRisk, saraToolsToOpenAI } from '../lib/tool-dispatcher.js';

/** YYYY-MM-DD in the local time zone, which is what the bot must write to the database. */
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
    // The defect found while writing these tests: with toISOString() the
    // date was being computed in UTC. This check catches it in any time
    // zone, because it compares against the LOCAL components of the date.
    const d = new Date();
    const atteso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    assert.equal(normalizeDate('oggi'), atteso,
        `"oggi" deve essere la data LOCALE (offset fuso: ${d.getTimezoneOffset()} min), non quella UTC`);
    // and tomorrow must be exactly one day later, not zero and not two
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
        // Always forward, never today: "monday" said on a monday means next
        // monday, not now.
        assert.ok(scarto >= 1 && scarto <= 7, `"${g}" cade a ${scarto} giorni da oggi`);
    }
    console.log(`✅ testGiorniDellaSettimana: 14 forme, tutte fra 1 e 7 giorni avanti (oggi e ${oggi.getDay()})`);
}

function testAccenti() {
    // The model writes "lunedì" with the accent: if it weren't normalized
    // it would fall into the generic parsing branch and produce a random date.
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
    // Must return the input, not throw: better for the database to reject a
    // strange value than to crash the conversation with the customer.
    for (const spazzatura of ['', 'quando vuoi', 'asdfgh', 'il mese prossimo']) {
        assert.doesNotThrow(() => normalizeDate(spazzatura), `"${spazzatura}" fa cadere il normalizzatore`);
    }
    assert.equal(normalizeDate(''), '');
    assert.equal(normalizeDate('asdfgh'), 'asdfgh');
    console.log('✅ testNonRiconosciuto: input incomprensibile torna intatto, senza eccezioni');
}

// ─── getToolRisk ───

function testRischioPredefinito() {
    // The risk level governs autonomy: an unknown tool MUST fall back to a
    // cautious value, never to 'low'. If someone later adds a tool and
    // forgets to classify it, it must not become auto-executable by
    // omission.
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
    // notes, category and friends must NEVER end up among the required
    // fields: if they did, the model would invent a value just to fill them.
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
