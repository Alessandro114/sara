// ═══════════════════════════════════════════════════
// db.ts contro un Postgres vero — node:assert
// Run: DATABASE_URL=postgres://... npx tsx src/__tests__/db-sessioni.test.ts
//
// db.ts era il file meno coperto del repo: 6,7% di righe, 6,66% di funzioni.
// Non perche sia codice trascurato — ci passa ogni messaggio che il bot
// riceve — ma perche in prova non c'e mai stato un database a cui parlare.
//
// A differenza di persistent-memory, qui le funzioni NON inghiottono gli
// errori: sollevano. E la scelta giusta (una sessione che non si salva e un
// guasto, non un dettaglio) e rende i test onesti senza sforzo: se una query
// e rotta, il test esplode invece di ricevere un [] silenzioso.
//
// Serve pgvector: initDB() apre con CREATE EXTENSION vector, perche la
// tabella della conoscenza tiene gli embedding come vector(1024). Il job usa
// percio l'immagine pgvector/pgvector:pg15 e non postgres:15 — con la seconda
// initDB() fallisce alla prima riga, ed e proprio il caso che il messaggio
// d'errore di db.ts spiega.
// ═══════════════════════════════════════════════════

import assert from 'node:assert/strict';
import {
    pool,
    initDB,
    getSession,
    upsertSession,
    updateLeadInfo,
    getConversationHistory,
    getLastTopics,
    updateLeadScore,
    logMessage,
    cancelPendingFollowups,
    scheduleFollowups,
    getPendingFollowups,
    markFollowupSent,
    lookupScalaUser,
} from '../db.js';

const DSN = process.env.DATABASE_URL;

// Un numero per ogni giro: i test non devono ereditare lo stato del giro
// precedente ne dipendere dall'ordine.
const TEL = '+39000' + String(Date.now()).slice(-7);
const TEL2 = '+39000' + String(Date.now() + 7).slice(-7);

async function testInitDB() {
    await initDB();
    const { rows } = await pool.query(
        `SELECT tablename FROM pg_tables WHERE schemaname='public'
         AND tablename IN ('wa_sessions','wa_messages','wa_lead_followups','wa_rag_documents')`
    );
    assert.equal(rows.length, 4, `attese 4 tabelle, trovate ${rows.length}`);
    console.log('✅ testInitDB: schema creato da zero');
}

async function testInitDBIdempotente() {
    // Ogni istruzione di initDB e CREATE ... IF NOT EXISTS: chiamarla due
    // volte deve essere innocuo. Se non lo fosse, ogni riavvio del bot
    // fallirebbe — e il bot chiama initDB() a ogni avvio.
    await initDB();
    console.log('✅ testInitDBIdempotente: la seconda chiamata non solleva');
}

async function testSessioneAssente() {
    const s = await getSession('+390000000000');
    assert.equal(s, null, 'un telefono mai visto deve dare null, non undefined');
    console.log('✅ testSessioneAssente: null su telefono sconosciuto');
}

async function testCreaSessione() {
    await upsertSession(TEL, { sector: 'ristorazione' });
    const s = await getSession(TEL);
    assert.ok(s, 'sessione non creata');
    assert.equal(s.sector, 'ristorazione');
    assert.equal(s.messages_count, 1, 'il conteggio iniziale deve essere 1');
    assert.equal(s.lead_score, 0);
    assert.equal(s.lead_stage, 'new');
    console.log('✅ testCreaSessione: sessione nuova con i valori predefiniti giusti');
}

async function testAggiornaSessione() {
    // Il secondo upsert prende l'altro ramo: UPDATE invece di INSERT.
    await upsertSession(TEL, { user_name: 'Marco', company_name: 'Trattoria Marco' });
    const s = await getSession(TEL);
    assert.equal(s.user_name, 'Marco');
    assert.equal(s.company_name, 'Trattoria Marco');
    assert.equal(s.messages_count, 2, 'ogni upsert incrementa il conteggio');
    assert.equal(s.sector, 'ristorazione', 'un campo non passato non deve essere azzerato');
    console.log('✅ testAggiornaSessione: UPDATE, conteggio a 2, nessun campo perso');
}

