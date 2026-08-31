// ═══════════════════════════════════════════════════
// persistent-memory against a real Postgres — node:assert
// Run: DATABASE_URL=postgres://... npx tsx src/__tests__/memoria-db.test.ts
//
// Most of the uncovered code in this repo talks to the database:
// persistent-memory was at 27%, db.ts at 6.7%. Not because it's neglected
// code, but because in testing there had never been a database to talk to.
//
// The fix isn't to mock the `pg` module: those tests would just verify the
// mocks. The fix is to give the test a fresh, disposable Postgres — in CI
// it's a container that lasts as long as the job — and run the REAL code.
// ensureMemorySchema() creates its own tables, so no migration is even
// needed.
//
// BE CAREFUL how assertions are written here: EVERY persistent-memory
// function catches its own exceptions and returns a fallback — [] for
// reads, nothing for writes. That's a deliberate choice (memory must never
// crash a WhatsApp message), but for tests it means an assert on
// Array.isArray passes even with a completely broken query. Every test
// below must therefore verify a piece of DATA that can only exist if the
// query actually worked.
//
// Without DATABASE_URL the file is skipped rather than failing: not
// everyone has a local Postgres, and a red test for a missing environment
// just trains people to ignore red tests.
// ═══════════════════════════════════════════════════

import assert from 'node:assert/strict';
import {
    ensureMemorySchema,
    saveMessage,
    loadHistory,
    getContactProfile,
    upsertContactProfile,
    searchKnowledgeBase,
    getConversationSummary,
} from '../lib/persistent-memory.js';

const DSN = process.env.SCALA_DB_URL || process.env.DATABASE_URL;

// Identifiers that can't collide with real data.
const UTENTE = '00000000-0000-0000-0000-0000000000e2';
const ALTRO_UTENTE = '00000000-0000-0000-0000-0000000000e3';
const TEL = '+39000' + String(Date.now()).slice(-7);

// Direct connection, used ONLY to seed data and to read what the module
// doesn't expose. The code under test keeps using its own pool.
let diretta: any = null;
async function conn() {
    if (diretta) return diretta;
    const pgModule: any = await import('pg');
    const pg = pgModule.default || pgModule;
    diretta = new pg.Pool({ connectionString: DSN, max: 2 });
    return diretta;
}

async function testSchema() {
    await ensureMemorySchema();
    // It's not enough that it doesn't throw: ensureMemorySchema catches
    // everything and just logs a warning. If it failed silently, every
    // subsequent test would fail with a much less clear message than this
    // one.
    const p = await conn();
    const { rows } = await p.query(
        `SELECT tablename FROM pg_tables
         WHERE schemaname='public' AND tablename IN
         ('sara_solo_messages','sara_contact_profiles','sara_knowledge_base')`
    );
    assert.equal(rows.length, 3,
        `attese 3 tabelle L4/L5/L6, trovate ${rows.length}: ${rows.map((r: any) => r.tablename).join(', ')}`);
    console.log('✅ testSchema: le tre tabelle L4/L5/L6 esistono');
}

async function testSalvaERilegge() {
    await saveMessage(UTENTE, TEL, 'inbound', 'vorrei prenotare per due');
    await saveMessage(UTENTE, TEL, 'outbound', 'certamente, per quale sera?');
    const storia = await loadHistory(UTENTE, TEL, 10);
    assert.ok(storia.length >= 2, `attesi almeno 2 messaggi, trovati ${storia.length}`);
    const testi = storia.map(m => m.content).join(' | ');
    assert.ok(testi.includes('vorrei prenotare per due'), 'il messaggio in entrata non e stato ritrovato');
    assert.ok(testi.includes('certamente, per quale sera?'), 'la risposta non e stata ritrovata');
    console.log(`✅ testSalvaERilegge: ${storia.length} messaggi salvati e riletti`);
}

async function testDirezioneTradottaInRuolo() {
    // The database records inbound/outbound, the model wants user/assistant.
    // If the mapping is flipped, the model believes it said what the
    // customer said — and ends up replying to itself.
    const storia = await loadHistory(UTENTE, TEL, 10);
    const entrata = storia.find(m => m.content.includes('vorrei prenotare'));
    const uscita = storia.find(m => m.content.includes('per quale sera'));
    assert.equal(entrata?.role, 'user', 'un messaggio in entrata non risulta dell utente');
    assert.equal(uscita?.role, 'assistant', 'una risposta non risulta dell assistente');
    console.log('✅ testDirezioneTradottaInRuolo: inbound->user, outbound->assistant');
}

