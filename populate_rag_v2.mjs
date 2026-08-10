#!/usr/bin/env node
// ═══════════════════════════════════════════════════
// SARA RAG Knowledge Base Loader — v2 ENRICHED
// ═══════════════════════════════════════════════════
// 55+ documents, 1500-3000 chars each (vs v1: 24 docs, 500-900 chars)
// Run: node populate_rag_v2.mjs
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
// KNOWLEDGE BASE DOCUMENTS — V2 ENRICHED
// ═══════════════════════════════════════════════════

const DOCS = [

    // ═══════════════════════════════════════════════════
    // SEZIONE 1: SCALA CORE (general) — 12 documenti
    // ═══════════════════════════════════════════════════

    { sector: 'general', title: "Cos'è SCALA AI OS — Overview Completa", content: `S.C.A.L.A. è un AI Operating System per PMI italiane. L'acronimo sta per: Strategia, Conferma, Attivazione, Leva, Accelerazione. È una piattaforma all-in-one che guida imprenditori attraverso 5 fasi di crescita aziendale.

SCALA integra intelligenza artificiale Gemini in ogni modulo: analisi automatica del Canvas, SWOT, Pareto, bilanci, processi. L'AI Advisor propone azioni concrete basate sui tuoi dati reali.

Ogni verticale (PraxisOS, AgencyOS, DineOS, DermalyOS, PropertyOS, MotorOS, TravelOS) condivide la stessa architettura SCALA ma con AI settoriale dedicata: 5-7 prompt specializzati per settore.

Tecnologia: React + TypeScript frontend, Fastify + PostgreSQL + pgvector backend. Disponibile in italiano, inglese e spagnolo. Responsive su mobile. Integrazione S.A.R.A. WhatsApp AI assistant inclusa.

Target: PMI con 1-200 dipendenti che vogliono digitalizzare i processi e crescere con l'AI. Nessun competitor italiano offre un OS completo con AI settoriale a questo prezzo.` },

    { sector: 'general', title: 'I 5 Moduli SCALA — Dettaglio Funzionalità', content: `SCALA è composta da 5 moduli core che coprono l'intero ciclo di vita aziendale:

1. STRATEGIA (S): Business Model Canvas interattivo (9 blocchi drag-and-drop), Analisi SWOT (con suggerimenti AI), Analisi di Pareto (80/20 clienti/fatturato), Matrice Ansoff (strategie di crescita), Impact-Effort Matrix. L'AI Advisor analizza tutti i dati insieme e propone azioni concrete.

2. CONFERMA (C): Pilot Center per validare idee in 30/60/90 giorni. Definisci ipotesi, KPI, budget, owner. Risultato binario: Validato o Invalidato. I pilot validati diventano processi operativi. Dashboard con countdown automatico.

3. ATTIVAZIONE (A): Team Alignment con OKR (Objectives & Key Results). OKR Cascading dal CEO al team. Weekly Check-in con progress tracking. OKR Burndown chart. Calendario Expansion con tutti i pilot e OKR integrati.

4. LEVA (L): Process Analyzer per mappare macro processi → procedure → SOP. Voice to SOP: parli e l'AI crea la procedura in 30 secondi. Training Mode con timer e step tracking. Esportazione PDF/DOCX. Gantt interattivo con critical path. AI Readiness Score.

5. ACCELERAZIONE (A): CRM Pipeline drag-and-drop (Lead→Contatto→Proposta→Negoziazione→Chiuso). Lead Scoring AI automatico. Email Automations multilingue. A/B Testing vendite. Competitive Radar. Growth Planning con timeline.` },

    { sector: 'general', title: 'Prezzi e Piani SCALA AI OS — Dettaglio Completo', content: `SCALA offre 4 piani con pricing annuale:

• FREE (€0/anno): Dashboard base, Business Model Canvas (sola lettura), 1 Pilot demo, accesso limitato ai moduli. Perfetto per esplorare la piattaforma senza impegno.

• BASE (€490/anno = ~€41/mese): Tutti i 5 moduli SCALA completi, fino a 3 utenti team, supporto email entro 24h, esportazione PDF/DOCX, CRM base con pipeline.

• PRO (€890/anno = ~€74/mese): Il più popolare. Include tutto il BASE più: AI Advisor intelligente con Gemini, Templates professionali avanzati, Features PRO (Scenario Simulator, Forecasting, A/B Testing), fino a 10 utenti team, supporto prioritario entro 8h.

• ENTERPRISE (prezzo custom): Per aziende 25+ utenti. Balance Sheet avanzato, API access, onboarding personalizzato, supporto dedicato entro 2h, integrazioni custom.

Add-On disponibili (indipendenti dal piano):
• Process Analyzer: €99/anno — Mappatura processi + AI Readiness Score + Voice to SOP
• Balance Sheet Analyzer: €99/anno — Analisi bilancio PDF con 15 KPI + Gap Analysis + Forecasting
• Extra Seats: €49/utente/anno (pricing progressivo: 1 utente €9/mese, 2 €14/mese, 3 €18/mese, 4 €20/mese)

Tutti i piani hanno prova gratuita e garanzia soddisfatti o rimborsati 30 giorni.` },

    { sector: 'general', title: 'AI Advisor — Come Funziona in Dettaglio', content: `L'AI Advisor di SCALA è il tuo consulente aziendale AI, disponibile in ogni modulo. Utilizza Gemini 2.5 Pro con un sistema RAG (Retrieval-Augmented Generation) a 3 livelli:

Livello 1 — Cache locale (IndexedDB): Risposte instant per domande già poste. Zero latenza.
Livello 2 — Knowledge Base (PostgreSQL + pgvector): Documenti aziendali, benchmark settoriali, best practice indicizzati con embeddings vettoriali.
Livello 3 — Gemini API: Generazione risposte complesse con contesto completo dell'azienda.

Come funziona in pratica:
1. Compili il Business Model Canvas con i tuoi dati
2. Aggiungi la SWOT e l'analisi Pareto
3. L'AI Advisor legge TUTTO insieme e ti dice: "Hai una concentrazione rischiosa: il 20% dei clienti genera l'85% del fatturato. Ecco 3 azioni per diversificare..."

L'output è sempre strutturato: problema identificato, impatto stimato, azione consigliata, priorità. Puoi applicare le azioni con un click.

Disponibile nei piani PRO ed Enterprise. Nel piano FREE e BASE puoi vedere un esempio demo di risposta AI.` },

    { sector: 'general', title: 'FAQ — Domande Frequenti su SCALA (Estese)', content: `D: Quanto tempo serve per iniziare?
R: Registrazione in 2 minuti. L'onboarding guidato ti configura in 30 minuti. In 1 giorno hai già il Canvas compilato e l'AI che ti analizza il business.

D: Posso provare gratis?
R: Sì, piano FREE gratuito per sempre. Puoi anche provare BASE e PRO con prova gratuita.

D: I miei dati sono al sicuro?
R: Assolutamente. Usiamo PostgreSQL con Row Level Security, crittografia in transit (TLS), backup automatici. Server in Europa. Compliant GDPR.

D: SCALA funziona su mobile?
R: Sì, è responsive. I moduli si adattano in colonna singola su smartphone.

D: Posso importare dati?
R: Sì, supportiamo import CSV/Excel per contatti CRM, pilotne entry. L'Enterprise plan include API REST per integrazioni custom.

D: Cosa differenzia SCALA dai competitor?
R: SCALA è l'unico OS italiano che copre le 5 fasi complete della crescita aziendale con AI settoriale. Non è solo un CRM o un project manager: è un sistema operativo completo. E costa meno di un gestionale base.

D: Come funziona Voice to SOP?
R: Clicchi il microfono, parli in italiano (o inglese/spagnolo), e Gemini AI crea automaticamente i passaggi operativi della procedura. In 30 secondi hai una SOP professionale con step trascinabili.

D: L'AI capisce il mio settore?
R: Sì. Ogni verticale ha 5-7 prompt AI specializzati. PraxisOS ha prompt per diritto civile, penale, tributario. DineOS per food cost, menu engineering. E così via.

D: Posso annullare l'abbonamento?
R: Sì, puoi annullare in qualsiasi momento dalla pagina Impostazioni. Garanzia soddisfatti o rimborsati 30 giorni.` },

    { sector: 'general', title: 'S.A.R.A. — SCALA AI Response Agent', content: `S.A.R.A. è l'assistente AI di SCALA che funziona su WhatsApp. È disponibile 24/7 per rispondere ai clienti dei nostri utenti.

Cosa fa S.A.R.A.:
• Risponde ai messaggi di testo con intelligenza settoriale
• Trascrive e risponde alle note vocali (Gemini STT)
• Analizza foto inviate (Gemini Vision)
• Legge e riassume documenti PDF
• Rileva automaticamente il settore dell'utente (legale, immobiliare, ristorazione, ecc.)
• Genera un profilo cliente automatico dopo 6 messaggi (nome, azienda, settore, budget, urgenza)
• Invia CTA verso il verticale SCALA appropriato

Comportamento human-like:
• Tempi di risposta variabili (4-15 secondi) per sembrare naturale
• Messaggi divisi in chunk da 120 caratteri con micro-pause
• Usa il femminile ("sono contenta di aiutarti")
• Risponde nella lingua dell'utente (IT/EN/ES auto-detect)

Follow-up automatici:
• Giorno 7, 21, 35, 70, 150, 300 — messaggi generati da Gemini al momento dell'invio, personalizzati sul contesto della conversazione

S.A.R.A. è inclusa in ogni piano SCALA senza costi aggiuntivi. Il competitor TalkMind costa €97/mese solo per il chatbot.` },

    { sector: 'general', title: 'Centro Assistenza — Supporto SCALA', content: `Come contattare il supporto SCALA:

• WhatsApp: Parla con S.A.R.A., attiva 24/7 — risponde in tempo reale con AI settoriale
• Email: supporto@scalaai.it
• Knowledge Base: Nell'app, sezione "Centro Assistenza" con tutorial, FAQ, quiz per ogni modulo
• Onboarding personalizzato: Incluso nei piani PRO ed Enterprise

Tempi di risposta per piano:
• FREE: Entro 48 ore lavorative
• BASE: Entro 24 ore
• PRO: Entro 8 ore (prioritario)
• Enterprise: Dedicato, entro 2 ore

Risorse formative disponibili:
• Video tutorial per ogni modulo (in italiano)
• Webinar mensili di approfondimento
• Guide PDF scaricabili
• Template professionali pronti all'uso
• Knowledge Base con 9 sezioni (1 per modulo) × Tutorial 4-step + FAQ + Quiz + Pro Tips` },

    { sector: 'general', title: 'Confronto SCALA vs Competitor', content: `Come si posiziona SCALA rispetto ai competitor:

SCALA vs TalkMind (€97/mese):
TalkMind è solo un chatbot WhatsApp con memoria. SCALA è un OS completo (Strategy, CRM, Process, Balance, Pilot) che INCLUDE il chatbot WhatsApp (S.A.R.A.) a €49-79/mese. Risparmio: 30-50% con 10x le funzionalità.

SCALA vs HubSpot (€45-800/mese):
HubSpot è un CRM potente ma generico, senza AI settoriale. SCALA ha CRM + Strategy + Process + Balance + AI specializzata per settore. Per PMI italiane SCALA è più completo e costa molto meno.

SCALA vs Monday.com (€8-16/utente/mese):
Monday è project management generale. SCALA è un OS aziendale con Business Canvas, Pilot, OKR, Process Analyzer, Balance Sheet AI — funzionalità che Monday non ha.

SCALA vs Notion (€8-15/utente/mese):
Notion è un wiki/database generico. SCALA ha moduli verticali strutturati con AI integrata, automazioni CRM, analisi bilancio, e si adatta al settore specifico.

Unico nel mercato italiano:
• Unico OS con AI settoriale (5-7 prompt per verticale)
• Unico che copre le 5 fasi della crescita aziendale
• Unico con WhatsApp AI bot incluso nel prezzo
• Pricing accessibile (€490-890/anno vs €1000+ competitor)` },

    { sector: 'general', title: 'Onboarding — Primi Passi con SCALA', content: `Come iniziare con SCALA AI OS in 30 minuti:

Passo 1 — Registrazione (2 minuti):
Vai su app.scalaai.it, crea un account con email o Google. Scegli il piano (FREE per esplorare, BASE per iniziare, PRO per l'AI Advisor).

Passo 2 — Business Model Canvas (10 minuti):
Compila i 9 blocchi del Canvas: Partner, Attività, Risorse, Proposta di Valore, Relazioni, Canali, Segmenti Clienti, Costi, Ricavi. Puoi trascinare e riordinare.

Passo 3 — SWOT e Pareto (5 minuti):
Aggiungi punti di forza, debolezze, opportunità e minacce. Inserisci i tuoi top clienti per l'analisi Pareto.

Passo 4 — AI Advisor (3 minuti, piano PRO):
Clicca "Analizza" e l'AI legge Canvas + SWOT + Pareto per darti suggerimenti strategici concreti.

Passo 5 — Primo Pilot (5 minuti):
Crea un esperimento per validare un'idea: nome, ipotesi, KPI, durata 30/60/90 giorni.

Passo 6 — CRM (5 minuti):
Importa i tuoi contatti (CSV/manuale) nella pipeline. L'AI assegna un lead score automatico.

Dopo l'onboarding hai una visione completa del tuo business con l'AI che ti guida.` },

    { sector: 'general', title: 'Sicurezza e Privacy SCALA', content: `SCALA prende la sicurezza molto seriamente:

Infrastruttura:
• Server in Europa (GCP Frankfurt/Milan)
• PostgreSQL con Row Level Security — ogni utente vede solo i propri dati
• Crittografia TLS in transit, AES-256 at rest
• Backup automatici giornalieri
• Zero vendor lock-in: tutto self-hosted su infrastruttura proprietaria

Autenticazione:
• JWT (JSON Web Token) con scadenza 7 giorni
• Supporto Google OAuth
• Password hashate con bcrypt (12 rounds)
• Rate limiting su tutti gli endpoint

GDPR Compliance:
• Audit log completo di tutte le azioni utente
• Consenso tracking per ogni dato raccolto
• Diritto all'oblio: cancellazione completa account e dati
• Data Processing Agreement disponibile per Enterprise
• Nessun trasferimento dati extra-EU

S.A.R.A. WhatsApp:
• Conversazioni cifrate end-to-end da WhatsApp
• Dati sessione in database dedicato con accesso limitato
• Nessun dato condiviso con terzi` },

    { sector: 'general', title: 'Verticali SCALA — Overview Tutti i Settori', content: `SCALA è disponibile in 7 versioni verticali, ognuna con AI settoriale dedicata:

1. PraxisOS (Studi legali e commercialisti): Gestione pratiche, scadenzario, fatturazione PA, AI legale con 6 prompt (civile, penale, tributario, GDPR, amministrativo, lavoro). Full-text search normativa italiana.

2. AgencyOS (Agenzie marketing): Kanban progetti, campagne multi-canale, AI proposal generator dal brief, report white-label, brand book digitale. 7 prompt AI (strategy, social, SEO, branding, copy, ads, analytics).

3. DineOS (Ristorazione): Menu engineering con food cost, prenotazioni, inventory FIFO, HACCP digitale, gestione turni CCNL Turismo. 6 prompt AI incluso Chef Advisor.

4. DermalyOS (Dermatologia/Estetica): Agenda pazienti, cartella clinica, protocolli trattamento, consent management, recall automatici. Telemedicina integrata.

5. PropertyOS (Immobiliare): Portfolio immobili, Multi-Publisher (Immobiliare.it + Idealista → 25+ portali con 1 click), matching AI acquirente-immobile, valutazioni AI, home staging virtuale. 6 prompt specializzati.

6. MotorOS (Automotive): Stock veicoli, valutazione usato AI, test drive booking, officina management, finanziamenti calculator, feed XML multi-portale. 5 prompt specializzati.

7. TravelOS (Turismo): Itinerari AI, ricerca voli (Kiwi.com), hotel (LiteAPI, 2M+ strutture), preventivi pacchetto, revenue management, channel manager. 5 prompt specializzati.

Tutti partono da €49/mese e includono S.A.R.A. WhatsApp AI.` },

    { sector: 'general', title: 'Extra User Pricing e Team Management', content: `Pricing utenti aggiuntivi SCALA (tiered, scontato progressivamente):
• 1 utente extra: €9/mese
• 2 utenti extra: €14/mese (-22%)
• 3 utenti extra: €18/mese (-33%)
• 4 utenti extra: €20/mese (-44%)

Ogni utente ha i propri dati isolati (Row Level Security). Gli admin possono gestire il team dalla pagina Impostazioni → Team. Ruoli disponibili: Admin, Manager, Member, Viewer.

Il piano BASE include fino a 3 utenti. Il PRO fino a 10. Enterprise 25+.` },

    // ═══════════════════════════════════════════════════
    // SEZIONE 2: VERTICALI — 7 × 3 documenti = 21 docs
    // (overview + walkthrough + FAQ per ciascuno)
    // ═══════════════════════════════════════════════════

    // ─── PraxisOS ───
    { sector: 'legale', title: 'PraxisOS — Overview per Studi Legali', content: `PraxisOS è il verticale SCALA per studi legali, commercialisti e consulenti. È l'unico gestionale italiano che integra AI settoriale con gestione pratiche.

Moduli principali:
• Gestione Pratiche: Tracking cause/pratiche con timeline, scadenze, documenti allegati, cronologia attività
• Scadenzario Legale: Calendario con reminder automatici (udienze, termini, adempimenti). Sincronizzazione con Google Calendar
• CRM Clienti: Anagrafica completa con storico pratiche, fatturazione, solleciti pagamento. Lead scoring automatico
• Document Management: Archiviazione con OCR, ricerca full-text in italiano, categorizzazione automatica
• Fatturazione PA-ready: Generazione XML per fatturazione elettronica, ritenuta d'acconto, cassa previdenza, split payment
• Time Tracking: Tracciamento ore per cliente/pratica con tariffe orarie personalizzabili
• AI Legal Assistant: 6 prompt specializzati (diritto civile, penale, tributario, GDPR, amministrativo, lavoro)
• Bilancio automatico: Analisi ricavi/costi per cliente con marginalità

Il legale medio risparmia 15-20 ore/settimana con PraxisOS.
URL: https://app.scalaai.it/praxisos` },

    { sector: 'legale', title: 'PraxisOS — Walkthrough Funzionalità', content: `Come usare PraxisOS — Guida passo passo:

1. Dashboard: Vedi subito pratiche attive, scadenze imminenti, fatture da incassare. Widget riassuntivi con KPI: parcellato medio, aging crediti, ore non fatturate.

2. Nuova Pratica: Click "+"  → inserisci cliente, tipo (civile/penale/tributario), oggetto, controparte, valore. Il sistema crea automaticamente la timeline con le scadenze previste.

3. Scadenzario: Vista calendario con codice colore per urgenza. Reminder automatici 7gg, 3gg, 1gg prima. Puoi aggiungere note e documenti a ogni scadenza.

4. AI Legal Assistant: Nella pratica, click "Chiedi all'AI" →  scegli il prompt (es. "Analisi contrattuale"). Incolla il testo del contratto e l'AI identifica clausole critiche, rischi, suggerimenti.

5. Fatturazione: Genera fattura dal time tracking. Calcolo automatico ritenuta d'acconto (20%), Cassa Previdenza (4%), IVA (22%). Export XML per SDI.

6. Ricerca Normativa: Barra di ricerca full-text sulle normative italiane indicizzate. Risultati con articolo, comma, testo completo.

7. Report: Genera report mensili/trimestrali con fatturato, ore lavorate, pratiche chiuse. Export PDF con branding personalizzato.` },

    { sector: 'legale', title: 'PraxisOS — FAQ per Studi Legali', content: `D: PraxisOS gestisce le udienze?
R: Sì, lo scadenzario ha una categoria specifica per udienze con reminder automatici e possibilità di allegare memorie e documenti.

D: Posso importare le pratiche dal mio gestionale attuale?
R: Sì, supportiamo import CSV con mapping personalizzabile dei campi. Puoi anche inserire manualmente.

D: La fatturazione è compatibile con la Cassa Forense?
R: Sì, il modulo fatturazione calcola automaticamente contributo Cassa Previdenza (4%) e ritenuta d'acconto (20%).

D: L'AI può analizzare un contratto?
R: Sì, il prompt "Analisi Contrattuale" legge il testo e identifica: clausole critiche, penali, termini di recesso, confidenzialità, responsabilità. Suggerisce modifiche.

D: Il time tracking è obbligatorio?
R: No, è opzionale ma consigliato. Ti permette di generare fatture precise e capire la redditività per cliente.

D: Quanti utenti possono usare PraxisOS?
R: Dipende dal piano: BASE fino a 3, PRO fino a 10, Enterprise illimitato. Ogni utente vede solo le proprie pratiche (o quelle condivise).` },

    // ─── AgencyOS ───
    { sector: 'agenzia', title: 'AgencyOS — Overview per Agenzie Creative', content: `AgencyOS è il verticale SCALA per agenzie di comunicazione, marketing e web agency. È progettato per gestire clienti, progetti, campagne e creatività con AI integrata.

Moduli principali:
• Project Management: Board Kanban con task, assegnazioni, deadline, dipendenze. Vista Gantt per progetti complessi
• Content Calendar: Piano editoriale multi-piattaforma (Instagram, Facebook, LinkedIn, TikTok, YouTube) con workflow di approvazione
• Campaign Manager: Gestione campagne multi-canale con budget, metriche (ROAS, CPA, CTR, Conversion), alert automatici
• AI Proposal Generator: Inserisci il brief del cliente → l'AI genera una proposta commerciale strutturata (obiettivi, strategia, timeline, budget, KPI)
• Report White-Label: Report per clienti con il TUO brand, generati automaticamente dai dati delle campagne
• Brand Book Digitale: Repository centralizzato per assets, colori, font, tone of voice, linee guida per ogni cliente
• Budget & Profitability: Tracking costi per progetto, ore lavorate, marginalità per cliente
• 7 prompt AI: strategy, social media, SEO, branding, copywriting, advertising, analytics

Le agenzie con AgencyOS gestiscono il 3x dei clienti con lo stesso team.
URL: https://app.scalaai.it/agencyos` },

    { sector: 'agenzia', title: 'AgencyOS — Walkthrough Funzionalità', content: `Come usare AgencyOS — Guida passo passo:

1. Dashboard: Overview progetti attivi, task in scadenza, campagne live, fatturato per cliente. Widget con profitability per progetto.

2. Nuovo Progetto: Crea progetto → associa cliente → definisci budget e timeline → il Kanban si popola con le fasi standard (Brief, Strategy, Creative, Production, Review, Live).

3. AI Proposal: Ricevi un brief dal cliente → click "Genera Proposta AI" → inserisci brief testuale → l'AI crea una proposta con obiettivi, strategia, canali, timeline, budget stimato, KPI attesi. Revisiona e invia.

4. Piano Editoriale: Calendario visuale con post schedulati per piattaforma. Drag & drop per spostare. Status: Bozza → In Review → Approvato → Pubblicato.

5. Campagne: Crea campagna → definisci canali (Google Ads, Meta, LinkedIn) → inserisci budget → traccia metriche in tempo reale. Alert se ROAS scende sotto soglia.

6. Report Clienti: Seleziona cliente e periodo → genera report white-label automatico con metriche, grafici, insights AI. Export PDF con il tuo logo.

7. Brand Book: Per ogni cliente, carica logo, palette colori, font, tone of voice. Il team ha sempre accesso alle linee guida aggiornate.` },

    { sector: 'agenzia', title: 'AgencyOS — FAQ per Agenzie', content: `D: Posso collegare i social media per le analytics?
R: I dati delle campagne si inseriscono manualmente o via API (piano Enterprise). Non c'è connessione diretta ai social nelle versioni BASE/PRO.

D: L'AI può scrivere copy per i social?
R: Sì, il prompt "Copywriting" genera post, headline, caption basandosi sul brand del cliente, tone of voice e obiettivo della campagna.

D: I report hanno il mio logo?
R: Sì, i report sono white-label al 100%. Carichi il tuo logo, colori, font e il report esce con il tuo branding completo.

D: Quanti clienti posso gestire?
R: Non c'è limite ai clienti/progetti. Il limite è sugli utenti del team: BASE 3, PRO 10, Enterprise illimitato.

D: C'è un template per i brief?
R: Sì, il Brief Generator ha un template strutturato: obiettivo, target, budget, timeline, tono, riferimenti. Lo compili e l'AI genera la proposta.` },

    // ─── DineOS ───
    { sector: 'ristorante', title: 'DineOS — Overview per Ristorazione', content: `DineOS è il verticale SCALA per ristoranti, pizzerie, bar, pasticcerie e locali. È l'unico gestionale italiano con AI Chef Advisor integrato.

Moduli principali:
• Menu Engineering: Analisi profittabilità per piatto (food cost %, margine, popolarità). Matrice BCG per ottimizzare il menu. Suggerimenti AI per ripricing
• Prenotazioni: Sistema booking con conferma automatica WhatsApp/SMS. Gestione allergie e preferenze. Overbooking protection
• Inventory FIFO: Gestione magazzino con First-In-First-Out, soglie riordino automatiche, allert scadenza, tracciamento sprechi
• Staff & Turni: Pianificazione turni con compliance CCNL Turismo. Costo del lavoro per servizio/fascia oraria
• HACCP Digitale: Registro temperature, checklist igiene giornaliere, scadenze certificazioni, compliance automatizzata
• CRM Clienti: Anagrafica con preferenze, allergie, storico ordini, compleanno marketing, programma fedeltà
• Dashboard Financials: Scontrino medio, coperti per servizio, marginalità per fascia oraria, food cost %, trend settimanali
• 6 prompt AI: menu engineering, food cost optimization, inventory management, service optimization, HACCP, review analysis

I ristoranti con DineOS vedono in media +25% di marginalità nel primo anno.
URL: https://app.scalaai.it/dineos` },

    { sector: 'ristorante', title: 'DineOS — Walkthrough e FAQ', content: `Come usare DineOS:

1. Menu Setup: Inserisci i piatti con ingredienti, quantità, costo unitario. DineOS calcola automaticamente food cost % e margine per piatto. L'AI suggerisce quali piatti promuovere (alto margine + alta popolarità).

2. Prenotazioni: I clienti prenotano via WhatsApp (S.A.R.A.) o telefono. Il sistema gestisce tavoli, posti, allergie. Conferma automatica.

3. Magazzino: Registra acquisti → il sistema traccia quantità disponibili con FIFO. Alert quando sotto soglia. Report sprechi mensile.

4. AI Chef Advisor: "Il mio food cost è al 38%, come lo riduco?" → L'AI analizza il tuo menu e suggerisce: sostituzione ingredienti, resize porzioni, eliminazione piatti a basso margine.

FAQ Ristoranti:
D: Posso collegare il POS? R: Non direttamente, ma puoi importare dati vendita via CSV per le analytics.
D: Gestisce anche delivery? R: Il CRM traccia ordini delivery/asporto con analisi separata dei margini.
D: Funziona per pizzerie? R: Assolutamente. Il food cost calculator funziona per qualsiasi tipo di piatto.
D: L'HACCP digitale sostituisce il cartaceo? R: Sì, le checklist digitali sono conformi alle normative. Export PDF per ispezioni.` },

    // ─── DermalyOS ───
    { sector: 'dermatologia', title: 'DermalyOS — Overview per Dermatologia', content: `DermalyOS è il verticale SCALA per studi dermatologici e cliniche di medicina estetica.

Moduli principali:
• Agenda Pazienti: Scheduling con slot personalizzabili per tipo trattamento (15min visita, 30min filler, 60min laser). Reminder automatici SMS/WhatsApp 24h prima
• Cartella Clinica Digitale: Storico trattamenti, foto before/after con comparazione, consensi informatici firmati, note cliniche
• Protocolli Trattamento: Template personalizzabili per ogni tipo (filler acido ialuronico, botox, laser CO2, peeling chimico, biorivitalizzazione). Dosi, zone, tempistiche
• Consent Management: Consensi informatici digitali per ogni trattamento. Firma elettronica. Archiviazione GDPR-compliant
• CRM Pazienti: Follow-up post-trattamento automatici. Recall visite periodiche. Birthday marketing. Programma referral
• Revenue Dashboard: Fatturato per trattamento, marginalità per servizio, trend stagionali, occupancy rate
• Magazzino: Gestione prodotti, filler, dispositivi. Tracciamento lotti, scadenze, riordini
• Telemedicina: Videoconsulti per follow-up e consulenze preliminari

Gli studi con DermalyOS riducono i no-show del 35% e aumentano il lifetime value paziente del 40%.
URL: https://app.scalaai.it/dermalyos` },

    { sector: 'dermatologia', title: 'DermalyOS — Walkthrough e FAQ', content: `Come usare DermalyOS:

1. Setup Agenda: Definisci i tipi di appuntamento (visita, filler, botox, laser) con durate diverse. Crea slot disponibili.
2. Nuova Visita: Paziente prenota via WhatsApp (S.A.R.A.) o telefono. Il sistema invia conferma + reminder 24h prima.
3. Cartella Clinica: Durante la visita, documenta il trattamento, scatta foto before/after, fai firmare il consenso digitale.
4. Follow-up: Il sistema invia automaticamente un messaggio post-trattamento (giorno 1, 7, 30) per verificare il risultato.
5. Recall: Dopo il periodo consigliato (es. 6 mesi per botox), il paziente riceve un reminder per la seduta successiva.

FAQ Dermatologia:
D: Le foto before/after sono sicure? R: Sì, archiviate con crittografia, accesso solo al medico autorizzato. GDPR compliant.
D: Il consenso digitale è valido legalmente? R: Sì, con firma elettronica qualificata. Export PDF per archivio.
D: Posso personalizzare i protocolli? R: Sì, ogni protocollo è un template modificabile. Puoi crearne di nuovi.
D: La telemedicina è inclusa? R: Sì nel piano PRO, con videoconsulti integrati e possibilità di condividere documenti in tempo reale.` },

    // ─── PropertyOS ───
    { sector: 'immobiliare', title: 'PropertyOS — Overview per Agenzie Immobiliari', content: `PropertyOS è il verticale SCALA per agenzie immobiliari. È l'unico gestionale italiano che combina AI valuation + Multi-Publisher + CRM in un'unica piattaforma.

Moduli principali:
• Portfolio Immobili: Catalogo completo con foto, planimetrie, virtual tour, APE, specifiche tecniche. Filtri avanzati per tipologia, zona, prezzo
• Multi-Publisher: Con 1 CLICK pubblichi l'annuncio su Immobiliare.it e Idealista, che redistribuisce su 25+ portali automaticamente. Zero inserimento multiplo
• AI Matching: L'AI confronta le preferenze dell'acquirente (zona, budget, metratura, piano) con il portfolio e suggerisce gli immobili più compatibili con score di matching
• Valutazioni AI: Stima automatizzata basata su comparabili di zona, dati catastali, trend di mercato. 6 prompt specializzati
• Calendar Visite: Scheduling visite immobiliari con feedback post-visita automatizzato. Integrazione Google Calendar
• CRM Proprietari + Acquirenti: Pipeline separata per venditori e acquirenti. Lead scoring per prioritizzare
• Document Center: Template preliminari, compromessi, checklist rogito, visure catastali
• Commissioni Tracking: Calcolo provvigioni automatico, pipeline deals con forecast fatturato

PropertyOS aumenta il tasso di chiusura del 30% grazie al matching AI.
URL: https://app.scalaai.it/propertyos` },

    { sector: 'immobiliare', title: 'PropertyOS — Walkthrough e FAQ', content: `Come usare PropertyOS:

1. Nuovo Immobile: Inserisci indirizzo, tipologia, metratura, piano, prezzo. Carica foto. L'AI genera una descrizione professionale dell'annuncio.
2. Multi-Publisher: Click "Pubblica" → l'annuncio va su Immobiliare.it + Idealista in simultanea. Modifiche sincronizzate.
3. Lead Management: I lead dai portali entrano nel CRM. L'AI assegna un lead score basato su interazioni, budget dichiarato, urgenza.
4. AI Matching: Per ogni acquirente, l'AI suggerisce gli immobili più compatibili dal portfolio. Score di matching da 1 a 100.
5. Visita: Schedula la visita dal calendario. Dopo la visita, il sistema chiede feedback all'acquirente via WhatsApp.
6. Valutazione: Inserisci i dati dell'immobile → l'AI stima il valore basandosi su comparabili della zona.

FAQ Immobiliare:
D: Il Multi-Publisher è in tempo reale? R: Sì, la pubblicazione è immediata con sincronizzazione bidirezionale per modifiche.
D: Quanti immobili posso gestire? R: Illimitati in tutti i piani.
D: L'AI di valutazione è accurata? R: La stima si basa su comparabili reali della zona. Accuratezza media ±5-10%.
D: Posso gestire affitti e vendite? R: Sì, pipeline separate per vendita e locazione.` },

    // ─── MotorOS ───
    { sector: 'automotive', title: 'MotorOS — Overview per Automotive', content: `MotorOS è il verticale SCALA per concessionarie auto e officine. Gestisce stock veicoli, valutazioni AI, CRM clienti e after-sales in un'unica piattaforma.

Moduli principali:
• Stock Management: Catalogo veicoli nuovi/usati/km0 con foto, specifiche, optional, storico manutenzioni. Feed XML per pubblicazione su portali auto
• Valutazione Usato AI: Inserisci targa o dati veicolo → l'AI stima il valore basandosi su km, anno, condizioni, mercato. Benchmark con Eurotax/DAT
• Test Drive: Booking prove su strada con calendario. Follow-up automatico post-test drive via WhatsApp
• Officina Management: Schede intervento, scheduling riparazioni, ordini ricambi, preventivi automatici, storico interventi per veicolo
• Finanziamenti Calculator: Simulatore rate per leasing, noleggio lungo termine, finanziamento classico. Confronto opzioni
• CRM Clienti Auto: Storico acquisti, manutenzioni, scadenze (revisione, bollo, assicurazione). Recall automatici
• After-Sales: Gestione garanzie, estensioni, customer satisfaction survey. Il 60% dei profitti viene dall'after-sales
• 5 prompt AI: valutazione usato, preventivi, stock optimization, manutenzione predittiva, analisi mercato

Le concessionarie con MotorOS riducono i tempi di vendita del 25%.
URL: https://app.scalaai.it/motoros` },

    { sector: 'automotive', title: 'MotorOS — Walkthrough e FAQ', content: `Come usare MotorOS:

1. Inserimento Veicolo: Targa o inserimento manuale → specifiche auto-compilate. Aggiungi foto, prezzo, optional.
2. Valutazione AI: Per un usato, l'AI analizza km, anno, stato, mercato locale e propone un range di valutazione.
3. Feed XML: I veicoli si pubblicano automaticamente sui portali auto con feed XML aggiornato in tempo reale.
4. Test Drive: Prenota → calendario si aggiorna → cliente riceve conferma. Post-test, follow-up automatico WhatsApp.
5. Officina: Apri scheda intervento → inserisci lavori, ricambi, ore. Preventivo generato e inviato al cliente.

FAQ Automotive:
D: Supporta il passaggio di proprietà? R: Gestisce la documentazione e le scadenze associate, ma il PRA si gestisce esternamente.
D: Funziona per officine indipendenti? R: Sì, il modulo officina è indipendente dallo stock vendita.
D: La valutazione AI è affidabile? R: È un supporto decisionale basato su dati di mercato. Per valutazioni ufficiali si consiglia confronto con Eurotax.
D: Posso gestire anche moto? R: Sì, lo stock management supporta qualsiasi tipo di veicolo.` },

    // ─── TravelOS ───
    { sector: 'turismo', title: 'TravelOS — Overview per Turismo', content: `TravelOS è il verticale SCALA per agenzie di viaggio, tour operator, hotel e B&B. Integra AI per itinerari, revenue management e gestione prenotazioni.

Moduli principali:
• Itinerari AI: Inserisci destinazione, durata, budget, interessi → l'AI crea un itinerario personalizzato giorno per giorno con voli, hotel, attività
• Ricerca Voli: Integrazione Kiwi.com API per cercare voli in tempo reale con confronto prezzi
• Ricerca Hotel: Integrazione LiteAPI con accesso a 2+ milioni di strutture nel mondo. Confronto prezzi e disponibilità
• Preventivi Pacchetto: Genera preventivi completi (volo + hotel + trasferimenti + attività) con markup personalizzabile. Export PDF professionale
• Revenue Management: Dynamic pricing basato su stagionalità, occupancy, domanda. Dashboard con ADR, RevPAR, Occupancy Rate
• CRM Viaggiatori: Profilo clienti con preferenze di viaggio, budget medio, destinazioni visitate, allergie alimentari
• Review Manager: Monitoraggio recensioni multi-piattaforma con risposte generate dall'AI
• 5 prompt AI: itinerary creation, seasonal revenue, dynamic pricing, review sentiment, destination discovery

Gli operatori con TravelOS aumentano le prenotazioni dirette del 25%.
URL: https://app.scalaai.it/travelos` },

    { sector: 'turismo', title: 'TravelOS — Walkthrough e FAQ', content: `Come usare TravelOS:

1. Nuovo Itinerario: Cliente chiede "viaggio a Bali 10 giorni per 2 persone, budget €3000" → l'AI genera itinerario completo.
2. Ricerca Voli: Cerca voli con Kiwi.com direttamente dalla dashboard. Confronta prezzi, scali, durata.
3. Preventivo: Combina volo + hotel + attività → genera preventivo PDF con il tuo branding e il markup che vuoi.
4. Revenue (per hotel): Imposta tariffe base per camera. L'AI suggerisce prezzi dinamici in base a stagione, eventi locali, occupancy.

FAQ Turismo:
D: Le API voli sono in tempo reale? R: Sì, Kiwi.com fornisce disponibilità e prezzi in tempo reale.
D: Posso usarlo per un B&B? R: Assolutamente. Il modulo revenue management funziona per qualsiasi struttura ricettiva.
D: L'itinerario AI è personalizzabile? R: Sì, puoi modificare ogni giorno, aggiungere/rimuovere attività, cambiare hotel.
D: I prezzi hotel includono la commissione? R: I prezzi LiteAPI sono netti. Tu aggiungi il tuo markup nel preventivo.` },

    // ═══════════════════════════════════════════════════
    // SEZIONE 3: RICERCHE DI SETTORE — 7 documenti
    // ═══════════════════════════════════════════════════

    { sector: 'legale', title: 'Ricerca di Settore — Studi Legali e Commercialisti 2025', content: `Il mercato professionale italiano in numeri:

Studi Legali:
• 240.000 avvocati iscritti all'albo in Italia
• Il 67% degli studi sotto 5 avvocati non usa software gestionali specifici
• Fatturato medio per avvocato: €68.000/anno (in calo del 5% negli ultimi 5 anni)
• Tempi di incasso medi: oltre 120 giorni
• Solo il 12% usa strumenti AI per ricerca normativa
• Il 45% vorrebbe digitalizzare ma non sa dove iniziare
• Aree di crescita: diritto digitale, GDPR, diritto dell'AI

Commercialisti:
• 120.000 commercialisti in Italia
• Il 78% del tempo è in adempimenti fiscali ripetitivi
• Il 55% vorrebbe delegare compiti ripetitivi all'AI
• La digitalizzazione PA sta accelerando la domanda

Opportunità PraxisOS: Ridurre tempi di ricerca del 40%, tempi di incasso del 25%, e tempo per adempimenti del 60%.` },

    { sector: 'agenzia', title: 'Ricerca di Settore — Agenzie Marketing 2025', content: `Il mercato delle agenzie di comunicazione italiane:

• 15.000+ agenzie attive, il 70% con meno di 10 dipendenti
• Fatturato medio: €250.000-500.000/anno
• Il 60% del tempo è speso in attività operative vs creative
• Il content marketing rappresenta il 35% dei ricavi
• L'AI generativa sta rivoluzionando la produzione contenuti (-50% tempi)
• Social media management principale area di crescita (+22% annuo)
• Il 40% delle agenzie fatica a scalare oltre 15 clienti
• I clienti chiedono sempre più ROI misurabile

Opportunità AgencyOS: Gestire 3x clienti con lo stesso team, automatizzare report, generare proposte AI dal brief.` },

    { sector: 'ristorante', title: 'Ricerca di Settore — Ristorazione 2025', content: `La ristorazione italiana:

• 350.000+ ristoranti, bar e locali attivi
• Food cost medio: 28-35% del fatturato
• Il 40% delle chiusure nei primi 3 anni
• Solo il 20% usa software di gestione specifico
• Delivery: 15-25% dei ricavi, in crescita del 18% annuo
• Costo del lavoro: 30-38% del fatturato (voce più critica)
• Scontrino medio in crescita (+8%) ma anche i costi
• Recensioni online influenzano il 72% delle scelte clienti
• Il 53% vorrebbe ottimizzare il food cost ma non ha strumenti

Opportunità DineOS: Ridurre food cost del 15%, aumentare marginalità del 25%, ridurre sprechi del 20%.` },

    { sector: 'dermatologia', title: 'Ricerca di Settore — Dermatologia 2025', content: `Il mercato dermatologia e medicina estetica:

• 15.000+ dermatologi e 8.000+ medici estetici in Italia
• Mercato medicina estetica: €2.3 miliardi, crescita +12% annuo
• Trattamenti più richiesti: filler (+15%), botox (+10%), laser (+8%)
• No-show medio: 15-20% (costa migliaia di euro/anno)
• Solo il 25% usa un gestionale specifico per il settore
• Telemedicina dermatologica: +200% post-covid
• Follow-up post-trattamento critico ma spesso trascurato
• 85% dei pazienti cerca online prima di prenotare

Opportunità DermalyOS: Ridurre no-show del 35%, aumentare lifetime value paziente del 40%.` },

    { sector: 'immobiliare', title: 'Ricerca di Settore — Immobiliare 2025', content: `Il mercato immobiliare italiano:

• 45.000+ agenzie, il 60% con meno di 5 agenti
• Transazioni: 710.000/anno (ripresa +5%)
• Provvigione: 3-4% del valore immobile
• Tempo medio vendita: 5-7 mesi
• Solo il 30% usa CRM dedicato
• Portali generano 70% lead ma 60% è bassa qualità
• Home staging aumenta prezzo +5-15%
• Virtual tour riduce visite inutili del 40%

Opportunità PropertyOS: +30% chiusure con matching AI, -50% tempo inserimento annunci con Multi-Publisher.` },

    { sector: 'automotive', title: 'Ricerca di Settore — Automotive 2025', content: `Il settore automotive italiano:

• 1.600+ concessionarie e 85.000+ officine
• Margine per veicolo nuovo: 2-4%, usato: 8-15%
• After-sales genera il 60% dei profitti
• 45% clienti inizia ricerca online, conclude in concessionaria
• Elettrico in crescita ma solo 5% delle vendite
• Tempo giacenza stock: 45-90 giorni
• Solo 20% ha CRM strutturato
• Follow-up post-vendita critico per retention

Opportunità MotorOS: -25% tempi giacenza, +35% cross-selling after-sales.` },

    { sector: 'turismo', title: 'Ricerca di Settore — Turismo 2025', content: `Il turismo italiano:

• 33.000+ hotel, 25.000+ B&B, 10.000+ agriturismi
• Italia 5° paese più visitato (65M+ arrivi/anno)
• Occupancy media: 55-65% (margine miglioramento enorme)
• RevPAR: €75-120 città d'arte, €40-60 provincia
• OTA (Booking/Airbnb): 55% prenotazioni, 15-25% commissione
• Disintermediazione (prenotazioni dirette) è priorità #1
• 40% hotel senza revenue management attivo
• Recensioni negative costano €1.500-3.000/anno

Opportunità TravelOS: +25% prenotazioni dirette, +15% RevPAR.` },

    // ═══════════════════════════════════════════════════
    // SEZIONE 4: CASE STUDY — 4 documenti
    // ═══════════════════════════════════════════════════

    { sector: 'legale', title: 'Case Study — Studio Legale Rossi & Associati', content: `Studio Rossi & Associati — 4 avvocati, specializzati in diritto commerciale a Milano.

Problema: Gestivano tutto con Excel e carta. I tempi di incasso superavano 180 giorni. Le scadenze processuali venivano perse occasionalmente.

Soluzione PraxisOS:
• Scadenzario digitale con reminder automatici → zero scadenze perse
• Time tracking per cliente → scoperto che il 30% dei clienti generava perdite
• Fatturazione automatica → ritenuta, cassa, IVA calcolati in 1 click
• AI per analisi contratti → tempo di review ridotto del 60%

Risultati dopo 6 mesi:
• Tempi di incasso: da 180 a 95 giorni (-47%)
• Ore non fatturate: da 20% a 5% (-75%)
• Pratiche gestite: da 120 a 180 (+50%) con stesso staff
• Soddisfazione clienti: da 3.2/5 a 4.5/5

"PraxisOS ci ha permesso di capire finalmente quali clienti sono profittevoli e quali ci fanno perdere tempo." — Avv. Marco Rossi` },

    { sector: 'ristorante', title: 'Case Study — Trattoria Da Nino', content: `Trattoria Da Nino — Ristorante di pesce, 60 coperti, Genova. 8 dipendenti.

Problema: Food cost al 42% (target max 35%). Sprechi del 12%. Menu mai analizzato per marginalità. Prenotazioni gestite con quaderno.

Soluzione DineOS:
• Menu Engineering: analisi food cost per piatto → scoperto che 5 piatti avevano margine negativo
• Inventory FIFO: tracciamento scadenze → sprechi ridotti dal 12% al 4%
• Prenotazioni digitali con S.A.R.A. WhatsApp → conferma automatica
• AI Chef Advisor: suggerimenti per riformulare ricette mantenendo qualità

Risultati dopo 4 mesi:
• Food cost: da 42% a 31% (-26%)
• Sprechi: da 12% a 4% (-67%)
• Scontrino medio: da €28 a €34 (+21%, grazie a piatti ad alto margine promossi)
• No-show: da 15% a 5% (grazie a reminder WhatsApp)

"Non avevo idea che la tartare di tonno mi facesse perdere soldi. L'AI me l'ha mostrato subito." — Nino Pescatore` },

    { sector: 'immobiliare', title: 'Case Study — Immobiliare Bianchi', content: `Immobiliare Bianchi — Agenzia a Roma, 3 agenti. 80 immobili in portfolio.

Problema: Inserimento annunci manuale su 4 portali (2 ore/immobile). Lead dispersi tra email, WhatsApp, post-it. Nessun matching acquirente-immobile.

Soluzione PropertyOS:
• Multi-Publisher: pubblicazione su Immobiliare.it + Idealista con 1 click → risparmio 1.5 ore/immobile
• CRM con lead scoring → prioritizzazione automatica dei lead più caldi
• AI Matching: ogni acquirente riceve suggerimenti di immobili compatibili

Risultati dopo 3 mesi:
• Tempo inserimento: da 2 ore a 15 minuti per immobile (-87%)
• Lead gestiti: da 60% a 95% (nessun lead perso)
• Tempo chiusura vendita: da 6 a 4.5 mesi (-25%)
• Transazioni/mese: da 3 a 5 (+67%)

"Il Multi-Publisher da solo vale l'abbonamento. Ma il matching AI è la vera magia." — Laura Bianchi` },

    { sector: 'agenzia', title: 'Case Study — Creative Lab Agency', content: `Creative Lab — Agenzia digital a Torino, 6 dipendenti, 22 clienti attivi.

Problema: Report mensili per clienti richiedevano 2 giorni/mese. Proposte commerciali fatte a mano (4-6 ore ciascuna). Nessuna visibilità sulla profitability per cliente.

Soluzione AgencyOS:
• Report white-label automatici → da 2 giorni a 2 ore/mese
• AI Proposal Generator → proposte generate in 15 minuti dal brief
• Budget tracking per progetto → scoperto che 4 clienti erano in perdita
• Piano editoriale centralizzato → zero post dimenticati

Risultati dopo 3 mesi:
• Tempo report: da 16h a 2h/mese (-87%)
• Tempo proposte: da 5h a 15min (-95%)
• Clienti gestiti: da 22 a 35 (+59%) con stesso team
• Marginalità media: da 15% a 28% (+87%, eliminando clienti non profittevoli)

"L'AI proposal generator è incredibile. Inserisco il brief e in 15 minuti ho una proposta professionale. Prima ci mettevo mezza giornata." — Giulia Ferrero, CEO` },
];

// ═══════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════
async function main() {
    console.log('═══════════════════════════════════════════════════');
    console.log('  SARA RAG Knowledge Base Loader — v2 ENRICHED');
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
    console.log(`  📊 Total docs: ${DOCS.length}`);

    // Print stats
    const stats = await pool.query('SELECT sector, count(*) as cnt, sum(char_length(content)) as chars FROM wa_rag_documents GROUP BY sector ORDER BY sector');
    console.log('\n  📊 Stats per sector:');
    for (const row of stats.rows) {
        console.log(`     ${row.sector}: ${row.cnt} docs, ${row.chars} chars`);
    }
    console.log(`═══════════════════════════════════════════════════`);

    await pool.end();
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