async function testCampiFacoltativi() {
    // I rami booleani si scrivono a parte nel codice (cta_shown, opted_out,
    // lead_score), quindi vanno esercitati esplicitamente.
    await upsertSession(TEL, { cta_shown: true, lead_score: 5, email: 'marco@trattoria.it' });
    const s = await getSession(TEL);
    assert.equal(s.cta_shown, true);
    assert.equal(s.lead_score, 5);
    assert.equal(s.email, 'marco@trattoria.it');
    console.log('✅ testCampiFacoltativi: cta_shown, lead_score ed email scritti');
}

async function testOptOutTimbraLOra() {
    // opted_out non e un booleano qualunque: quando diventa vero il codice
    // scrive anche opted_out_at. E il momento in cui una persona chiede di
    // non essere piu contattata, e la data serve a dimostrare quando.
    await upsertSession(TEL2, { sector: 'general' });
    await upsertSession(TEL2, { opted_out: true });
    const s = await getSession(TEL2);
    assert.equal(s.opted_out, true);
    assert.ok(s.opted_out_at, 'opted_out senza opted_out_at: manca la data della richiesta');
    console.log('✅ testOptOutTimbraLOra: opted_out scrive anche la data');
}

async function testUpdateLeadInfoVuoto() {
    // Nessun campo da aggiornare: la funzione deve uscire PRIMA di costruire
    // la query. Senza quel controllo si comporrebbe "SET  WHERE phone=$1",
    // che e un errore di sintassi.
    const prima = await getSession(TEL);
    await updateLeadInfo(TEL, {});
    const dopo = await getSession(TEL);
    assert.equal(dopo.user_name, prima.user_name, 'un aggiornamento vuoto ha cambiato qualcosa');
    console.log('✅ testUpdateLeadInfoVuoto: nessun campo, nessuna query, nessun errore');
}

async function testUpdateLeadInfo() {
    await updateLeadInfo(TEL, { company_size: 'micro', estimated_revenue: '100k-500k' });
    const s = await getSession(TEL);
    assert.equal(s.company_size, 'micro');
    assert.equal(s.estimated_revenue, '100k-500k');
    console.log('✅ testUpdateLeadInfo: campi aggiornati');
}

async function testStoricoConversazione() {
    await logMessage(TEL, 'in', 'quanto costa il piano base?');
    await logMessage(TEL, 'out', 'il piano base parte da 49 euro al mese');
    const storia = await getConversationHistory(TEL, 10);
    assert.ok(storia.length >= 2, `attesi 2 messaggi, trovati ${storia.length}`);

    // in→user, out→model: se la traduzione si inverte il modello crede di aver
    // detto lui cio che ha detto il cliente, e risponde a se stesso.
    const domanda = storia.find(m => m.content.includes('quanto costa'));
    const risposta = storia.find(m => m.content.includes('49 euro'));
    assert.equal(domanda?.role, 'user');
    assert.equal(risposta?.role, 'model');

    // E l'ordine dev'essere cronologico: la query legge DESC e poi inverte.
    const iD = storia.findIndex(m => m.content.includes('quanto costa'));
    const iR = storia.findIndex(m => m.content.includes('49 euro'));
    assert.ok(iD < iR, `ordine invertito: domanda in ${iD}, risposta in ${iR}`);
    console.log('✅ testStoricoConversazione: in→user, out→model, ordine cronologico');
}

async function testStoricoSoloTesto() {
    // Un audio senza trascrizione non ha contenuto da dare al modello: la
    // query filtra su media_type='text' apposta.
    await logMessage(TEL, 'in', '', 'audio');
    const storia = await getConversationHistory(TEL, 20);
    assert.ok(!storia.some(m => m.content === '' || m.content === null),
        'un messaggio non testuale e finito nello storico');
    console.log('✅ testStoricoSoloTesto: i media restano fuori dallo storico');
}