async function testOrdineCronologico() {
    // loadHistory reads in DESC order and then reverses it: history goes to
    // the model as context, and reversed it tells a conversation that never
    // happened.
    const storia = await loadHistory(UTENTE, TEL, 10);
    const iEntrata = storia.findIndex(m => m.content.includes('vorrei prenotare'));
    const iUscita = storia.findIndex(m => m.content.includes('per quale sera'));
    assert.ok(iEntrata >= 0 && iUscita >= 0, 'messaggi non ritrovati');
    assert.ok(iEntrata < iUscita, `l ordine e invertito: domanda in ${iEntrata}, risposta in ${iUscita}`);
    console.log('✅ testOrdineCronologico: la domanda viene prima della risposta');
}

async function testIsolamentoFraContatti() {
    // The worst possible defect here: one customer's conversation ending up
    // in another's context.
    const altro = '+39000' + String(Date.now() + 1).slice(-7);
    await saveMessage(UTENTE, altro, 'inbound', 'MESSAGGIO-DI-UN-ALTRO-CONTATTO');
    const mia = await loadHistory(UTENTE, TEL, 50);
    assert.ok(mia.length > 0, 'la storia e vuota: il test non sta verificando nulla');
    assert.ok(!mia.some(m => m.content.includes('MESSAGGIO-DI-UN-ALTRO-CONTATTO')),
        'la conversazione di un altro contatto e finita in questa storia');
    console.log('✅ testIsolamentoFraContatti: nessuna perdita fra conversazioni');
}

async function testIsolamentoFraUtenti() {
    // Same thing across different tenants: two companies on the same number
    // must not see each other. Here the phone is IDENTICAL, only user_id
    // changes: if the WHERE clause forgot user_id, this test would catch it
    // and the previous one wouldn't.
    await saveMessage(ALTRO_UTENTE, TEL, 'inbound', 'MESSAGGIO-DI-UN-ALTRO-UTENTE');
    const mia = await loadHistory(UTENTE, TEL, 50);
    assert.ok(mia.length > 0, 'la storia e vuota: il test non sta verificando nulla');
    assert.ok(!mia.some(m => m.content.includes('MESSAGGIO-DI-UN-ALTRO-UTENTE')),
        'la conversazione di un altro tenant e finita in questa storia');
    console.log('✅ testIsolamentoFraUtenti: nessuna perdita fra tenant');
}

async function testLimite() {
    // 25 messages, not 5: past twenty it opens the real branch of
    // getConversationSummary, which below that threshold returns
    // immediately.
    for (let i = 0; i < 25; i++) {
        await saveMessage(UTENTE, TEL, i % 2 === 0 ? 'inbound' : 'outbound', `riempitivo numero ${i}`);
    }
    const poche = await loadHistory(UTENTE, TEL, 3);
    assert.equal(poche.length, 3, `il limite non e rispettato: ${poche.length} messaggi invece di 3`);
    console.log('✅ testLimite: LIMIT rispettato con 25 messaggi in tabella');
}

async function testMessaggioLungoNonRompe() {
    const lungo = 'x'.repeat(20000);
    await saveMessage(UTENTE, TEL, 'inbound', lungo);
    const p = await conn();
    const { rows } = await p.query(
        `SELECT length(body) AS n FROM sara_solo_messages
         WHERE user_id=$1 AND phone=$2 ORDER BY id DESC LIMIT 1`, [UTENTE, TEL]);
    assert.ok(rows[0] && Number(rows[0].n) > 0,
        'il messaggio lungo non e stato scritto affatto (saveMessage ha inghiottito l errore)');
    console.log(`✅ testMessaggioLungoNonRompe: 20000 caratteri, scritti ${rows[0].n}`);
}

async function testProfilo() {
    await upsertContactProfile(UTENTE, TEL, 'mi chiamo Mario Rossi, vorrei prenotare', 'certamente');
    const p = await getContactProfile(UTENTE, TEL);
    assert.ok(p, 'nessun profilo dopo un aggiornamento');
    assert.ok(p!.interaction_count >= 1, 'il contatore delle interazioni e a zero');
    // "mi chiamo Mario Rossi" must trigger name extraction: it's the only
    // part of upsertContactProfile that isn't just bookkeeping.
    assert.equal(p!.name, 'Mario Rossi', `nome estratto sbagliato: ${JSON.stringify(p!.name)}`);
    console.log(`✅ testProfilo: nome "${p!.name}", ${p!.interaction_count} interazioni`);
}

async function testProfiloContaLeInterazioni() {
    const prima = (await getContactProfile(UTENTE, TEL))!.interaction_count;
    await upsertContactProfile(UTENTE, TEL, 'un altro messaggio', 'un altra risposta');
    const dopo = (await getContactProfile(UTENTE, TEL))!.interaction_count;
    assert.equal(dopo, prima + 1, `il contatore non sale di uno: ${prima} -> ${dopo}`);
    console.log(`✅ testProfiloContaLeInterazioni: ${prima} -> ${dopo}`);
}

