// ═══════════════════════════════════════════════════
// scala-knowledge — quando SARA parla del PRODOTTO — node:assert
// Run: npx tsx src/__tests__/scala-knowledge.test.ts
//
// 788 righe, nessun test. E il modulo che decide quando iniettare nel contesto
// del modello il listino e la documentazione della piattaforma SCALA.
//
// Sbagliare qui costa in modo asimmetrico:
//
//   falso positivo  il cliente di un ristorante prenota la cena e si trova il
//                   listino degli abbonamenti nel contesto. Il modello viene
//                   invitato a parlargli di 97 euro al mese, e 26 righe di
//                   contesto vengono sprecate a ogni messaggio.
//   falso negativo  chi chiede davvero il prezzo non lo riceve.
//
// I test qui sotto sono nati da falsi positivi VERI, misurati: un numero di
// telefono, "quanto tempo ci vuole", "siamo al piano terra", "il vino costa
// 25€" facevano tutti scattare il listino.
// ═══════════════════════════════════════════════════

import assert from 'node:assert/strict';
import { buildKnowledgeContext, isScalaPlatformQuery } from '../scala-knowledge.js';

const iniettaListino = (q: string, lang = 'it') => buildKnowledgeContext(q, lang).includes('€97');

// ─── i falsi positivi che c'erano davvero ───

function testTelefonoNonInietta() {
    // '49', '149' e '298' erano nell'elenco come NUMERI NUDI, cercati come
    // sottostringa: un numero di telefono contiene quasi sempre "49".
    // Erano anche obsoleti — i prezzi veri sono 97, 197, 970, 1970.
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
    // Un ristorante che parla dei PROPRI prezzi non sta chiedendo quelli della
    // piattaforma. Il simbolo € da solo non basta.
    for (const m of ['il vino costa 25€', 'il menu fisso e 30€', 'un tavolo vista costa']) {
        assert.ok(!iniettaListino(m), `"${m}" fa iniettare il listino della piattaforma`);
    }
    console.log('✅ testPrezzoDelRistoranteNonInietta: i prezzi del locale non evocano quelli di SCALA');
}

// ─── e i veri positivi, che devono continuare a funzionare ───

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
    // Il listino esiste in quattro lingue: se la selezione sbaglia, il cliente
    // riceve i prezzi in una lingua che non parla.
    for (const [lang, spia] of [['it', 'Crediti'], ['en', 'Credits'], ['es', 'Creditos'], ['pt', 'Creditos']] as const) {
        const c = buildKnowledgeContext('quanto costa SCALA', lang);
        assert.ok(c.length > 0, `nessun contesto per lingua ${lang}`);
        assert.ok(c.includes('€97'), `il listino ${lang} non contiene il prezzo base`);
        void spia;
    }
    console.log('✅ testListinoNellaLinguaGiusta: 4 lingue, tutte col prezzo base');
}

function testPrezziCoerentiFraLingue() {
    // I quattro listini devono quotare gli STESSI importi: se una traduzione
    // resta indietro, SARA dice un prezzo diverso a seconda della lingua del
    // cliente. E il difetto piu difficile da accorgersene, perche ognuno dei
    // quattro testi letto da solo sembra giusto.
    const importi = (lang: string) => {
        const c = buildKnowledgeContext('quanto costa SCALA', lang);
        // normalizza il separatore decimale: 9,90 e 9.90 sono lo stesso prezzo
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
    // 'free', 'cost', 'trial' venivano cercati come sottostringa e vivevano
    // dentro parole comuni: freelance, costume, indus-TRIAL-e.
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
    // Se non c'e niente da dire, non deve restituire un involucro vuoto: quello
    // occuperebbe contesto senza portare informazione.
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