async function testStoricoIsolatoPerTelefono() {
    await logMessage(TEL2, 'in', 'MESSAGGIO-DI-UN-ALTRO-NUMERO');
    const storia = await getConversationHistory(TEL, 50);
    assert.ok(storia.length > 0, 'storico vuoto: il test non verifica niente');
    assert.ok(!storia.some(m => m.content.includes('MESSAGGIO-DI-UN-ALTRO-NUMERO')),
        'la conversazione di un altro numero e finita in questo storico');
    console.log('✅ testStoricoIsolatoPerTelefono: nessuna perdita fra conversazioni');
}

async function testLimiteStorico() {
    for (let i = 0; i < 8; i++) await logMessage(TEL, 'in', `riempitivo ${i}`);
    const poche = await getConversationHistory(TEL, 3);
    assert.equal(poche.length, 3, `il limite non e rispettato: ${poche.length}`);
    console.log('✅ testLimiteStorico: LIMIT rispettato');
}

async function testUltimiArgomenti() {
    const t = await getLastTopics(TEL);
    assert.equal(typeof t, 'string');
    assert.ok(t.length > 0, 'con messaggi in entrata gli argomenti non devono essere vuoti');
    assert.ok(t.includes('|'), 'piu messaggi vanno uniti con la barra');
    console.log(`✅ testUltimiArgomenti: "${t.slice(0, 70)}"`);
}

async function testUltimiArgomentiVuoto() {
    const t = await getLastTopics('+390000000001');
    assert.equal(t, '', 'senza messaggi deve tornare stringa vuota');
    console.log('✅ testUltimiArgomentiVuoto: stringa vuota su telefono muto');
}

async function testUltimiArgomentiTronca() {
    // Ogni messaggio viene tagliato a 100 caratteri: senza il taglio, cinque
    // messaggi lunghi entrerebbero interi nel contesto del modello.
    const tel = '+39000' + String(Date.now() + 11).slice(-7);
    await upsertSession(tel, {});
    await logMessage(tel, 'in', 'A'.repeat(500));
    const t = await getLastTopics(tel);
    assert.equal(t.length, 100, `atteso taglio a 100 caratteri, ottenuti ${t.length}`);
    console.log('✅ testUltimiArgomentiTronca: taglio a 100 caratteri');
}

async function testPunteggioSoglie() {
    // Le tre soglie del codice: <20 new, >=20 engaged, >=50 qualified.
    const tel = '+39000' + String(Date.now() + 3).slice(-7);
    await upsertSession(tel, { sector: 'general' });

    await updateLeadScore(tel, 10);
    assert.equal((await getSession(tel)).lead_stage, 'new', '10 punti non devono bastare');

    await updateLeadScore(tel, 15); // 25
    assert.equal((await getSession(tel)).lead_stage, 'engaged', '25 punti devono dare engaged');

    await updateLeadScore(tel, 30); // 55
    const s = await getSession(tel);
    assert.equal(s.lead_stage, 'qualified', '55 punti devono dare qualified');
    assert.equal(s.lead_score, 55);
    console.log('✅ testPunteggioSoglie: new → engaged (20) → qualified (50)');
}

async function testPunteggioSoglieAlBordo() {
    // I bordi esatti, 19/20 e 49/50. Le soglie sono `>=`, e un fuori-di-uno
    // qui sposta chi viene contattato e chi finisce nel CRM.
    //
    // Serve anche da rete contro il difetto appena corretto: updateLeadScore
    // leggeva la sessione DOPO l'UPDATE e sommava il delta una seconda volta,
    // quindi lo stadio si calcolava sul doppio e le soglie scattavano a meta.
    // Con quel difetto in piedi, questi due test falliscono entrambi.
    const a = '+39000' + String(Date.now() + 21).slice(-7);
    await upsertSession(a, {});
    await updateLeadScore(a, 19);
    assert.equal((await getSession(a)).lead_stage, 'new', '19 punti non devono dare engaged');
    await updateLeadScore(a, 1); // 20 esatti
    assert.equal((await getSession(a)).lead_stage, 'engaged', '20 punti esatti devono dare engaged');

    const b = '+39000' + String(Date.now() + 22).slice(-7);
    await upsertSession(b, {});
    await updateLeadScore(b, 49);
    assert.equal((await getSession(b)).lead_stage, 'engaged', '49 punti non devono dare qualified');
    await updateLeadScore(b, 1); // 50 esatti
    assert.equal((await getSession(b)).lead_stage, 'qualified', '50 punti esatti devono dare qualified');
    console.log('✅ testPunteggioSoglieAlBordo: 19→new, 20→engaged, 49→engaged, 50→qualified');
}

