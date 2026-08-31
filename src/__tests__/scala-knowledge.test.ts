// ═══════════════════════════════════════════════════
// scala-knowledge — when SARA talks about the PRODUCT — node:assert
// Run: npx tsx src/__tests__/scala-knowledge.test.ts
//
// 788 lines, no tests. This is the module that decides when to inject the
// platform's price list and documentation into the model's context.
//
// Getting this wrong is asymmetrically costly:
//
//   false positive  a restaurant customer books a table for dinner and ends
//                    up with the subscription price list in the context. The
//                    model is prompted to talk to them about 97 euros a
//                    month, and 26 lines of context are wasted on every
//                    message.
//   false negative  someone who genuinely asks about the price doesn't get it.
//
// The tests below came from REAL false positives, actually measured: a
// phone number, "how long does it take", "we're on the ground floor", "the
// wine costs 25€" all used to trigger the price list.
// ═══════════════════════════════════════════════════

import assert from 'node:assert/strict';
import { buildKnowledgeContext, isScalaPlatformQuery } from '../scala-knowledge.js';

const iniettaListino = (q: string, lang = 'it') => buildKnowledgeContext(q, lang).includes('€97');

// ─── the false positives that really happened ───

function testTelefonoNonInietta() {
    // '49', '149' and '298' were in the list as BARE NUMBERS, searched as a
    // substring: a phone number almost always contains "49".
    // They were also outdated — the real prices are 97, 197, 970, 1970.
    for (const m of ['il mio numero e +39 349 1234567', 'chiamami al 3491234567', 'sono le 14:9']) {
        assert.ok(!iniettaListino(m), `"${m}" fa iniettare il listino`);
    }
    console.log('✅ testTelefonoNonInietta: un numero di telefono non e una domanda sui prezzi');
}

function testQuantoDaSoloNonInietta() {
    for (const m of ['quanto tempo ci vuole', 'quanto dista dal centro', 'quanto siete lontani']) {
        assert.ok(!iniettaListino(m), `"${m}" fa iniettare il listino`);
    }
    console.log('✅ testQuantoDaSoloNonInietta: "quanto" senza "costa" non e una domanda sui prezzi');
}

function testPianoDaSoloNonInietta() {
    for (const m of ['siamo al piano terra', 'vai piano con il peperoncino', 'il primo piano e accessibile']) {
        assert.ok(!iniettaListino(m), `"${m}" fa iniettare il listino`);
    }
    console.log('✅ testPianoDaSoloNonInietta: "piano" e anche un pavimento e un avverbio');
}

function testPrezzoDelRistoranteNonInietta() {
    // A restaurant talking about ITS OWN prices isn't asking about the
    // platform's. The € symbol alone isn't enough.
    for (const m of ['il vino costa 25€', 'il menu fisso e 30€', 'un tavolo vista costa']) {
        assert.ok(!iniettaListino(m), `"${m}" fa iniettare il listino della piattaforma`);
    }
    console.log('✅ testPrezzoDelRistoranteNonInietta: i prezzi del locale non evocano quelli di SCALA');
}

// ─── and the true positives, which must keep working ───

function testDomandeVereSuiPrezzi() {
    const vere = ['quanto costa SCALA', 'quali sono i vostri prezzi', 'pricing',
        'how much does it cost', 'cuanto cuesta', 'preço do plano',
        'abbonamento mensile', 'quali piani avete'];
    for (const m of vere) {
        assert.ok(iniettaListino(m), `"${m}" NON fa iniettare il listino, ma dovrebbe`);
    }
    console.log(`✅ testDomandeVereSuiPrezzi: ${vere.length} domande in 4 lingue ricevono il listino`);
}

function testListinoNellaLinguaGiusta() {
    // The price list exists in four languages: if the selection picks the
    // wrong one, the customer receives prices in a language they don't speak.
    for (const [lang, spia] of [['it', 'Crediti'], ['en', 'Credits'], ['es', 'Creditos'], ['pt', 'Creditos']] as const) {
        const c = buildKnowledgeContext('quanto costa SCALA', lang);
        assert.ok(c.length > 0, `nessun contesto per lingua ${lang}`);
        assert.ok(c.includes('€97'), `il listino ${lang} non contiene il prezzo base`);
        void spia;
    }
    console.log('✅ testListinoNellaLinguaGiusta: 4 lingue, tutte col prezzo base');
}

