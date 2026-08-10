#!/usr/bin/env node
// ═══════════════════════════════════════════════════
// SARA RAG Knowledge Base Loader
// ═══════════════════════════════════════════════════
// Loads SCALA documentation, vertical specs, pricing,
// and sector research into wa_rag_documents with embeddings.
// Run: node populate_rag.mjs
// ═══════════════════════════════════════════════════
import pg from 'pg';
import 'dotenv/config';

const { Pool } = pg;
if (!process.env.DATABASE_URL) { throw new Error('DATABASE_URL env var required'); }
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const API_KEY = process.env.GEMINI_API_KEY;

// ─── Embedding helper with retry ───
async function embed(text, retries = 3) {
    for (let attempt = 0; attempt < retries; attempt++) {
        try {
            const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${API_KEY}`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ model: 'models/gemini-embedding-001', content: { parts: [{ text }] } }),
            });
            const data = await res.json();
            if (data.embedding?.values) return data.embedding.values;
            console.error(`    Embed attempt ${attempt+1} error:`, JSON.stringify(data.error || data).substring(0, 200));
            if (attempt < retries - 1) await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
        } catch (err) {
            console.error(`    Embed attempt ${attempt+1} network error:`, err.message);
            if (attempt < retries - 1) await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
        }
    }
    return null;
}

async function insertDoc(sector, title, content) {
    const embedding = await embed(content.substring(0, 2000));
    if (!embedding) { throw new Error(`Failed to embed after 3 retries`); }
    await pool.query(
        'INSERT INTO wa_rag_documents (sector, title, content, embedding) VALUES ($1, $2, $3, $4::vector)',
        [sector, title, content, `[${embedding.join(',')}]`]
    );
    console.log(`  ✅ ${sector} | ${title} (${content.length} chars)`);
    await new Promise(r => setTimeout(r, 500)); // Rate limit
}

// ═══════════════════════════════════════════════════
// KNOWLEDGE BASE DOCUMENTS
// ═══════════════════════════════════════════════════

const DOCS = [
    // ─── SCALA OVERVIEW ───
    { sector: 'general', title: 'Cos\'è SCALA AI OS', content: `S.C.A.L.A. è un AI Operating System per PMI italiane. L'acronimo sta per: Strategia, Conferma, Attivazione, Leva, Accelerazione. È una piattaforma all-in-one che guida imprenditori attraverso 5 fasi di crescita aziendale, dalla strategia iniziale all'espansione internazionale. SCALA integra intelligenza artificiale in ogni modulo per automatizzare analisi, generare insight e ottimizzare i processi. La piattaforma è disponibile in italiano, inglese e spagnolo (IT/EN/ES). SCALA è progettata per PMI con 1-100 dipendenti che vogliono digitalizzare i propri processi e scalare il business con l'AI.` },

    { sector: 'general', title: 'I 5 Moduli SCALA', content: `SCALA è composta da 5 moduli core:
1. STRATEGIA (S): Include Business Model Canvas interattivo, Analisi di Pareto, SWOT Analysis. Aiuta a definire la direzione strategica dell'azienda.
2. CONFERMA (C): Il Pilot Center permette di validare idee in 90 giorni. Include test A/B, metriche di validazione, KPI di conferma.
3. ATTIVAZIONE (A): Team Alignment con OKR (Objectives & Key Results), Weekly Check-in, Cascading Goals, Burndown OKR.
4. LEVA (L): Process Analyzer per mappare processi, Gantt interattivo, Quiz generatore DOCX, automazioni con drag-and-drop, AI Readiness Score.
5. ACCELERAZIONE (A): Growth Planning, Expansion Timeline, Competitive Radar, CRM Pipeline avanzato con lead scoring, automazioni marketing.` },

    // ─── PRICING ───
    { sector: 'general', title: 'Prezzi e Piani SCALA AI OS', content: `SCALA offre 4 piani:
• FREE (€0): Dashboard base, 1 Pilot, accesso limitato. Perfetto per esplorare la piattaforma.
• BASE (€490/anno): Tutti i moduli SCALA, supporto email, fino a 3 utenti team. Ideale per freelancer e micro-imprese.
• PRO (€890/anno): Include AI Advisor intelligente, Templates professionali, Features PRO avanzate, fino a 10 utenti team. Il piano più popolare.
• ENTERPRISE (prezzo custom): Balance Sheet avanzato, API access, 25+ utenti, supporto dedicato, onboarding personalizzato.

Add-On disponibili:
• Process Analyzer: €99/anno - Mappatura processi + AI Readiness Score
• Balance Sheet: €99/anno - Analisi bilancio + Break-even + Cash Flow
• Extra Seats: €49/utente/anno - Utenti aggiuntivi per il team

Tutti i piani hanno periodo di prova gratuito e garanzia soddisfatti o rimborsati.` },

    { sector: 'general', title: 'Extra User Pricing', content: `Pricing utenti aggiuntivi SCALA (tiered):
1 utente extra: €9/mese
2 utenti extra: €14/mese (-22%)
3 utenti extra: €18/mese (-33%)
4 utenti extra: €20/mese (-44%)
Il pricing è progressivamente scontato per incentivare l'adozione team-wide.` },

    // ─── AI ADVISOR ───
    { sector: 'general', title: 'AI Advisor - Come funziona', content: `L'AI Advisor di SCALA è un consulente AI integrato in ogni modulo. Utilizza Gemini 2.5 Pro con un sistema RAG a 3 livelli:
1. IndexedDB (cache locale per risposte instant)
2. Supabase (knowledge base centralizzata)
3. Gemini API (generazione risposte complesse)
L'AI Advisor analizza i dati inseriti dall'utente e fornisce suggerimenti contestuali: consigli strategici, ottimizzazioni di processo, benchmark di settore. Funziona con responseSchema strutturato per risposte sempre formatted e actionable. Disponibile nei piani PRO ed Enterprise.` },

    // ─── VERTICALS ───
    // PraxisOS
    { sector: 'legale', title: 'PraxisOS - Piattaforma per Studi Legali e Commercialisti', content: `PraxisOS è il verticale SCALA dedicato a studi legali e commercialisti. Include tutti i moduli SCALA personalizzati per il settore professionale:
• Gestione Pratiche: Tracking cause/pratiche con timeline, scadenze, documenti allegati
• Scadenzario Fiscale: Calendario con reminder automatici per adempimenti
• CRM Clienti: Anagrafica clienti con storico pratiche, fatturazione, solleciti
• Document Management: Archiviazione documenti con OCR e ricerca full-text
• Fatturazione Elettronica: Integrazione SDI, generazione XML, conservazione sostitutiva
• AI Legal Assistant: Ricerca normativa, analisi contrattuale, suggerimenti procedurali
• Dashboard KPI: Parcellato medio, pratiche attive, aging crediti, cash flow
Pricing: Stessi piani SCALA (BASE €490/anno, PRO €890/anno).
URL: https://app.scalaai.it/praxisos` },

    { sector: 'commercialista', title: 'PraxisOS per Commercialisti', content: `PraxisOS per commercialisti include funzionalità specifiche:
• Scadenzario fiscale automatizzato (IVA, F24, Dichiarazioni, INPS)
• Gestione clienti con partita IVA, regime fiscale, codice ATECO
• Fatturazione elettronica con integrazione SDI
• Analisi bilancio con break-even automatico
• Cash flow management e proiezioni
• Gestione cedolini e buste paga
• AI Tax Advisor per consulenza fiscale automatizzata
• Template contratti e lettere professionali
Lo studio medio risparmia 15-20 ore/settimana con PraxisOS.
URL: https://app.scalaai.it/praxisos` },

    // AgencyOS
    { sector: 'agenzia', title: 'AgencyOS - Piattaforma per Agenzie Creative', content: `AgencyOS è il verticale SCALA per agenzie di comunicazione e marketing. Moduli specifici:
• Project Management: Board Kanban, Gantt, tracking ore per progetto/cliente
• Content Calendar: Piano editoriale multi-piattaforma con approvazione workflow
• Social Dashboard: Analytics aggregati da Instagram, Facebook, LinkedIn, TikTok
• Client Portal: Area riservata per approvazione contenuti e report
• Creative Brief Generator: AI genera brief strutturati da input minimal
• Performance Tracker: KPI campagne (ROAS, CPA, CTR, Conversion Rate)
• Resource Planning: Allocazione team, capacità, workload balancing
• Invoice & Budget: Tracking budget per progetto, time tracking, fatturazione
AgencyOS aiuta le agenzie a gestire 3x più clienti con lo stesso team.
URL: https://app.scalaai.it/agencyos` },

    { sector: 'marketing', title: 'AgencyOS per Marketing - Funzionalità', content: `AgencyOS offre strumenti specifici per professionisti del marketing:
• Funnel Builder: Visualizzazione e ottimizzazione funnel di conversione
• A/B Testing Dashboard: Gestione esperimenti con significatività statistica
• Lead Scoring: Punteggio automatico basato su comportamento e profilo
• Email Automation: Sequenze email personalizzate con trigger comportamentali
• Analytics Hub: Dashboard centralizzata con KPI (CAC, LTV, Churn, ROAS)
• Competitor Analysis: Monitoraggio competitor con AI insights
• Campaign Manager: Gestione campagne multi-canale con budget allocation
ROI medio dei clienti AgencyOS: +40% efficienza operativa nel primo trimestre.
URL: https://app.scalaai.it/agencyos` },

    // DineOS
    { sector: 'ristorante', title: 'DineOS - Piattaforma per la Ristorazione', content: `DineOS è il verticale SCALA per ristoranti, pizzerie, bar e locali. Include:
• Menu Engineering: Analisi profittabilità piatti, food cost calculator, menu optimization AI
• Prenotazioni: Sistema booking integrato con conferma WhatsApp/SMS
• Inventory Management: Gestione magazzino, ordini fornitori, soglie riordino automatiche
• Staff Scheduling: Turni, presenze, costo del lavoro per copertura
• Customer CRM: Anagrafica clienti, preferenze, allergie, storico ordini
• Delivery Integration: Connessione con Glovo, Deliveroo, JustEat, UberEats
• Financial Dashboard: Scontrino medio, coperti, marginalità per fascia oraria
• HACCP Digital: Registro temperature, checklist igiene, scadenze
• AI Menu Advisor: Suggerimenti per ottimizzare il menu basandosi su food cost e popolarità
I ristoranti che usano DineOS vedono in media un +25% di marginalità nel primo anno.
URL: https://app.scalaai.it/dineos` },

    // DermalyOS
    { sector: 'dermatologia', title: 'DermalyOS - Piattaforma per Dermatologia e Medicina Estetica', content: `DermalyOS è il verticale SCALA per studi dermatologici e cliniche di medicina estetica:
• Agenda Pazienti: Scheduling appuntamenti con reminder automatici
• Cartella Clinica Digitale: Storico trattamenti, foto before/after, consensi informatici
• Protocolli Trattamento: Template personalizzabili per filler, botox, laser, peeling
• Compliance Sanitaria: Gestione consensi, GDPR, documentazione sanitaria
• CRM Pazienti: Follow-up automatizzati, recall visite, birthday marketing
• Revenue Dashboard: Fatturato per trattamento, marginalità, trend stagionali
• Magazzino Prodotti: Gestione cosmetici, device, materiali consumabili
• Telemedicina: Videoconsulti per follow-up e consulenze preliminari
Gli studi dermatologici con DermalyOS riducono i no-show del 35% con i reminder automatici.
URL: https://app.scalaai.it/dermalyos` },

    // PropertyOS
    { sector: 'immobiliare', title: 'PropertyOS - Piattaforma per Agenzie Immobiliari', content: `PropertyOS è il verticale SCALA per agenzie immobiliari:
• Gestione Portfolio: Catalogo immobili con foto, planimetrie, virtual tour, APE
• CRM Acquirenti: Matching automatico immobile-cliente basato su preferenze
• Lead Management: Cattura lead da portali (Immobiliare.it, Idealista, Subito)
• Valutazioni: Stima automatizzata basata su comparabili e dati catastali
• Calendar Visite: Scheduling visite con feedback post-visita automatizzato
• Document Center: Preliminari, compromessi, checklist rogito, visure
• Marketing Toolkit: Generazione automatica annunci per portali e social
• Financial Tracking: Provvigioni, mandati, previsioni fatturato, pipeline deals
• Home Staging AI: Suggerimenti per valorizzare gli immobili in vendita
PropertyOS aumenta il tasso di chiusura vendite del 30% grazie al matching AI.
URL: https://app.scalaai.it/propertyos` },

    // MotorOS
    { sector: 'automotive', title: 'MotorOS - Piattaforma per Concessionarie e Officine', content: `MotorOS è il verticale SCALA per il settore automotive:
• Gestione Veicoli: Catalogo auto nuove/usate/km0, foto, specifiche, valutazioni
• CRM Clienti: Storico acquisti, manutenzioni, scadenze revisioni/bolli
• Officina Management: Scheduling interventi, ordini ricambi, preventivi automatici
• Test Drive Booking: Prenotazione prove su strada con follow-up automatico
• Finanziamenti: Simulatore rate, integrazione leasing e noleggio lungo termine
• Marketing Automation: Campagne per scadenze revisione, cambio gomme, promozioni
• Dashboard KPI: Vendite giornaliere, margine per veicolo, aging stock, tempi di giacenza
• After Sales: Gestione garanzie, estensioni, recall, customer satisfaction
Le concessionarie con MotorOS riducono i tempi medi di vendita del 25%.
URL: https://app.scalaai.it/motoros` },

    // TravelOS
    { sector: 'turismo', title: 'TravelOS - Piattaforma per Hotel e Turismo', content: `TravelOS è il verticale SCALA per hotel, B&B, resort e operatori turistici:
• Property Management: Gestione camere, tariffe, disponibilità, overbooking protection
• Channel Manager: Sincronizzazione con Booking.com, Airbnb, Expedia in tempo reale
• Revenue Management: Dynamic pricing basato su occupancy, stagionalità, eventi
• Guest CRM: Profilo ospiti con preferenze, allergie, occasioni speciali
• Housekeeping: Gestione pulizie, manutenzioni, inventory amenities
• F&B Management: Gestione ristorante/bar interno, colazioni, room service
• Review Manager: Monitoraggio e risposta recensioni multi-piattaforma con AI
• Event Management: Booking sale meeting, wedding planning, MICE
• Analytics: RevPAR, ADR, Occupancy Rate, GOP, dashboard in tempo reale
Gli hotel con TravelOS vedono un +15% di RevPAR nel primo anno.
URL: https://app.scalaai.it/travelos` },

    // ─── SECTOR RESEARCH DATA ───
    { sector: 'legale', title: 'Ricerca di Settore - Studi Legali Italiani 2025', content: `Il mercato legale italiano conta circa 240.000 avvocati iscritti all'albo. Trend chiave:
• Il 67% degli studi sotto 5 avvocati non usa software gestionali specifici
• Il fatturato medio per avvocato è circa €68.000/anno (in calo del 5% negli ultimi 5 anni)
• I tempi di incasso medi superano i 120 giorni
• Solo il 12% degli studi usa strumenti AI per ricerca normativa
• Le aree di crescita sono: diritto digitale, privacy/GDPR, diritto dell'AI
• Il 45% degli studi vorrebbe digitalizzare ma non sa da dove iniziare
• La fatturazione elettronica ha spinto il 30% degli studi verso il digitale
Opportunità: PraxisOS può aiutare gli studi a ridurre i tempi di ricerca del 40% e migliorare i tempi di incasso del 25%.` },

    { sector: 'commercialista', title: 'Ricerca di Settore - Commercialisti Italiani 2025', content: `In Italia operano circa 120.000 commercialisti. Dati chiave:
• Il 78% del tempo è impiegato in adempimenti fiscali ripetitivi
• Solo il 15% usa automazioni per fatturazione e scadenzario
• Il fatturato medio per studio è €180.000-250.000/anno
• I picchi di lavoro (dichiarazioni, bilanci) causano stress e errori
• Il 55% degli studi vorrebbe delegare compiti ripetitivi all'AI
• La digitalizzazione della PA sta accelerando la domanda di tool digitali
• L'e-fattura ha creato un terreno fertile per l'automazione completa
PraxisOS può ridurre del 60% il tempo per adempimenti ripetitivi, liberando ore per consulenza ad alto valore.` },

    { sector: 'agenzia', title: 'Ricerca di Settore - Agenzie Marketing Italia 2025', content: `Il mercato delle agenzie di comunicazione italiane:
• Oltre 15.000 agenzie attive, il 70% con meno di 10 dipendenti
• Fatturato medio per agenzia: €250.000-500.000/anno
• Il 60% del tempo è speso in attività operative vs creative
• Il content marketing rappresenta il 35% dei ricavi medi
• I clienti chiedono sempre più ROI misurabile
• Il 40% delle agenzie fatica a scalare oltre 15 clienti
• L'AI generativa sta rivoluzionando produzione contenuti (-50% tempi)
• Social media management è la principale area di crescita (+22% annuo)
AgencyOS permette alle agenzie di gestire il 3x dei clienti con lo stesso team.` },

    { sector: 'ristorante', title: 'Ricerca di Settore - Ristorazione Italia 2025', content: `La ristorazione italiana in numeri:
• 350.000+ ristoranti, bar e locali attivi
• Il food cost medio è del 28-35% del fatturato
• Il 40% delle chiusure avviene nei primi 3 anni
• Solo il 20% usa software di gestione specifico
• Il delivery rappresenta il 15-25% dei ricavi (in crescita del 18% annuo)
• Il costo del lavoro è la voce più critica (30-38% del fatturato)
• Lo scontrino medio è in crescita (+8% vs 2023) ma anche i costi
• Le recensioni online influenzano il 72% delle scelte dei clienti
• Il 53% dei ristoratori vorrebbe ottimizzare il food cost ma non ha strumenti
DineOS aiuta a ridurre il food cost del 15% e aumentare la marginalità del 25%.` },

    { sector: 'dermatologia', title: 'Ricerca di Settore - Dermatologia e Medicina Estetica 2025', content: `Il mercato della dermatologia e medicina estetica in Italia:
• Oltre 15.000 dermatologi e 8.000 medici estetici
• Il mercato della medicina estetica vale €2.3 miliardi e cresce del 12% annuo
• I trattamenti più richiesti: filler (+15%), botox (+10%), laser (+8%)
• Il no-show medio è del 15-20% e costa migliaia di euro annui
• Solo il 25% degli studi usa un gestionale specifico per il settore
• La telemedicina dermatologica è cresciuta del 200% post-covid
• Il follow-up post-trattamento è critico ma spesso trascurato
• I pazienti ricercano online prima di prenotare nel 85% dei casi
DermalyOS riduce i no-show del 35% e migliora il lifetime value paziente del 40%.` },

    { sector: 'immobiliare', title: 'Ricerca di Settore - Immobiliare Italia 2025', content: `Il mercato immobiliare italiano:
• 45.000+ agenzie immobiliari, il 60% con meno di 5 agenti
• Transazioni residenziali: 710.000/anno (in ripresa del 5%)
• Provvigione media: 3-4% del valore dell'immobile
• Il tempo medio di vendita è 5-7 mesi
• Solo il 30% delle agenzie usa un CRM dedicato
• I portali online generano il 70% dei lead ma il 60% è di bassa qualità
• L'home staging aumenta il prezzo di vendita del 5-15%
• Il virtual tour riduce le visite inutili del 40%
PropertyOS aiuta le agenzie a chiudere il 30% in più di vendite grazie al matching AI acquirente-immobile.` },

    { sector: 'automotive', title: 'Ricerca di Settore - Automotive Italia 2025', content: `Il settore automotive italiano:
• 1.600+ concessionarie e 85.000+ officine indipendenti
• Il margine medio per veicolo nuovo è del 2-4%, per l'usato 8-15%
• L'after-sales (officina, ricambi, garanzie) genera il 60% dei profitti
• Il 45% dei clienti inizia la ricerca online ma conclude in concessionaria
• L'elettrico è in crescita ma copre solo il 5% delle vendite
• Il tempo medio di giacenza stock è di 45-90 giorni
• Solo il 20% delle concessionarie ha un CRM strutturato
• Il follow-up post-vendita è critico per customer retention e referral
MotorOS riduce i tempi di giacenza del 25% e aumenta il cross-selling after-sales del 35%.` },

    { sector: 'turismo', title: 'Ricerca di Settore - Turismo Italia 2025', content: `Il settore turistico italiano:
• 33.000+ hotel, 25.000+ B&B, 10.000+ agriturismi
• L'Italia è il 5° paese più visitato al mondo (65M+ arrivi/anno)
• L'occupancy media è del 55-65% (margine di miglioramento enorme)
• Il RevPAR medio è €75-120 in città d'arte, €40-60 in provincia
• Le OTA (Booking, Airbnb) rappresentano il 55% delle prenotazioni ma costano il 15-25% di commissione
• La disintermediazione (prenotazioni dirette) è la priorità #1
• Il 40% degli hotel non ha un revenue management attivo
• Le recensioni negative costano in media €1.500-3.000/anno in mancati ricavi
TravelOS aumenta le prenotazioni dirette del 25% e il RevPAR del 15%.` },

    // ─── FAQ GENERALI ───
    { sector: 'general', title: 'FAQ - Domande Frequenti su SCALA', content: `Domande frequenti su SCALA AI OS:

Q: Quanto tempo serve per iniziare a usare SCALA?
A: La registrazione richiede 2 minuti. L'onboarding guidato ti porta operativo in meno di 30 minuti.

Q: Posso provare SCALA gratuitamente?
A: Sì! Il piano FREE è gratuito per sempre. Puoi anche provare i piani BASE e PRO con un periodo di prova gratuito.

Q: I miei dati sono al sicuro?
A: Assolutamente. Usiamo Supabase con crittografia end-to-end, Row Level Security, e siamo compliant GDPR. I server sono in Europa (Frankfurt, DE).

Q: SCALA funziona su mobile?
A: Sì, SCALA è responsive e funziona perfettamente su smartphone e tablet. Stiamo lavorando anche a un'app nativa.

Q: Posso importare dati da altri software?
A: Sì, supportiamo import CSV/Excel per la maggior parte dei moduli. L'Enterprise plan include anche API per integrazioni custom.

Q: L'AI Advisor è incluso nel piano FREE?
A: No, l'AI Advisor è disponibile nei piani PRO ed Enterprise. Il piano FREE include funzionalità AI base.

Q: Quanto costa aggiungere utenti al mio team?
A: €49/utente/anno con il pacchetto standard. Per team grandi, il pricing è progressivamente scontato.

Q: SCALA è disponibile in altre lingue?
A: Sì! SCALA è disponibile in italiano, inglese e spagnolo. Altre lingue sono in arrivo.

Q: Cosa differenzia SCALA dai competitor?
A: SCALA è l'unico OS che copre le 5 fasi complete della crescita aziendale con AI integrata. Non è solo un CRM o un project manager: è un sistema operativo completo per il tuo business.` },

    // ─── CENTRO ASSISTENZA ───
    { sector: 'general', title: 'Centro Assistenza - Come contattarci', content: `Supporto SCALA AI:
• Email: supporto@scalaai.it
• WhatsApp: Parla con S.A.R.A., la nostra assistente AI (attiva 24/7)
• Knowledge Base: Disponibile nell'app sotto "Centro Assistenza"
• Onboarding personalizzato: Incluso nei piani PRO ed Enterprise
• Community: Gruppo LinkedIn per utenti SCALA

Tempi di risposta:
• FREE: Entro 48 ore lavorative
• BASE: Entro 24 ore lavorative
• PRO: Entro 8 ore lavorative
• Enterprise: Dedicato, entro 2 ore

Risorse formative:
• Video tutorial per ogni modulo
• Webinar mensili di approfondimento
• Guide PDF scaricabili
• Template professionali pronti all'uso` },
];

// ═══════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════
async function main() {
    console.log('═══════════════════════════════════════════════════');
    console.log('  SARA RAG Knowledge Base Loader');
    console.log(`  Loading ${DOCS.length} documents...`);
    console.log('═══════════════════════════════════════════════════\n');

    // Clear existing docs (fresh load)
    await pool.query('DELETE FROM wa_rag_documents');
    console.log('  🗑️  Cleared existing RAG documents\n');

    let loaded = 0, failed = 0;
    for (const doc of DOCS) {
        try {
            await insertDoc(doc.sector, doc.title, doc.content);
            loaded++;
        } catch (err) {
            console.error(`  ❌ ${doc.title}: ${err.message}`);
            failed++;
        }
    }

    console.log(`\n═══════════════════════════════════════════════════`);
    console.log(`  ✅ Loaded: ${loaded}  ❌ Failed: ${failed}`);
    console.log(`═══════════════════════════════════════════════════`);

    await pool.end();
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