async function testPunteggioNonScendeSottoZero() {
    const tel = '+39000' + String(Date.now() + 4).slice(-7);
    await upsertSession(tel, {});
    await updateLeadScore(tel, -100);
    assert.equal((await getSession(tel)).lead_score, 0, 'il punteggio e andato sotto zero');
    console.log('✅ testPunteggioNonScendeSottoZero: GREATEST(0, ...) tiene');
}

async function testConvertitoNonTornaIndietro() {
    // Chi ha gia comprato non deve tornare "engaged" perche il punteggio si
    // muove: sarebbe un cliente riproposto come lead da coltivare.
    const tel = '+39000' + String(Date.now() + 5).slice(-7);
    await upsertSession(tel, {});
    await pool.query("UPDATE wa_sessions SET lead_stage='converted' WHERE phone=$1", [tel]);
    await updateLeadScore(tel, 25);
    assert.equal((await getSession(tel)).lead_stage, 'converted',
        'un contatto convertito e stato retrocesso');
    console.log('✅ testConvertitoNonTornaIndietro: converted non viene sovrascritto');
}

async function testPunteggioSuSessioneAssente() {
    // Nessuna sessione: la funzione esce senza sollevare.
    await updateLeadScore('+390000000002', 10);
    console.log('✅ testPunteggioSuSessioneAssente: nessuna eccezione');
}

async function testProgrammaSolleciti() {
    await scheduleFollowups(TEL, 'Marco', 'ristorazione');
    const { rows } = await pool.query(
        'SELECT followup_type, scheduled_at FROM wa_lead_followups WHERE phone=$1 AND cancelled=false ORDER BY scheduled_at',
        [TEL]
    );
    assert.equal(rows.length, 6, `attesi 6 solleciti, trovati ${rows.length}`);
    assert.equal(rows[0].followup_type, 'reengagement_7d');
    assert.equal(rows[5].followup_type, 'reengagement_300d');
    // Tutti nel futuro: uno nel passato partirebbe subito.
    assert.ok(rows.every((r: any) => new Date(r.scheduled_at) > new Date()),
        'un sollecito e programmato nel passato');
    console.log('✅ testProgrammaSolleciti: 6 solleciti da 7 a 300 giorni, tutti futuri');
}

async function testRiprogrammareAnnullaIPrecedenti() {
    // Se il contatto riscrive, i solleciti vecchi vanno annullati: altrimenti
    // riceve due volte lo stesso richiamo.
    await scheduleFollowups(TEL, 'Marco', 'ristorazione');
    const { rows: attivi } = await pool.query(
        'SELECT count(*)::int AS n FROM wa_lead_followups WHERE phone=$1 AND cancelled=false', [TEL]);
    const { rows: annullati } = await pool.query(
        'SELECT count(*)::int AS n FROM wa_lead_followups WHERE phone=$1 AND cancelled=true', [TEL]);
    assert.equal(attivi[0].n, 6, `attesi 6 attivi, trovati ${attivi[0].n}`);
    assert.equal(annullati[0].n, 6, `attesi 6 annullati, trovati ${annullati[0].n}`);
    console.log('✅ testRiprogrammareAnnullaIPrecedenti: 6 attivi, 6 annullati');
}

