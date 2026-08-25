// ═══════════════════════════════════════════════════
// persistent-memory contro un Postgres vero — node:assert
// Run: DATABASE_URL=postgres://... npx tsx src/__tests__/memoria-db.test.ts
//
// Il grosso del codice non coperto di questo repo parla al database:
// persistent-memory era al 27%, db.ts al 6,7%. Non perche sia codice
// trascurato, ma perche in prova non c'e mai stato un database a cui parlare.
//
// La soluzione non e rattoppare il modulo `pg` con dei finti: quei test
// verificherebbero i finti. La soluzione e dare alla prova un Postgres vuoto e
// usa-e-getta — in CI e un container che dura quanto il job — e far girare il
// codice VERO. ensureMemorySchema() si crea le tabelle da solo, quindi non
// serve nemmeno una migrazione.
//
// ATTENZIONE a come si scrivono le asserzioni qui dentro: OGNI funzione di
// persistent-memory cattura le proprie eccezioni e restituisce un ripiego —
// [] per le letture, niente per le scritture. E una scelta deliberata (la
// memoria non deve mai far cadere un messaggio di WhatsApp), ma per i test
// significa che un assert su Array.isArray passa anche con la query
// completamente rotta. Ogni test qui sotto deve percio verificare un DATO che
// puo esistere solo se la query ha funzionato davvero.
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

// Identificativi che non possono collidere con dati veri.
const UTENTE = '00000000-0000-0000-0000-0000000000e2';
const ALTRO_UTENTE = '00000000-0000-0000-0000-0000000000e3';
const TEL = '+39000' + String(Date.now()).slice(-7);

// Connessione diretta, usata SOLO per seminare dati e per leggere cio che il
// modulo non espone. Il codice in prova continua a usare il proprio pool.
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
    // Non basta che non sollevi: ensureMemorySchema cattura tutto e si limita a
    // un warning. Se fallisse in silenzio, ogni test successivo fallirebbe con
    // un messaggio molto meno chiaro di questo.
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
    // Il database registra inbound/outbound, il modello vuole user/assistant.
    // Se la traduzione si inverte, il modello crede di aver detto lui cio che
    // ha detto il cliente — e risponde a se stesso.
    const storia = await loadHistory(UTENTE, TEL, 10);
    const entrata = storia.find(m => m.content.includes('vorrei prenotare'));
    const uscita = storia.find(m => m.content.includes('per quale sera'));
    assert.equal(entrata?.role, 'user', 'un messaggio in entrata non risulta dell utente');
    assert.equal(uscita?.role, 'assistant', 'una risposta non risulta dell assistente');
    console.log('✅ testDirezioneTradottaInRuolo: inbound->user, outbound->assistant');
}

async function testOrdineCronologico() {
    // loadHistory legge in ordine DESC e poi inverte: la storia va al modello
    // come contesto, e invertita racconta una conversazione mai avvenuta.
    const storia = await loadHistory(UTENTE, TEL, 10);
    const iEntrata = storia.findIndex(m => m.content.includes('vorrei prenotare'));
    const iUscita = storia.findIndex(m => m.content.includes('per quale sera'));
    assert.ok(iEntrata >= 0 && iUscita >= 0, 'messaggi non ritrovati');
    assert.ok(iEntrata < iUscita, `l ordine e invertito: domanda in ${iEntrata}, risposta in ${iUscita}`);
    console.log('✅ testOrdineCronologico: la domanda viene prima della risposta');
}

async function testIsolamentoFraContatti() {
    // Il difetto piu grave possibile qui: la conversazione di un cliente che
    // finisce nel contesto di un altro.
    const altro = '+39000' + String(Date.now() + 1).slice(-7);
    await saveMessage(UTENTE, altro, 'inbound', 'MESSAGGIO-DI-UN-ALTRO-CONTATTO');
    const mia = await loadHistory(UTENTE, TEL, 50);
    assert.ok(mia.length > 0, 'la storia e vuota: il test non sta verificando nulla');
    assert.ok(!mia.some(m => m.content.includes('MESSAGGIO-DI-UN-ALTRO-CONTATTO')),
        'la conversazione di un altro contatto e finita in questa storia');
    console.log('✅ testIsolamentoFraContatti: nessuna perdita fra conversazioni');
}

async function testIsolamentoFraUtenti() {
    // Stessa cosa fra tenant diversi: due aziende sullo stesso numero non
    // devono vedersi. Qui il telefono e IDENTICO, cambia solo user_id: se la
    // WHERE dimenticasse user_id, questo test lo vedrebbe e l'altro no.
    await saveMessage(ALTRO_UTENTE, TEL, 'inbound', 'MESSAGGIO-DI-UN-ALTRO-UTENTE');
    const mia = await loadHistory(UTENTE, TEL, 50);
    assert.ok(mia.length > 0, 'la storia e vuota: il test non sta verificando nulla');
    assert.ok(!mia.some(m => m.content.includes('MESSAGGIO-DI-UN-ALTRO-UTENTE')),
        'la conversazione di un altro tenant e finita in questa storia');
    console.log('✅ testIsolamentoFraUtenti: nessuna perdita fra tenant');
}

async function testLimite() {
    // 25 messaggi, non 5: sopra la ventina si apre il ramo vero di
    // getConversationSummary, che sotto quella soglia esce subito.
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
    // "mi chiamo Mario Rossi" deve far scattare l estrazione del nome: e
    // l unico pezzo di upsertContactProfile che non sia contabilita.
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
    // Il nome si scrive solo se non c'e gia: un "sono Interessato" non deve
    // ribattezzare Mario Rossi.
    await upsertContactProfile(UTENTE, TEL, 'sono Interessato al menu', 'ecco il menu');
    const p = await getContactProfile(UTENTE, TEL);
    assert.equal(p!.name, 'Mario Rossi', `il nome e stato sovrascritto: ${JSON.stringify(p!.name)}`);
    console.log('✅ testProfiloNonPerdeIlNome: il nome gia noto non viene sovrascritto');
}

async function testContattoSconosciuto() {
    const p = await getContactProfile(UTENTE, '+390000000000');
    // Puo crearlo al volo o restituire null: entrambi vanno bene, purche non
    // restituisca il profilo di qualcun altro.
    assert.ok(p === null || (typeof p === 'object' && p.name !== 'Mario Rossi'),
        'un contatto mai visto restituisce il profilo di un altro');
    console.log('✅ testContattoSconosciuto: nessuna confusione su un contatto mai visto');
}

async function testRiassunto() {
    // Sopra i 20 messaggi il riassunto viene costruito davvero (conteggio,
    // giorni, ultimo argomento). Sotto, la funzione esce con stringa vuota.
    const s = await getConversationSummary(UTENTE, TEL);
    assert.equal(typeof s, 'string', 'il riassunto non e un testo');
    assert.ok(s.length > 0, 'con oltre 20 messaggi il riassunto non dovrebbe essere vuoto');
    console.log(`✅ testRiassunto: "${s.slice(0, 90)}"`);
}

async function testRicercaConoscenza() {
    // Senza seminare, questa ricerca restituirebbe [] sia funzionando sia
    // rotta — searchKnowledgeBase cattura le proprie eccezioni. Semino io.
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
    // Parole sotto i 3 caratteri: la funzione esce prima della query.
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