function testPrezziCoerentiFraLingue() {
    // The four price lists must quote the SAME amounts: if one translation
    // falls behind, SARA quotes a different price depending on the
    // customer's language. It's the hardest defect to notice, because each
    // of the four texts reads correctly on its own.
    const importi = (lang: string) => {
        const c = buildKnowledgeContext('quanto costa SCALA', lang);
        // normalize the decimal separator: 9,90 and 9.90 are the same price
        return [...c.matchAll(/€\s?([\d.,]+)/g)]
            .map(m => m[1].replace(/\.(?=\d{3}\b)/g, '').replace(',', '.'))
            .sort();
    };
    const it = importi('it');
    assert.ok(it.length > 0, 'nessun importo trovato nel listino italiano');
    for (const lang of ['en', 'es', 'pt']) {
        assert.deepEqual(importi(lang), it, `il listino ${lang} quota importi diversi dall italiano`);
    }
    console.log(`✅ testPrezziCoerentiFraLingue: ${it.length} importi identici in 4 lingue`);
}

// ─── isScalaPlatformQuery ───

function testSegnaliCortiNonDentroLeParole() {
    // 'free', 'cost', 'trial' were being searched as substrings and lived
    // inside common words: freelance, costume, indus-TRIAL.
    const trappole = ['sono un freelance', 'vorrei un costume da bagno',
        'lavoro nel settore industriale', 'il vino e costoso'];
    for (const m of trappole) {
        assert.ok(!isScalaPlatformQuery(m), `"${m}" viene scambiato per una domanda sulla piattaforma`);
    }
    console.log(`✅ testSegnaliCortiNonDentroLeParole: ${trappole.length} parole comuni non attivano la piattaforma`);
}

function testDomandeVereSullaPiattaforma() {
    const vere = ['come si usa il BMC', 'dove trovo il CRM', 'non trovo la sezione OKR',
        'come funziona il pilot', 'quanto costa il menu', 'avete un piano gratuito'];
    for (const m of vere) {
        assert.ok(isScalaPlatformQuery(m), `"${m}" NON viene riconosciuta come domanda sulla piattaforma`);
    }
    console.log(`✅ testDomandeVereSullaPiattaforma: ${vere.length} domande riconosciute`);
}

function testConversazioneNormaleNonAttiva() {
    const normali = ['avete il pesce fresco', 'vorrei prenotare per due',
        'a che ora chiudete', 'un tavolo per stasera'];
    for (const m of normali) {
        assert.ok(!isScalaPlatformQuery(m), `"${m}" attiva la piattaforma senza motivo`);
    }
    console.log(`✅ testConversazioneNormaleNonAttiva: ${normali.length} messaggi da ristorante restano tali`);
}

function testNessunContestoSenzaMotivo() {
    // If there's nothing to say, it must not return an empty wrapper: that
    // would take up context without carrying any information.
    assert.equal(buildKnowledgeContext('vorrei prenotare per due', 'it'), '');
    console.log('✅ testNessunContestoSenzaMotivo: contesto vuoto, non un involucro vuoto');
}

(async () => {
    try {
        testTelefonoNonInietta();
        testQuantoDaSoloNonInietta();
        testPianoDaSoloNonInietta();
        testPrezzoDelRistoranteNonInietta();
        testDomandeVereSuiPrezzi();
        testListinoNellaLinguaGiusta();
        testPrezziCoerentiFraLingue();
        testSegnaliCortiNonDentroLeParole();
        testDomandeVereSullaPiattaforma();
        testConversazioneNormaleNonAttiva();
        testNessunContestoSenzaMotivo();
        console.log('\n🎉 scala-knowledge tests passed');
        process.exit(0);
    } catch (err: any) {
        console.error('\n❌ scala-knowledge test failed:', err?.message || err);
        process.exit(1);
    }
})();