async function testProfiloNonPerdeIlNome() {
    // The name is written only if not already set: a "sono Interessato"
    // must not rename Mario Rossi.
    await upsertContactProfile(UTENTE, TEL, 'sono Interessato al menu', 'ecco il menu');
    const p = await getContactProfile(UTENTE, TEL);
    assert.equal(p!.name, 'Mario Rossi', `il nome e stato sovrascritto: ${JSON.stringify(p!.name)}`);
    console.log('✅ testProfiloNonPerdeIlNome: il nome gia noto non viene sovrascritto');
}

async function testContattoSconosciuto() {
    const p = await getContactProfile(UTENTE, '+390000000000');
    // It may create it on the fly or return null: either is fine, as long
    // as it doesn't return someone else's profile.
    assert.ok(p === null || (typeof p === 'object' && p.name !== 'Mario Rossi'),
        'un contatto mai visto restituisce il profilo di un altro');
    console.log('✅ testContattoSconosciuto: nessuna confusione su un contatto mai visto');
}

async function testRiassunto() {
    // Above 20 messages the summary is actually built (count, days, last
    // topic). Below that, the function returns an empty string.
    const s = await getConversationSummary(UTENTE, TEL);
    assert.equal(typeof s, 'string', 'il riassunto non e un testo');
    assert.ok(s.length > 0, 'con oltre 20 messaggi il riassunto non dovrebbe essere vuoto');
    console.log(`✅ testRiassunto: "${s.slice(0, 90)}"`);
}

async function testRicercaConoscenza() {
    // Without seeding, this search would return [] whether working or
    // broken — searchKnowledgeBase catches its own exceptions. So I seed
    // it myself.
    const p = await conn();
    await p.query(
        `INSERT INTO sara_knowledge_base (user_id, category, question, answer, keywords, priority)
         VALUES ($1, 'orari', 'Quali sono gli orari?', 'RISPOSTA-ORARI-SEMINATA', ARRAY['orari','apertura'], 9)`,
        [UTENTE]
    );
    const r = await searchKnowledgeBase(UTENTE, 'mi sai dire gli orari di apertura?', 3);
    assert.ok(r.length >= 1, 'la voce appena seminata non e stata ritrovata: la query non funziona');
    assert.ok(r.some(v => v.answer === 'RISPOSTA-ORARI-SEMINATA'), 'ritrovata la voce sbagliata');
    console.log(`✅ testRicercaConoscenza: ${r.length} voci, la seminata e fra queste`);
}

async function testRicercaIsolataPerUtente() {
    const r = await searchKnowledgeBase(ALTRO_UTENTE, 'orari di apertura', 3);
    assert.ok(!r.some(v => v.answer === 'RISPOSTA-ORARI-SEMINATA'),
        'la knowledge base di un tenant e visibile a un altro');
    console.log('✅ testRicercaIsolataPerUtente: la knowledge base non attraversa i tenant');
}

async function testRicercaVuotaNonSolleva() {
    // Words under 3 characters: the function returns before the query.
    for (const q of ['', '  ', 'a b']) {
        const r = await searchKnowledgeBase(UTENTE, q, 3);
        assert.deepEqual(r, [], `"${q}" doveva dare elenco vuoto, ha dato ${r.length} voci`);
    }
    console.log('✅ testRicercaVuotaNonSolleva: query senza parole utili escono subito');
}

async function pulisci() {
    const p = await conn();
    for (const u of [UTENTE, ALTRO_UTENTE]) {
        await p.query('DELETE FROM sara_solo_messages WHERE user_id=$1', [u]);
        await p.query('DELETE FROM sara_contact_profiles WHERE user_id=$1', [u]);
        await p.query('DELETE FROM sara_knowledge_base WHERE user_id=$1', [u]);
    }
    await p.end();
}

(async () => {
    if (!DSN) {
        console.log('memoria-db saltato: nessun DATABASE_URL.');
        console.log('In CI il job fornisce un Postgres usa-e-getta; in locale basta:');
        console.log('DATABASE_URL=postgres://... npx tsx src/__tests__/memoria-db.test.ts');
        process.exit(0);
    }
    try {
        await testSchema();
        await testSalvaERilegge();
        await testDirezioneTradottaInRuolo();
        await testOrdineCronologico();
        await testIsolamentoFraContatti();
        await testIsolamentoFraUtenti();
        await testLimite();
        await testMessaggioLungoNonRompe();
        await testProfilo();
        await testProfiloContaLeInterazioni();
        await testProfiloNonPerdeIlNome();
        await testContattoSconosciuto();
        await testRiassunto();
        await testRicercaConoscenza();
        await testRicercaIsolataPerUtente();
        await testRicercaVuotaNonSolleva();
        await pulisci();
        console.log('\n🎉 memoria-db tests passed');
        process.exit(0);
    } catch (err: any) {
        console.error('\n❌ memoria-db test failed:', err?.message || err);
        process.exit(1);
    }
})();