async function testSolleciti() {
    // getPendingFollowups prende solo quelli gia scaduti: i sei appena
    // programmati sono tutti nel futuro, quindi non devono comparire.
    const prima = await getPendingFollowups();
    assert.ok(!prima.some((f: any) => f.phone === TEL),
        'un sollecito futuro e stato dato per scaduto');

    // Ne porto uno nel passato e deve comparire, con i campi della sessione
    // uniti dalla JOIN.
    await pool.query(
        "UPDATE wa_lead_followups SET scheduled_at = NOW() - INTERVAL '1 hour' WHERE phone=$1 AND cancelled=false AND sent=false",
        [TEL]
    );
    const dopo = await getPendingFollowups();
    const mio = dopo.find((f: any) => f.phone === TEL);
    assert.ok(mio, 'il sollecito scaduto non e stato restituito');
    assert.equal(mio.user_name, 'Marco', 'la JOIN con wa_sessions non porta il nome');
    assert.equal(mio.sector, 'ristorazione');

    // E una volta segnato come inviato deve sparire.
    await markFollowupSent(mio.id);
    const finale = await getPendingFollowups();
    assert.ok(!finale.some((f: any) => f.id === mio.id), 'un sollecito inviato torna fra i pendenti');
    console.log('✅ testSolleciti: futuri esclusi, scaduti inclusi con la JOIN, inviati esclusi');
}

async function testAnnullaSolleciti() {
    await cancelPendingFollowups(TEL);
    const { rows } = await pool.query(
        'SELECT count(*)::int AS n FROM wa_lead_followups WHERE phone=$1 AND cancelled=false AND sent=false', [TEL]);
    assert.equal(rows[0].n, 0, `restano ${rows[0].n} solleciti attivi dopo l annullamento`);
    console.log('✅ testAnnullaSolleciti: nessun sollecito attivo residuo');
}

async function testLookupSenzaConfigurazione() {
    // Senza SCALA_DB_URL la funzione non deve tentare nessuna connessione:
    // deve dire di no e basta. E il caso di chiunque cloni il repo.
    const originale = process.env.SCALA_DB_URL;
    delete process.env.SCALA_DB_URL;
    try {
        const u = await lookupScalaUser('+393331234567');
        assert.equal(u, null, 'senza SCALA_DB_URL deve tornare null');
    } finally {
        if (originale !== undefined) process.env.SCALA_DB_URL = originale;
    }
    console.log('✅ testLookupSenzaConfigurazione: null senza SCALA_DB_URL');
}

async function pulisci() {
    for (const t of ['wa_lead_followups', 'wa_messages', 'wa_sessions']) {
        await pool.query(`DELETE FROM ${t} WHERE phone LIKE '+39000%'`);
    }
    await pool.end();
}

(async () => {
    if (!DSN) {
        console.log('db-sessioni saltato: nessun DATABASE_URL.');
        console.log('In CI il job fornisce un Postgres usa-e-getta (immagine pgvector,');
        console.log('perche initDB apre con CREATE EXTENSION vector).');
        process.exit(0);
    }
    try {
        await testInitDB();
        await testInitDBIdempotente();
        await testSessioneAssente();
        await testCreaSessione();
        await testAggiornaSessione();
        await testCampiFacoltativi();
        await testOptOutTimbraLOra();
        await testUpdateLeadInfoVuoto();
        await testUpdateLeadInfo();
        await testStoricoConversazione();
        await testStoricoSoloTesto();
        await testStoricoIsolatoPerTelefono();
        await testLimiteStorico();
        await testUltimiArgomenti();
        await testUltimiArgomentiVuoto();
        await testUltimiArgomentiTronca();
        await testPunteggioSoglie();
        await testPunteggioSoglieAlBordo();
        await testPunteggioNonScendeSottoZero();
        await testConvertitoNonTornaIndietro();
        await testPunteggioSuSessioneAssente();
        await testProgrammaSolleciti();
        await testRiprogrammareAnnullaIPrecedenti();
        await testSolleciti();
        await testAnnullaSolleciti();
        await testLookupSenzaConfigurazione();
        await pulisci();
        console.log('\n🎉 db-sessioni tests passed');
        process.exit(0);
    } catch (err: any) {
        console.error('\n❌ db-sessioni test failed:', err?.message || err);
        process.exit(1);
    }
})();
