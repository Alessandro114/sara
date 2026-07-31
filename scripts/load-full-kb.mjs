// Load comprehensive KB for ALL verticals + products into wa_rag_documents
// Run: node scripts/load-full-kb.mjs
import 'dotenv/config';
import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Dynamic import for embedChain
const { embedChain } = await import('../dist/lib/ai-providers.js');

const KB = {
  // ═══════════════════════════════════════════════════════════════
  // VERTICALS
  // ═══════════════════════════════════════════════════════════════
  legale: [
    { t: 'Servizi studio legale', q: 'Che servizi offre lo studio legale?', a: 'Lo studio offre consulenza in diritto civile, penale, societario, del lavoro, famiglia e successioni. Forniamo assistenza stragiudiziale, redazione contratti, mediazione, e rappresentanza in tribunale. Per una consulenza iniziale, puoi prenotare un appuntamento.' },
    { t: 'Costi consulenza legale', q: 'Quanto costa una consulenza legale?', a: 'Il costo dipende dalla complessità del caso. Una prima consulenza orientativa ha un costo che viene concordato direttamente con l\'avvocato. Per cause civili, le tariffe seguono i parametri forensi ministeriali (DM 55/2014 aggiornato). Contattaci per un preventivo personalizzato.' },
    { t: 'Tempi causa civile', q: 'Quanto dura una causa civile?', a: 'I tempi variano molto: una causa semplice in tribunale può durare 1-3 anni in primo grado. Con appello e Cassazione si può arrivare a 5-8 anni. La mediazione obbligatoria (D.Lgs. 28/2010) può risolvere molte controversie in 3-6 mesi. Il nostro studio privilegia soluzioni stragiudiziali quando possibile.' },
    { t: 'Documenti per causa', q: 'Quali documenti servono per iniziare una causa?', a: 'Servono: documento d\'identità, codice fiscale, documentazione relativa al caso (contratti, corrispondenza, foto, testimonianze). Per cause di lavoro: buste paga, contratto di lavoro, lettere del datore. Per famiglia: certificati anagrafici, stato patrimoniale. Il nostro studio ti guida nella raccolta.' },
    { t: 'Diritto del lavoro', q: 'Mi hanno licenziato, cosa posso fare?', a: 'Hai 60 giorni per impugnare il licenziamento con lettera raccomandata, poi 180 giorni per depositare il ricorso in tribunale. Porta subito la lettera di licenziamento, il contratto di lavoro e le ultime buste paga. Valuteremo se il licenziamento è illegittimo e le tutele applicabili (reintegra o indennizzo).' },
    { t: 'Separazione e divorzio', q: 'Come funziona la separazione?', a: 'Si può procedere con separazione consensuale (accordo tra le parti, più rapida e meno costosa) o giudiziale (quando non c\'è accordo). Dopo la separazione, si può chiedere il divorzio dopo 6 mesi (consensuale) o 12 mesi (giudiziale). Dal 2014 è possibile anche la negoziazione assistita davanti agli avvocati.' },
    { t: 'Recupero crediti', q: 'Come recupero un credito?', a: 'Il percorso è: 1) Diffida stragiudiziale (lettera dell\'avvocato). 2) Se non basta: decreto ingiuntivo (procedura rapida, 30-40 giorni). 3) Se il debitore si oppone: causa ordinaria. 4) Esecuzione forzata sui beni del debitore. Per crediti documentati (fatture, contratti), il decreto ingiuntivo è lo strumento più efficace.' },
    { t: 'Successioni e eredità', q: 'Come funziona l\'eredità?', a: 'Alla morte, gli eredi hanno 3 opzioni: accettare l\'eredità (anche tacitamente), accettare con beneficio d\'inventario (rispondi dei debiti solo fino al valore dell\'eredità), o rinunciare. La dichiarazione di successione va presentata entro 12 mesi all\'Agenzia delle Entrate. Il testamento prevale sulla successione legittima, ma esistono quote di legittima riservate ai familiari stretti.' },
  ],
  commercialista: [
    { t: 'Servizi commercialista', q: 'Che servizi offre il commercialista?', a: 'Offriamo: contabilità ordinaria e semplificata, dichiarazioni dei redditi (730, Unico, ISA), bilanci, consulenza fiscale e tributaria, apertura e gestione partita IVA, buste paga e consulenza del lavoro, pianificazione fiscale, assistenza in caso di accertamento, fatturazione elettronica.' },
    { t: 'Apertura partita IVA', q: 'Come apro la partita IVA?', a: 'L\'apertura è gratuita presso l\'Agenzia delle Entrate. Devi scegliere il codice ATECO (attività), il regime fiscale (forfettario se fatturi meno di 85.000€/anno, ordinario altrimenti), e la forma giuridica (ditta individuale, SRL, ecc.). Il nostro studio gestisce tutta la pratica e ti consiglia il regime più vantaggioso.' },
    { t: 'Regime forfettario', q: 'Come funziona il regime forfettario?', a: 'Il forfettario prevede: imposta sostitutiva del 15% (5% per i primi 5 anni di nuova attività), niente IVA in fattura, contabilità semplificata. Limite di fatturato: 85.000€/anno. Non puoi dedurre costi reali, ma si applica un coefficiente di redditività basato sul codice ATECO (es. 78% per professionisti, 40% per commercio).' },
    { t: 'Scadenze fiscali', q: 'Quali sono le principali scadenze fiscali?', a: 'Le scadenze principali: 16 marzo (saldo IVA annuale), 30 giugno (dichiarazione redditi e saldo imposte), 30 novembre (acconto imposte), 16 di ogni mese (IVA mensile, ritenute). Il nostro studio invia promemoria automatici e gestisce tutti gli adempimenti per te.' },
    { t: 'Fatturazione elettronica', q: 'Come funziona la fatturazione elettronica?', a: 'Dal 2024 è obbligatoria per tutti, inclusi i forfettari. Le fatture vanno emesse in formato XML e inviate tramite il Sistema di Interscambio (SDI) dell\'Agenzia delle Entrate. Il nostro studio può fornirti un software di fatturazione integrato o gestire l\'invio per te.' },
    { t: 'SRL vantaggi', q: 'Conviene aprire una SRL?', a: 'La SRL conviene quando: il fatturato supera 85.000€, vuoi proteggere il patrimonio personale (responsabilità limitata), hai soci, o vuoi ottimizzare il carico fiscale. Costi: notaio (1.500-3.000€), diritti camerali (120€/anno), contabilità ordinaria obbligatoria. La SRL semplificata (SRLS) ha costi di costituzione ridotti.' },
  ],
  ristorante: [
    { t: 'Prenotazione tavolo', q: 'Vorrei prenotare un tavolo', a: 'Posso aiutarti con la prenotazione! Dimmi: per quante persone, quale data e orario preferisci. Ti confermerò la disponibilità subito. Per esigenze particolari (allergie, seggiolone, area esterna) comunicalo al momento della prenotazione.' },
    { t: 'Menu e specialità', q: 'Qual è il menu del giorno?', a: 'Il menu cambia ogni giorno in base alla disponibilità degli ingredienti freschi. Puoi consultare il menu aggiornato sulla nostra pagina o chiedere al personale. Abbiamo sempre opzioni per vegetariani, vegani e intolleranze (glutine, lattosio). Segnalaci le tue esigenze alimentari.' },
    { t: 'Orari ristorante', q: 'Quali sono gli orari di apertura?', a: 'Gli orari variano per ogni locale. Generalmente: pranzo 12:00-14:30, cena 19:00-22:30. Giorno di chiusura settimanale variabile. Per orari esatti e disponibilità, contatta direttamente il ristorante o consulta la nostra pagina.' },
    { t: 'Allergie alimentari', q: 'Avete opzioni per celiaci?', a: 'Sì, abbiamo opzioni senza glutine. Il nostro personale è formato sulla gestione delle allergie alimentari (Reg. UE 1169/2011). Segnala sempre le allergie al momento della prenotazione e al cameriere. Il nostro menu indica i 14 allergeni obbligatori per legge.' },
    { t: 'Delivery e asporto', q: 'Fate consegna a domicilio?', a: 'Molti dei nostri locali partner offrono delivery tramite le principali piattaforme (Glovo, Deliveroo, JustEat) o servizio di asporto diretto. Contatta il ristorante per verificare disponibilità nella tua zona e per ordinare direttamente (spesso risparmi le commissioni delle piattaforme).' },
    { t: 'Eventi e catering', q: 'Organizzate eventi privati?', a: 'Sì, offriamo servizio catering e organizzazione eventi: cene aziendali, compleanni, matrimoni, aperitivi. Possiamo personalizzare menu, allestimento e servizio in base alle tue esigenze. Contattaci con almeno 2 settimane di anticipo per eventi speciali.' },
  ],
  dermatologia: [
    { t: 'Trattamenti estetici', q: 'Quanto costa il botox?', a: 'Il costo del botulino varia in base all\'area trattata: fronte e glabella 250-400€, contorno occhi 200-350€, trattamento completo viso 400-600€. Il prezzo include la visita preliminare. I risultati durano 4-6 mesi. Prenota una consulenza per un preventivo personalizzato.' },
    { t: 'Filler acido ialuronico', q: 'Quanto costa il filler?', a: 'I filler a base di acido ialuronico: labbra 300-500€, zigomi 400-600€, solchi naso-labiali 350-500€ per fiala. La durata è 6-12 mesi a seconda del prodotto. Utilizziamo solo filler certificati CE. La prima visita include la valutazione e il piano di trattamento.' },
    { t: 'Visita dermatologica', q: 'Come prenoto una visita dermatologica?', a: 'Puoi prenotare una visita dermatologica contattandoci direttamente. La prima visita include: anamnesi completa, esame clinico della cute, dermatoscopia dei nei (mappatura), e piano terapeutico. Porta eventuali referti precedenti e l\'elenco dei farmaci in uso.' },
    { t: 'Controllo nei', q: 'Ogni quanto controllare i nei?', a: 'Si raccomanda un controllo annuale dei nei con dermatoscopia digitale. Controlli più frequenti (ogni 6 mesi) per chi ha: molti nei (>50), nei atipici, familiarità per melanoma, pelle chiara, storia di scottature solari. La regola ABCDE aiuta l\'autoesame: Asimmetria, Bordi irregolari, Colore disomogeneo, Dimensione >6mm, Evoluzione.' },
    { t: 'Acne trattamento', q: 'Come si cura l\'acne?', a: 'Il trattamento dell\'acne dipende dalla gravità: lieve (detergenti specifici, retinoidi topici), moderata (antibiotici topici, acido azelaico, peeling chimici), severa (isotretinoina orale, sotto controllo medico). I risultati richiedono 2-3 mesi. Evita il fai-da-te: un dermatologo personalizza la terapia ed evita cicatrici.' },
    { t: 'Epilazione laser', q: 'Come funziona l\'epilazione laser?', a: 'Il laser colpisce la melanina del pelo, distruggendo il bulbo pilifero. Servono 6-10 sedute a distanza di 4-6 settimane. Funziona meglio su peli scuri e pelle chiara. Costi indicativi: ascelle 80-150€/seduta, inguine 100-200€, gambe intere 200-400€. Non esporsi al sole 2 settimane prima e dopo.' },
  ],
  immobiliare: [
    { t: 'Valutazione immobile', q: 'Quanto vale il mio immobile?', a: 'Per una valutazione accurata consideriamo: zona, metratura, stato dell\'immobile, piano, esposizione, classe energetica, presenza di posto auto/cantina. Offriamo valutazioni gratuite basate su comparabili di mercato e banche dati OMI (Osservatorio Mercato Immobiliare). Contattaci per un sopralluogo.' },
    { t: 'Processo di vendita', q: 'Come funziona la vendita di un immobile?', a: 'Le fasi sono: 1) Valutazione e incarico. 2) Preparazione documentazione (APE, visura, planimetria). 3) Pubblicazione annuncio con foto professionali. 4) Visite con potenziali acquirenti. 5) Proposta d\'acquisto e negoziazione. 6) Compromesso (preliminare). 7) Rogito notarile. Tempi medi: 3-6 mesi.' },
    { t: 'Mutuo casa', q: 'Come funziona il mutuo?', a: 'Il mutuo copre fino all\'80% del valore dell\'immobile (100% per under 36 con garanzia Consap). Serve: reddito dimostrabile, rata non superiore al 30-35% del reddito netto, nessuna segnalazione in CRIF. Tasso fisso (sicurezza) o variabile (rata iniziale più bassa). Il nostro ufficio ti assiste nella scelta e nella pratica.' },
    { t: 'Costi acquisto casa', q: 'Quali sono i costi per comprare casa?', a: 'Oltre al prezzo: imposta di registro 2% prima casa / 9% seconda casa (sul valore catastale), IVA 4% prima casa / 10% seconda da costruttore, notaio 2.000-4.000€, agenzia immobiliare 2-4% + IVA, perizia banca 200-400€, istruttoria mutuo 0.5-1%. Per prima casa under 36: agevolazioni fiscali significative.' },
    { t: 'Affitto casa', q: 'Come affittare un immobile?', a: 'Per affittare serve: APE (attestato prestazione energetica), contratto registrato (cedolare secca 21% o IRPEF ordinaria), cauzione massima 3 mensilità. Tipi di contratto: libero (4+4 anni), concordato (3+2, con canone calmierato e vantaggi fiscali), transitorio (1-18 mesi). Il nostro ufficio gestisce tutto l\'iter.' },
    { t: 'Classe energetica', q: 'Cos\'è la classe energetica?', a: 'La classe energetica (APE) va da A4 (più efficiente) a G (meno efficiente). È obbligatoria per vendita e affitto. Influenza il valore dell\'immobile: un salto di 2 classi può aumentare il valore del 5-15%. Per migliorarla: cappotto termico, infissi, caldaia a condensazione, pompa di calore. Bonus edilizi disponibili.' },
  ],
  automotive: [
    { t: 'Acquisto auto', q: 'Cerco un\'auto usata', a: 'Nella nostra selezione trovi auto usate certificate con: garanzia 12-24 mesi, storico manutenzioni, chilometraggio verificato, nessun incidente. Dimmi che tipo di auto cerchi (berlina, SUV, utilitaria), budget, e preferenze (benzina, diesel, ibrida, elettrica). Ti proporrò le migliori opzioni.' },
    { t: 'Finanziamento auto', q: 'Come funziona il finanziamento?', a: 'Offriamo diverse soluzioni: finanziamento classico (TAN dal 4.99%), leasing, noleggio a lungo termine. Anticipo da 0% a 30%, durata 24-84 mesi. Simulazione rata immediata. Servono: documento d\'identità, codice fiscale, ultime 2 buste paga (o ultimo bilancio per P.IVA). Risposta in 24h.' },
    { t: 'Tagliando auto', q: 'Quanto costa il tagliando?', a: 'Il costo del tagliando dipende dal modello: utilitaria 150-250€, berlina media 200-350€, SUV/premium 300-500€. Include: cambio olio e filtri, controllo freni, batteria, livelli, pneumatici, impianto di scarico. Rispettiamo il piano di manutenzione del costruttore per mantenere la garanzia.' },
    { t: 'Revisione auto', q: 'Quando scade la revisione?', a: 'La revisione è obbligatoria: prima revisione dopo 4 anni dall\'immatricolazione, poi ogni 2 anni. Costo: 66.88€ (tariffa ministeriale) + 12.09€ per bollettino postale. Si controlla: emissioni, freni, luci, sospensioni, sterzo, pneumatici. Prenota per evitare attese.' },
    { t: 'Auto elettrica', q: 'Conviene l\'auto elettrica?', a: 'Vantaggi: costo energia 2-3€/100km (vs 8-12€ benzina), manutenzione ridotta del 40%, incentivi statali fino a 5.000€, esenzione bollo 5 anni, accesso ZTL. Svantaggi: prezzo d\'acquisto più alto, autonomia 300-500km, rete di ricarica in crescita. Per chi fa 15.000+ km/anno, il risparmio è significativo in 3-5 anni.' },
  ],
  turismo: [
    { t: 'Prenotazione hotel', q: 'Vorrei prenotare una camera', a: 'Posso aiutarti! Dimmi: date del soggiorno, numero di ospiti, preferenze (camera doppia/singola/suite, vista, piano alto). Ti comunicherò disponibilità e tariffa migliore. Prenotando direttamente con noi spesso ottieni la miglior tariffa garantita e vantaggi esclusivi.' },
    { t: 'Check-in e servizi', q: 'A che ora è il check-in?', a: 'Check-in generalmente dalle 14:00-15:00, check-out entro le 10:00-11:00. Early check-in e late check-out disponibili su richiesta (soggetti a disponibilità). Servizi: Wi-Fi gratuito, colazione, parcheggio, concierge. Per richieste speciali (culla, camera comunicante), comunicale al momento della prenotazione.' },
    { t: 'Cancellazione prenotazione', q: 'Come cancello la prenotazione?', a: 'Le condizioni di cancellazione dipendono dalla tariffa scelta: flessibile (cancellazione gratuita fino a 24-48h prima), non rimborsabile (tariffa scontata ma non cancellabile). Contattaci direttamente per verificare la tua prenotazione e le opzioni disponibili. In caso di forza maggiore, valutiamo caso per caso.' },
    { t: 'Escursioni e tour', q: 'Che escursioni offrite?', a: 'Organizziamo tour guidati della città, escursioni naturalistiche, degustazioni enogastronomiche, visite culturali. La reception/concierge può prenotare per te e consigliare le esperienze migliori in base ai tuoi interessi e alla durata del soggiorno. Chiedi la nostra guida delle esperienze locali.' },
  ],
  beauty: [
    { t: 'Taglio e piega', q: 'Quanto costa taglio e piega?', a: 'I prezzi variano per salone e servizio: taglio donna 25-50€, taglio uomo 15-25€, piega 15-30€, taglio + piega donna 35-60€. Per colorazioni, meches, balayage e trattamenti speciali, il prezzo dipende dalla lunghezza e dal tipo di capello. Prenota per un preventivo personalizzato.' },
    { t: 'Trattamenti estetici', q: 'Che trattamenti offrite?', a: 'I nostri trattamenti: manicure/pedicure (da 20€), ceretta (da 15€), pulizia viso (40-60€), massaggio (50-80€/h), extension ciglia (80-120€), laminazione sopracciglia (30-50€), trattamenti anticellulite, radiofrequenza. Pacchetti disponibili per trattamenti combinati. Prenota una consulenza gratuita.' },
    { t: 'Colorazione capelli', q: 'Quanto costa la colorazione?', a: 'Colore intero: 40-70€, ritocco ricrescita: 30-50€, meches/colpi di sole: 50-90€, balayage: 80-150€, shatush: 70-120€, decolorazione: 60-100€. I prezzi includono taglio e piega. Utilizziamo prodotti professionali a basso contenuto di ammoniaca. Consigliamo un test allergico 48h prima per nuovi clienti.' },
    { t: 'Prenotazione salone', q: 'Come prenoto un appuntamento?', a: 'Puoi prenotare via WhatsApp (scrivi qui!), telefono, o tramite la nostra app. Indica il servizio desiderato, l\'operatore preferito (se ne hai uno), e la fascia oraria. Conferma automatica via messaggio. Per cancellare o spostare, avvisa almeno 24h prima.' },
  ],
  cleaning: [
    { t: 'Servizi di pulizia', q: 'Che servizi di pulizia offrite?', a: 'Offriamo: pulizia ordinaria uffici e condomini, sanificazione ambienti, pulizia post-cantiere, pulizia vetri e facciate, trattamento pavimenti (ceratura, levigatura), pulizia industriale, disinfestazione. Interventi programmati (giornalieri, settimanali, mensili) o spot su richiesta.' },
    { t: 'Preventivo pulizie', q: 'Quanto costa il servizio di pulizia?', a: 'Il costo dipende da: metratura, frequenza, tipo di ambiente (ufficio, condominio, industriale), servizi richiesti. Indicativamente: ufficio 100mq pulizia giornaliera da 400€/mese, condominio scale da 150€/mese, pulizia post-cantiere da 3€/mq. Sopralluogo e preventivo gratuiti.' },
    { t: 'Sanificazione', q: 'Fate sanificazione ambienti?', a: 'Sì, offriamo sanificazione certificata con: ozono, nebulizzazione di disinfettanti ospedalieri, trattamento superfici. Rilasciamo certificato di avvenuta sanificazione (valido ai fini normativi). Per ambienti sanitari, alimentari e ad alto rischio, utilizziamo protocolli specifici conformi alle normative vigenti.' },
    { t: 'Pulizia condominio', q: 'Servizio pulizia condominio', a: 'Servizio completo per condomini: pulizia scale e pianerottoli, ascensore, androne, cortile, garage, lavaggio vetri parti comuni. Frequenza personalizzabile. Contratti annuali con prezzi bloccati. Operatori formati e assicurati. Prodotti professionali eco-compatibili. Referenze disponibili su richiesta.' },
  ],
  wellness: [
    { t: 'Abbonamento palestra', q: 'Quanto costa l\'abbonamento?', a: 'Tariffe indicative: mensile 40-80€, trimestrale 100-200€, annuale 300-600€. Include accesso sala pesi, corsi di gruppo (pilates, yoga, spinning, crossfit, functional). Prova gratuita disponibile. Per personal trainer: sessioni singole 30-60€, pacchetti da 10 con sconto 15-20%.' },
    { t: 'Personal trainer', q: 'Avete il personal trainer?', a: 'Sì, i nostri personal trainer certificati offrono: valutazione fitness iniziale, programma personalizzato, correzione esecuzione esercizi, supporto motivazionale, piano nutrizionale (in collaborazione con nutrizionista). Sessioni individuali o small group (2-4 persone, costo ridotto). Prima sessione di valutazione gratuita.' },
    { t: 'Corsi fitness', q: 'Che corsi avete?', a: 'Il nostro palinsesto: Yoga (Hatha, Vinyasa, Power), Pilates (mat e reformer), Spinning/Indoor Cycling, CrossFit, Functional Training, Zumba, Boxe Fitness, Acquagym, Stretching, TRX. Corsi per tutti i livelli, dal principiante all\'avanzato. Orari mattina, pausa pranzo e sera.' },
    { t: 'Piscina e SPA', q: 'Avete la piscina?', a: 'La disponibilità di piscina e area SPA varia per struttura. Dove presente: piscina coperta riscaldata (25m), area benessere con sauna, bagno turco, idromassaggio, docce emozionali. Corsi di nuoto per adulti e bambini. Ingresso SPA giornaliero o incluso negli abbonamenti premium.' },
  ],
  service: [
    { t: 'Assistenza tecnica', q: 'Ho bisogno di un tecnico', a: 'Offriamo assistenza per: caldaie, condizionatori, impianti elettrici, idraulici, elettrodomestici. Intervento ordinario in 24-48h, urgenze entro 4h. Dimmi il tipo di problema e la tua zona, ti invio un tecnico qualificato. Preventivo sempre fornito prima dell\'intervento.' },
    { t: 'Manutenzione caldaia', q: 'Quanto costa la manutenzione caldaia?', a: 'Manutenzione ordinaria: 80-120€ (pulizia bruciatore, controllo sicurezze, verifica fumi). Analisi fumi obbligatoria: 60-80€ (ogni 2 o 4 anni a seconda della regione). Contratto annuale all-inclusive: 150-200€. Marche principali: Vaillant, Baxi, Immergas, Ariston, Junkers. Intervento entro 48h.' },
    { t: 'Idraulico urgente', q: 'Ho una perdita d\'acqua, serve un idraulico', a: 'Per emergenze idrauliche interveniamo entro 2-4 ore. Le urgenze più comuni: perdite, tubature rotte, scarichi intasati, boiler guasto, allagamenti. Chiudi subito la valvola principale dell\'acqua per limitare i danni. Chiamaci e inviamo un tecnico nella tua zona.' },
    { t: 'Elettricista', q: 'Mi serve un elettricista', a: 'I nostri elettricisti gestiscono: guasti all\'impianto, cortocircuiti, installazione prese/interruttori, quadro elettrico, messa a norma (certificazione DM 37/08), installazione lampadari, citofoni, videocitofoni, domotica. Preventivo gratuito. Intervento ordinario 24-48h, urgenze 4h.' },
  ],
  franchise: [
    { t: 'Aprire franchising', q: 'Come funziona il franchising?', a: 'Il franchising ti permette di aprire un\'attività con un brand consolidato, format testato e supporto continuo. Prevede: fee d\'ingresso (investimento iniziale), royalty mensili (% sul fatturato), formazione iniziale e continua, manuale operativo, marketing centralizzato. I tempi di apertura sono generalmente 3-6 mesi.' },
    { t: 'Costi franchising', q: 'Quanto costa aprire un franchising?', a: 'L\'investimento varia per settore: ristorazione 100-300K€, retail 50-150K€, servizi 20-80K€, beauty 30-100K€. Include fee d\'ingresso, allestimento locale, attrezzature, stock iniziale, formazione. Molti franchisor offrono supporto per il finanziamento bancario. Il break-even è tipicamente a 12-24 mesi.' },
    { t: 'Requisiti affiliato', q: 'Che requisiti servono per affiliarsi?', a: 'Requisiti tipici: disponibilità economica (investimento iniziale), locale idoneo (metratura e posizione definite dal franchisor), motivazione imprenditoriale, disponibilità a seguire il format. Non sempre serve esperienza nel settore — la formazione è inclusa. Invia la tua candidatura per una valutazione.' },
  ],
  network_marketing: [
    { t: 'Cos\'è il network', q: 'Come funziona il network marketing?', a: 'Il network marketing è un modello di vendita diretta dove guadagni sia dalla vendita di prodotti che dalla costruzione di un team. Non è uno schema piramidale (quelli sono illegali). La differenza: nel network legittimo guadagni dalla VENDITA di prodotti reali, non dal reclutamento. Verifica sempre che l\'azienda sia iscritta ad Avedisco o Univendita.' },
    { t: 'Piano compensi', q: 'Come si guadagna?', a: 'I guadagni vengono da: 1) Margine sulla vendita diretta (20-40%). 2) Provvigioni sulle vendite del team (5-15% su più livelli). 3) Bonus di produttività e leadership. I guadagni reali dipendono dall\'impegno: il 70% del fatturato dovrebbe venire da clienti esterni, non dal team. Chiedi sempre il documento di presentazione dei redditi medi.' },
  ],
  studio_creativo: [
    { t: 'Servizi architettura', q: 'Che servizi offre lo studio?', a: 'Offriamo: progettazione architettonica, interior design, ristrutturazioni, direzione lavori, pratiche edilizie (CILA, SCIA, permesso di costruire), rendering 3D, home staging. Per ristrutturazioni: dal rilievo al progetto esecutivo, computo metrico, assistenza cantiere. Primo sopralluogo e consulenza gratuiti.' },
    { t: 'Costi ristrutturazione', q: 'Quanto costa ristrutturare casa?', a: 'Costi indicativi al mq: ristrutturazione leggera (tinteggiatura, pavimenti) 300-500€/mq, media (bagno, cucina, impianti) 600-900€/mq, integrale (strutturale) 900-1.500€/mq. Bonus disponibili: 50% ristrutturazione, 65% efficientamento energetico, bonus mobili. Il nostro studio gestisce anche le pratiche per i bonus.' },
    { t: 'Servizio fotografico', q: 'Quanto costa un servizio fotografico?', a: 'Servizio fotografico: still life prodotti da 200€, ritratti/headshot da 150€, matrimonio 1.500-3.500€ (giornata intera), eventi aziendali da 500€, immobiliare da 150€ per immobile. Include: shooting, post-produzione, consegna digitale ad alta risoluzione. Video aggiuntivo disponibile.' },
  ],
  shop: [
    { t: 'Orari negozio', q: 'Quando siete aperti?', a: 'Gli orari variano per punto vendita. Generalmente: lunedì-sabato 9:30-13:00 e 15:30-19:30. Alcuni punti vendita hanno orario continuato. Domenica: apertura nei centri commerciali. Per orari esatti del tuo punto vendita, contattaci direttamente o consulta la nostra pagina.' },
    { t: 'Reso e cambio', q: 'Posso restituire un prodotto?', a: 'Sì, hai 14 giorni per il reso (acquisti online, diritto di recesso D.Lgs 206/2005) o 30 giorni per cambio/buono (acquisti in negozio, politica aziendale). Il prodotto deve essere integro, con etichette e scontrino. Difetti di conformità: garanzia legale 2 anni. Contattaci per avviare la procedura.' },
    { t: 'Disponibilità prodotto', q: 'Avete questo prodotto?', a: 'Dimmi quale prodotto cerchi e verifico subito la disponibilità nel punto vendita più vicino a te. Se non disponibile in negozio, possiamo ordinarlo (consegna 3-7 giorni lavorativi) o verificare in altri punti vendita. Per l\'e-commerce, spedizione in 24-48h con corriere tracciato.' },
    { t: 'Taglie e misure', q: 'Che taglie avete?', a: 'La disponibilità taglie varia per modello. Generalmente: XS-XXL per abbigliamento, 36-46 per scarpe. La nostra guida taglie online ti aiuta a trovare la misura giusta con le tue misure. In negozio, i nostri consulenti ti assistono nella scelta. Per taglie speciali, possiamo ordinare su richiesta.' },
  ],
  marketing: [
    { t: 'Strategia marketing', q: 'Come posso aumentare i clienti?', a: 'Una strategia efficace combina: 1) Presenza online (sito ottimizzato SEO, Google Business). 2) Social media (contenuti di valore, non solo promozioni). 3) Advertising mirato (Google Ads, Meta Ads). 4) Email marketing (automazioni, nurturing). 5) CRM per gestire i contatti. Partiamo da un\'analisi della tua situazione attuale.' },
    { t: 'Social media', q: 'Gestite i social media?', a: 'Sì, offriamo gestione completa: piano editoriale mensile, creazione contenuti (grafiche, video, copy), pubblicazione, community management, reportistica. Piattaforme: Instagram, Facebook, TikTok, LinkedIn. Pacchetti da 3 a 20 post/settimana. Campagne paid media gestite separatamente.' },
    { t: 'Google Ads', q: 'Come funziona la pubblicità su Google?', a: 'Google Ads ti posiziona in cima ai risultati di ricerca per le parole chiave del tuo business. Paghi solo per click (CPC). Budget minimo consigliato: 500-1.000€/mese + gestione. ROI tipico: 3-8x per servizi locali. Include: ricerca keyword, creazione annunci, landing page, monitoraggio conversioni, ottimizzazione continua.' },
  ],
  agenzia: [
    { t: 'Servizi agenzia', q: 'Che servizi offre l\'agenzia?', a: 'Offriamo: branding e identità visiva, social media management, campagne advertising (Google, Meta, TikTok), SEO, content marketing, email marketing, sviluppo siti web, video production, influencer marketing. Approccio data-driven con reportistica mensile e KPI condivisi.' },
    { t: 'Costi agenzia', q: 'Quanto costa un\'agenzia di comunicazione?', a: 'Dipende dallo scope: gestione social da 500€/mese, sito web da 2.000€, campagna integrata da 1.500€/mese, branding completo da 3.000€. Offriamo pacchetti scalabili per PMI e startup. Il primo incontro strategico è gratuito. Fee mensile trasparente, nessun costo nascosto.' },
  ],

  // ═══════════════════════════════════════════════════════════════
  // PRODUCTS
  // ═══════════════════════════════════════════════════════════════
  solo_sara: [
    { t: 'Cos\'è SOLO SARA', q: 'Cos\'è SOLO SARA?', a: 'SOLO SARA è l\'assistente WhatsApp AI per freelance e micro-imprese a €9.90/mese. Risponde ai tuoi clienti 24/7 su WhatsApp con risposte intelligenti basate sulle tue FAQ, raccoglie contatti, e gestisce le domande frequenti. Setup in 5 minuti, nessuna competenza tecnica richiesta.' },
    { t: 'Funzionalità SOLO SARA', q: 'Cosa può fare SOLO SARA?', a: 'SOLO SARA include: risposte automatiche 24/7 su WhatsApp, fino a 50 conversazioni/mese, 20 FAQ personalizzabili, 3 livelli di autonomia (risponde, suggerisce, o chiede conferma), multi-lingua (IT/EN/ES/PT), tono personalizzabile. Non include CRM o verticali di settore — per quelli serve il piano Growth.' },
    { t: 'Prezzo SOLO SARA', q: 'Quanto costa SOLO SARA?', a: 'SOLO SARA costa €9.90/mese. Add-on opzionale: Voice AI (risposta vocale) +€9.90/mese. Setup: base €500 (fai da te con guida), standard €1.000 (configurazione assistita), avanzato €2.000 (personalizzazione completa). Nessun vincolo, disdici quando vuoi.' },
    { t: 'Setup SOLO SARA', q: 'Come si configura SOLO SARA?', a: 'La configurazione è semplice: 1) Scegli il piano e paga. 2) Colleghi il tuo WhatsApp Business. 3) Inserisci le tue FAQ (domande e risposte tipiche dei tuoi clienti). 4) Personalizzi il tono e la lingua. 5) SARA inizia a rispondere. L\'onboarding guidato ti porta online in 5 minuti.' },
    { t: 'SOLO SARA vs Growth', q: 'Che differenza c\'è tra SOLO SARA e Growth?', a: 'SOLO SARA (€9.90/mese) è per freelance: 50 conversazioni, 20 FAQ, no CRM, no verticali. Growth (€97/mese) è per aziende: conversazioni illimitate, SARA AI completa con RAG, CRM integrato, 5 verticali a scelta, 5 moduli SCALA, 6 utenti team, 30.000 AI credits. Se hai un team o vuoi il CRM, ti serve Growth.' },
    { t: 'WhatsApp Business API', q: 'Serve WhatsApp Business API?', a: 'SOLO SARA funziona con WhatsApp Web (connessione QR code, gratuita). Per volumi alti o funzionalità avanzate (messaggi broadcast, template, pulsanti), puoi attivare WhatsApp Business API a €39/mese add-on. Per la maggior parte dei freelance, la versione base è sufficiente.' },
  ],
  score: [
    { t: 'Cos\'è Score', q: 'Cos\'è SCALA Score?', a: 'SCALA Score è la piattaforma di Business Intelligence con dati su 8.5+ milioni di aziende in 7 paesi (Italia, UK, Portogallo, USA, Spagna, Brasile, Svizzera). Ogni azienda ha: ragione sociale, settore, dimensione, fatturato stimato, dipendenti, contatti. Ideale per lead generation, analisi di mercato, e ricerca fornitori.' },
    { t: 'Dati disponibili Score', q: 'Che dati ha Score?', a: 'Per ogni azienda: nome, indirizzo, settore NACE/ATECO, fatturato stimato, numero dipendenti, anno di fondazione, forma giuridica, contatti (email, telefono, sito web dove disponibili). Dati aggiornati da fonti pubbliche ufficiali (registri imprese, camere di commercio). 5.58 milioni di pagine aziendali generate.' },
    { t: 'Prezzo Score', q: 'Quanto costa Score?', a: 'Score ha 3 piani: Starter €19/mese (100 ricerche/mese, dati base), Professional €49/mese (500 ricerche, dati completi + export CSV), Enterprise €149/mese (ricerche illimitate, API access, dati finanziari). Report PDF singoli: €0.99 (base), €2.49 (dettagliato), €4.99 (completo con analisi).' },
    { t: 'Paesi coperti Score', q: 'In quali paesi avete dati?', a: 'Score copre 7 paesi: Italia (1.66M aziende), UK (5.7M), Portogallo (444K), USA (336K), Spagna (179K), Brasile (191K), Svizzera (24K). Target: 50 milioni di record entro 2027. Dati da fonti pubbliche ufficiali, aggiornamenti continui.' },
    { t: 'API Score', q: 'Score ha un\'API?', a: 'Sì, il piano Enterprise (€149/mese) include accesso API REST. Endpoint: ricerca aziende per nome/settore/località, dettaglio singola azienda, export bulk. Documentazione completa, rate limit 1000 req/giorno. Per integrazioni custom o volumi superiori, contattaci per un piano dedicato.' },
  ],
  enterprise: [
    { t: 'SCALA Enterprise', q: 'Cos\'è SCALA Enterprise?', a: 'SCALA Enterprise è il Sistema Operativo AI per grandi aziende: gestione multi-sede, dashboard verticali personalizzate, SARA AI con RAG dedicato, CRM avanzato, automazioni workflow, analytics predittive. Confrontaci con SAP, Salesforce, ServiceNow — funzionalità equivalenti a una frazione del costo.' },
    { t: 'Prezzo Enterprise', q: 'Quanto costa SCALA Enterprise?', a: 'Tier 1 (facility management, hospitality, multi-sede): €5.000-7.000/mese + €15-25K setup. Tier 2 (singolo verticale, <50 utenti): €2.000-4.000/mese + €5-10K setup. Include: customizzazione completa, onboarding dedicato, account manager, SLA 99.9%, formazione team. TCO 70% inferiore ai competitor.' },
    { t: 'Setup Enterprise', q: 'Come funziona il setup Enterprise?', a: 'Il processo: 1) Discovery e analisi processi (1-2 settimane). 2) Configurazione piattaforma e verticali (2-4 settimane). 3) Integrazione sistemi esistenti (ERP, CRM, ecc.). 4) Training team e change management. 5) Go-live con supporto dedicato. 6) Ottimizzazione continua. Pilot gratuito 30 giorni disponibile per aziende qualificate.' },
    { t: 'Sicurezza Enterprise', q: 'Come gestite la sicurezza dei dati?', a: 'Infrastruttura EU (GDPR compliant), crittografia end-to-end, backup giornalieri, disaster recovery. Percorso ISO 27001 in corso. Dati separati per tenant (multi-tenancy sicura). DPA (Data Processing Agreement) incluso. Audit log completo. Possibilità di deployment on-premise per requisiti specifici.' },
    { t: 'Integrazione Enterprise', q: 'Si integra con i nostri sistemi?', a: 'SCALA si integra con: ERP (SAP, Dynamics 365, Odoo), CRM (Salesforce, HubSpot), email (Gmail, Outlook), calendar, WhatsApp Business API, strumenti BI. API REST documentata per integrazioni custom. Connettori pre-built per i sistemi più comuni. Il team tecnico supporta le integrazioni durante il setup.' },
    { t: 'ROI Enterprise', q: 'Qual è il ROI di SCALA?', a: 'I clienti Enterprise vedono: riduzione 40-60% dei tempi di gestione operativa, +25% di customer satisfaction (SARA risponde 24/7), -30% costi IT rispetto a soluzioni frammentate. Il payback period è tipicamente 3-6 mesi. Con competitor equivalenti (SAP, Salesforce) il costo sarebbe €15-28K/mese — SCALA parte da €2.000/mese.' },
  ],
  scala_user: [
    { t: 'Piano Free', q: 'Cosa include il piano Free?', a: 'Il piano Free (€0/sempre) include: tutti i moduli Core in anteprima, 15 verticali in anteprima, 1 utente, 500 AI credits/mese. È perfetto per esplorare SCALA e capire se fa per te. Nessuna carta richiesta, accesso immediato su app.get-scala.com.' },
    { t: 'Piano Growth', q: 'Cosa include il piano Growth?', a: 'Growth (€97/mese): SARA AI WhatsApp 24/7 multi-lingua (IT/EN/ES/PT), tutti e 5 i moduli SCALA (BMC, SWOT, CRM, Pipeline, AI Advisor), fino a 5 verticali a scelta, 30.000 AI credits/mese, fino a 6 utenti team. Trial 30 giorni gratis. Ideale per PMI che vogliono automatizzare.' },
    { t: 'Piano Scale', q: 'Cosa include il piano Scale?', a: 'Scale (€197/mese): tutto di Growth + TUTTI i 15 verticali, Content Repurposer, Workflow Builder, 100.000 AI credits/mese, utenti illimitati, account manager dedicato. Per aziende che vogliono scalare con l\'AI. Trial 30 giorni gratis.' },
    { t: 'Come funziona SARA', q: 'Come funziona SARA su WhatsApp?', a: 'SARA è il tuo assistente AI su WhatsApp: risponde ai clienti 24/7, qualifica i lead, prenota appuntamenti, risponde alle FAQ con informazioni accurate dalla tua knowledge base. Parla italiano, inglese, spagnolo e portoghese. Si adatta al tono del tuo brand. Raccoglie i dati dei contatti nel CRM integrato.' },
    { t: 'Moduli SCALA', q: 'Quali sono i moduli di SCALA?', a: 'I 5 moduli Core: 1) Strategy (BMC, SWOT, Porter, OKR, North Star). 2) CRM & Pipeline (gestione contatti, lead scoring, pipeline vendita). 3) AI Advisor (consulente AI per decisioni business). 4) Content Studio (generazione contenuti, Brand Voice). 5) Analytics (dashboard, KPI, report). Ogni verticale aggiunge funzionalità specifiche per il settore.' },
    { t: 'Verticali SCALA', q: 'Quanti verticali avete?', a: 'SCALA ha 15 verticali: PraxisOS (studi professionali), AgencyOS (agenzie), DineOS (ristorazione), DermalyOS (dermatologia/estetica), PropertyOS (immobiliare), MotorOS (automotive), TravelOS (turismo), BeautyOS (saloni), CleanOS (pulizie), WasteOS (rifiuti), FitOS (fitness), ServiceOS (assistenza tecnica), ShopOS (retail), NetworkOS (network marketing), StudioOS (studi creativi/architettura).' },
    { t: 'Come contattare', q: 'Come vi contatto?', a: 'Puoi contattarci via: email info@get-scala.com, WhatsApp (scrivi qui!), sito web get-scala.com. Per demo personalizzata, prenota direttamente. Rispondiamo entro 24h lavorative. Per clienti Enterprise: account manager dedicato con linea diretta.' },
    { t: 'SCALA acronimo', q: 'Cosa significa SCALA?', a: 'S.C.A.L.A. è un acronimo: S = Strategy (strategia), C = Confirmation (conferma dati), A = Activation (attivazione processi), L = Leverage (leva competitiva), A = Acceleration (accelerazione crescita). È il Sistema Operativo AI per aziende — non un semplice tool, ma una piattaforma completa.' },
  ],
};

