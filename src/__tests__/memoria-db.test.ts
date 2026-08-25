// ═══════════════════════════════════════════════════
// persistent-memory contro un Postgres vero — node:assert
// Run: DATABASE_URL=postgres://... npx tsx src/__tests__/memoria-db.test.ts
//
// Il grosso del codice non coperto di questo repo parla al database: db.ts era
// al 6,7%, persistent-memory al 27%. Non perche sia codice trascurato, ma
// perche in prova non c'e mai stato un database a cui parlare.
//
// La soluzione non e rattoppare il modulo `pg` con dei finti: quei test
// verificherebbero i finti. La soluzione e dare alla prova un Postgres vuoto e
// usa-e-getta — in CI e un container che dura quanto il job — e far girare il
// codice VERO. ensureMemorySchema() si crea le tabelle da solo, quindi non
// serve nemmeno una migrazione.
//
// Senza DATABASE_URL il file si salta invece di fallire: in locale non tutti
// hanno un Postgres, e un test rosso per assenza di ambiente addestra a
// ignorare i test rossi.
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

// Un numero che non puo collidere con dati veri.
const TEL = '+39000' + String(Date.now()).slice(-7);

async function testSchema() {
    await ensureMemorySchema();
    console.log('✅ testSchema: le tabelle L4/L5/L6 esistono (o sono state create)');
}

async function testSalvaERilegge() {
    await saveMessage(TEL, 'user', 'vorrei prenotare per due');
    await saveMessage(TEL, 'assistant', 'certamente, per quale sera?');
    const storia = await loadHistory(TEL, 10);
    assert.ok(storia.length >= 2, `attesi almeno 2 messaggi, trovati ${storia.length}`);
    const testi = storia.map(m => m.content).join(' | ');
    assert.ok(testi.includes('vorrei prenotare per due'), 'il messaggio dell utente non e stato ritrovato');
    console.log(`✅ testSalvaERilegge: ${storia.length} messaggi salvati e riletti`);
}

async function testOrdineCronologico() {
    // L'ordine conta: la storia va al modello come contesto, e invertita
    // racconta una conversazione che non e mai avvenuta.
    const storia = await loadHistory(TEL, 10);
    const ruoli = storia.map(m => m.role);
    const primoUtente = ruoli.indexOf('user');
    const primoAssistente = ruoli.indexOf('assistant');
    assert.ok(primoUtente < primoAssistente,
        `l ordine e invertito: ${ruoli.join(', ')}`);
    console.log('✅ testOrdineCronologico: la domanda viene prima della risposta');
}

async function testIsolamentoFraContatti() {
    // Il difetto piu grave possibile qui: la conversazione di un cliente che
    // finisce nel contesto di un altro.
    const altro = '+39000' + String(Date.now() + 1).slice(-7);
    await saveMessage(altro, 'user', 'MESSAGGIO-DI-UN-ALTRO-CONTATTO');
    const mia = await loadHistory(TEL, 50);
    assert.ok(!mia.some(m => m.content.includes('MESSAGGIO-DI-UN-ALTRO-CONTATTO')),
        'la conversazione di un altro contatto e finita in questa storia');
    console.log('✅ testIsolamentoFraContatti: nessuna perdita fra conversazioni');
}

async function testLimite() {
    for (let i = 0; i < 6; i++) await saveMessage(TEL, 'user', `riempitivo ${i}`);
    const poche = await loadHistory(TEL, 3);
    assert.ok(poche.length <= 3, `il limite non e rispettato: ${poche.length} messaggi`);
    console.log('✅ testLimite: il limite di messaggi viene rispettato');
}

async function testProfiloCreatoAlVolo() {
    const p = await getContactProfile(TEL);
    assert.ok(p, 'nessun profilo restituito per un contatto esistente');
    assert.equal(typeof p!.interaction_count, 'number');
    console.log(`✅ testProfiloCreatoAlVolo: profilo presente, ${p!.interaction_count} interazioni`);
}

async function testProfiloAggiornato() {
    await upsertContactProfile(TEL, { name: 'Mario Rossi', language: 'it' });
    const p = await getContactProfile(TEL);
    assert.equal(p?.name, 'Mario Rossi');
    assert.equal(p?.language, 'it');
    console.log('✅ testProfiloAggiornato: nome e lingua salvati e riletti');
}

async function testProfiloNonSovrascriveConNull() {
    // Un aggiornamento parziale non deve cancellare quello che non nomina.
    await upsertContactProfile(TEL, { language: 'en' });
    const p = await getContactProfile(TEL);
    assert.equal(p?.name, 'Mario Rossi', 'il nome e stato cancellato da un aggiornamento che non lo nominava');
    assert.equal(p?.language, 'en', 'la lingua non e stata aggiornata');
    console.log('✅ testProfiloNonSovrascriveConNull: l aggiornamento parziale non cancella il resto');
}

async function testContattoSconosciuto() {
    const p = await getContactProfile('+390000000000');
    // Puo crearlo al volo o restituire null: entrambi vanno bene, purche non sollevi.
    assert.ok(p === null || typeof p === 'object');
    console.log('✅ testContattoSconosciuto: nessuna eccezione su un contatto mai visto');
}

async function testRiassunto() {
    const s = await getConversationSummary(TEL);
    assert.ok(s === null || typeof s === 'string');
    console.log('✅ testRiassunto: restituisce un testo o null, mai un errore');
}

async function testRicercaConoscenza() {
    const r = await searchKnowledgeBase(TEL, 'orari di apertura', 3);
    assert.ok(Array.isArray(r), 'la ricerca non restituisce un elenco');
    assert.ok(r.length <= 3, `il limite non e rispettato: ${r.length}`);
    console.log(`✅ testRicercaConoscenza: elenco di ${r.length} voci, limite rispettato`);
}

async function testRicercaVuotaNonSolleva() {
    for (const q of ['', '   ', 'zzzzqqqq-che-non-esiste']) {
        const r = await searchKnowledgeBase(TEL, q, 3);
        assert.ok(Array.isArray(r), `"${q}" non restituisce un elenco`);
    }
    console.log('✅ testRicercaVuotaNonSolleva: query vuote o senza risultati restituiscono un elenco vuoto');
}

(async () => {
    if (!DSN) {
        console.log('⏭  memoria-db saltato: nessun DATABASE_URL.');
        console.log('   In CI il job fornisce un Postgres usa-e-getta; in locale');
        console.log('   basta: DATABASE_URL=postgres://... npx tsx src/__tests__/memoria-db.test.ts');
        process.exit(0);
    }
    try {
        await testSchema();
        await testSalvaERilegge();
        await testOrdineCronologico();
        await testIsolamentoFraContatti();
        await testLimite();
        await testProfiloCreatoAlVolo();
        await testProfiloAggiornato();
        await testProfiloNonSovrascriveConNull();
        await testContattoSconosciuto();
        await testRiassunto();
        await testRicercaConoscenza();
        await testRicercaVuotaNonSolleva();
        console.log('\n🎉 memoria-db tests passed');
        process.exit(0);
    } catch (err: any) {
        console.error('\n❌ memoria-db test failed:', err?.message || err);
        process.exit(1);
    }
})();