async function loadAll() {
  let totalLoaded = 0;
  let totalFailed = 0;

  for (const [sector, items] of Object.entries(KB)) {
    // Check existing count
    const existing = await pool.query('SELECT COUNT(*) FROM wa_rag_documents WHERE sector = $1', [sector]);
    const existingCount = parseInt(existing.rows[0].count);

    // Skip waste (already loaded Econord) and keep existing sara-kb
    if (sector === 'waste') {
      console.log(`  ${sector}: SKIP (Econord already loaded: ${existingCount} docs)`);
      continue;
    }

    // Don't delete sara-kb, immobiliare, pulizie — add alongside
    // But DO replace if we're providing new content for the sector
    if (existingCount > 0 && sector !== 'sara-kb') {
      await pool.query('DELETE FROM wa_rag_documents WHERE sector = $1', [sector]);
      console.log(`  ${sector}: cleared ${existingCount} old docs`);
    }

    let loaded = 0;
    for (const item of items) {
      try {
        const title = item.t;
        const content = `D: ${item.q}\nR: ${item.a}`;
        const { vector } = await embedChain(content);
        await pool.query(
          'INSERT INTO wa_rag_documents (sector, title, content, embedding) VALUES ($1, $2, $3, $4)',
          [sector, title, content, JSON.stringify(vector)]
        );
        loaded++;
      } catch (e) {
        totalFailed++;
        console.log(`  FAIL ${sector}/${item.t}: ${e.message}`);
      }
    }
    totalLoaded += loaded;
    console.log(`  ${sector}: ${loaded}/${items.length} loaded ✓`);
  }

  // Final count
  const final = await pool.query('SELECT sector, COUNT(*) as cnt FROM wa_rag_documents GROUP BY sector ORDER BY cnt DESC');
  console.log('\n═══ FINAL RAG STATE ═══');
  let total = 0;
  for (const row of final.rows) {
    console.log(`  ${row.sector}: ${row.cnt}`);
    total += parseInt(row.cnt);
  }
  console.log(`  TOTAL: ${total} documents`);
  console.log(`\nLoaded: ${totalLoaded}, Failed: ${totalFailed}`);

  pool.end();
}

loadAll();
