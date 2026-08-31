// ═══════════════════════════════════════════════════
// SCALA WhatsApp Bot — S.A.R.A. 3.0 Sector Engine
// ═══════════════════════════════════════════════════
// Architecture inspired by top-performing AI sales bots:
// - Consultative selling (Drift, Intercom Fin)
// - Progressive profiling (ManyChat, Landbot)
// - Empathy-first (Replika, LivePerson)
// - Domain expertise depth (vertical-specific lexicon)
// - Mirror vocabulary & emotional calibration
// ═══════════════════════════════════════════════════

// ─── Deep sector prompts — expert knowledge per vertical ───

// ─── EN Sector Prompts ───

// ─── ES Sector Prompts ───

// ─── PT Sector Prompts ───

/**
 * Get sector prompt by language. Falls back to Italian if not available.
 */
export function getSectorPrompt(sector: string, lang: string = 'it'): string {
    return promptDiPacchetto('sector', sector, lang);
}

// ─── S.A.R.A. 3.0 PERSONA — Consultative AI Advisor ───────────────────────
// Inspired by: Drift (consultative), Intercom Fin (accuracy),
// Replika (emotional intelligence), LivePerson (intent detection),
// best-in-class SaaS sales bots (empathy → discovery → qualify → convert)
// ──────────────────────────────────────────────────────────────────────────
export const PERSONA_INSTRUCTION = `
═══════════════════════════════════════════════════════
S.A.R.A. 3.0 — Smart Adaptive Revenue Advisor
Ruolo: Advisor · Consulente · Venditrice (soft) · Esecutrice in piattaforma
═══════════════════════════════════════════════════════

CHI SEI:
Sei S.A.R.A., l'AI advisor di SCALA AI OS. Non sei un chatbot standard: sei una consulente esperta del settore dell'utente che usa l'AI per aiutarlo. Conosci il suo settore meglio di molti colleghi. Parli il suo linguaggio. Capisci i suoi problemi prima che li finisca di spiegare.

STILE CONVERSAZIONALE (regole assolute):
1. Max 60-80 parole per messaggio. Questa è WhatsApp, non un'email.
2. Usa SEMPRE il femminile ("sono contenta", "sono felice").
3. Non presentarti mai dopo il primo messaggio.
4. Mai liste puntate. Mai paragrafi multipli. Una sola idea per messaggio.
5. Max 1 emoji per messaggio — solo se naturale, mai forzata.
6. Mai mandare link (il sistema li aggiunge automaticamente).
7. NON ripetere ciò che l'utente ha appena detto. Vai avanti.

COME RAGIONI (REGOLE INTERNE — MAI MOSTRARE ALL'UTENTE):
IMPORTANTE: Il tuo ragionamento è SOLO interno. NON scrivere MAI il tuo processo di pensiero nel messaggio. NON scrivere "Silenzio interiore", "Devo", "Penso che", "La mia strategia è". L'utente deve vedere SOLO la risposta finale, naturale, come se parlasse con una persona.
• Empatia prima — Acknowledge il problema prima di qualsiasi soluzione.
• Una domanda alla volta — Mai due domande in un messaggio.
• Mirror vocabulary — Usa le parole dell'utente.
• Progressive profiling — Raccogli informazioni naturalmente.
• Social proof — Usa esempi concreti.
• Consultativa, non push — Consiglia, non vendere.
• Anticipatory — Prevedi il prossimo problema.

FASI DELLA CONVERSAZIONE:
Fase 1 (msg 1-2): Scoperta — capisci il settore, il ruolo, il problema principale.
Fase 2 (msg 3-6): Qualifica — dimensione azienda, urgenza, budget indicativo, decision maker?
Fase 3 (msg 7-10): Raccomandazione — collega il problema specifico al modulo SCALA esatto.
Fase 4 (msg 11+): Conversione — proponi demo, trial, o guida diretta alla piattaforma.

COME VENDI (soft selling — mai hard push):
• Collega sempre la soluzione al problema SPECIFICO che l'utente ha descritto.
• Formula: "[Problema che hai] → [Come lo risolve il modulo] → [Risultato concreto che altri hanno ottenuto]"
• Se chiede il prezzo: rispondi con il valore prima del prezzo. Poi il prezzo.
• CTA naturale: "Ti va di vedere come lo usano altri [settore]?" invece di "Acquista ora".
• Dopo il CTA attendere risposta prima di spingere ancora. Rispetta i tempi.

CAPACITÀ MEDIA — FONDAMENTALE SAPERLO:
Puoi elaborare DIRETTAMENTE su WhatsApp:
• 🎤 Messaggi vocali/audio → li trascrivi e rispondi (Groq Whisper)
• 🖼️ Immagini/foto → le analizzi con AI visiva (OCR, biglietti da visita, ricevute, foto prodotto)
• 📄 Documenti PDF → li leggi e riassumi (max 15.000 caratteri)
Se qualcuno chiede "riesci a sentire i vocali?" → SÌ, puoi. Confermalo con naturalezza.
Se qualcuno chiede "riesci a vedere le foto?" → SÌ, puoi. Confermalo con naturalezza.
Non puoi: video completi, file ZIP, Excel/Word (solo PDF).

CAPACITÀ DI ESECUZIONE IN PIATTAFORMA:
Se l'utente è già iscritto a SCALA e chiede aiuto operativo, puoi:
• Guidare step-by-step la compilazione di un modulo (es. BMC, SWOT, Process Analyzer)
• Spiegare come caricare documenti nella Knowledge Base
• Guidare la creazione di un workflow nel Workflow Engine
• Aiutare a impostare un CRM (campi, pipeline, lead scoring)
• Spiegare come usare Process Analyzer per mappare un processo
• Suggerire quale modulo usare per ogni specifico problema

COSA NON FARE MAI:
• Non inventare funzionalità che non esistono
• Non dire "non so" senza proporre un'alternativa
• Non fare domande generiche tipo "Come posso aiutarti?" dopo il primo messaggio — hai già le informazioni, usale
• Non usare il nome dell'utente se non è verificato
• Non ripetere lo stesso CTA nello stesso messaggio

═══════════════════════════════════════════════════════
CATALOGO PRODOTTI SCALA — UNICA FONTE DI VERITÀ
NON inventare funzionalità, prezzi o piani non elencati qui.
NON menzionare MAI: white label, add-on, Enterprise, Creator, Agency, Diamond, Builder, Starter, Leader.

REGOLE ANTI-ALLUCINAZIONE OBBLIGATORIE:
- Se qualcuno chiede di funzionalità che NON sono elencate sotto → rispondi SOLO con cosa È incluso nei piani. MAI confermare funzionalità non elencate.
- Se qualcuno chiede "c'è white label?" → rispondi "Il piano Scale include tutti i 20 verticali, Content Repurposer, utenti illimitati e priority support."
- Se qualcuno chiede "il CRM è un add-on?" → rispondi "Il CRM è incluso in tutti i piani a pagamento, insieme a Process Analyzer, Balance Sheet e Workflow Engine."
- Se qualcuno chiede di funzionalità che NON conosci → rispondi "Ti consiglio di verificare su app.get-scala.com o contattare contact@get-scala.com"
- I piani sono ESATTAMENTE: Growth (€97/mese), Scale (€197/mese). NESSUN ALTRO piano esiste. NON esiste un piano FREE, Starter, Base, Pro, o Enterprise come piano self-service.
- CRM, Process Analyzer, Balance Sheet, Workflow Engine sono INCLUSI in entrambi i piani.
- Add-on disponibili: WhatsApp Connect (€19/mese), Voice (€29/mese), WA Business API (€39/mese), crediti aggiuntivi (€5/1000).
- SARA WhatsApp è inclusa SOLO nel piano SCALE, NON in Growth.
- Le seguenti parole NON devono MAI comparire nelle tue risposte come nomi di piano: FREE, Starter, BASE, PRO, Creator, Agency, Diamond, Builder, Leader, CRM Pro, CRM Enterprise.
═══════════════════════════════════════════════════════

─── SCALA AI OS (app.get-scala.com) — PIANI 2026, ZERO ADD-ON ───
DIFFERENZIAZIONE SOLO SUI LIMITI: tutte le feature sono incluse in tutti i piani paganti.

🌱 GROWTH (€97/mese o €970/anno): tutti e 5 i moduli SCALA Core completi, fino a 5 verticali a scelta, 6 utenti team, 30.000 AI credits/mese. Trial 14 giorni gratis, nessuna carta richiesta. NON include SARA WhatsApp (disponibile come add-on o nel piano Scale).

🚀 SCALE (€197/mese o €1.970/anno): Tutto GROWTH + SARA WhatsApp Assistant 24/7 multilingua (IT/EN/ES/PT), TUTTI i 20 verticali illimitati, Content Repurposer (1 input → 10 output), Workflow Builder avanzato, utenti illimitati, 100.000 AI credits/mese, account manager dedicato, priority support.

Add-on (acquistabili con entrambi i piani): WhatsApp Connect €19/mese, Voice €29/mese, WA Business API €39/mese, crediti aggiuntivi €5/1000.

IMPORTANTE: CRM, Process Analyzer, Balance Sheet, Workflow Engine sono INCLUSI in entrambi i piani. I vecchi nomi BASE/PRO/SARA/FREE come piani non esistono più. Il trial di 14 giorni è disponibile SOLO su GROWTH.

─── S.C.A.L.A. = I 5 MODULI CORE ───
S = Strategy: SWOT, Business Model Canvas, OKR, Porter 5 Forces, Go-to-Market Planner
C = Confirmation: Pilot Center, Balance Sheet Analyzer, Forecasting AI, What-If Simulator, KPI Dashboard
A = Activation: CRM, Pipeline Management, Email Automation, Lead Scoring
L = Leverage: Process Analyzer, SOP Builder, Workflow Engine, Team Performance
A = Acceleration: Academy, Knowledge Base, AI Advisor, Coaching AI

─── AI Content Repurposer (content.get-scala.com) ───
Incluso nel piano SCALE di SCALA. Trasforma 1 contenuto in 10 formati diversi (blog, social, newsletter, video script).

─── 20 VERTICALI ───
AdOS (advertising), AgencyOS (agenzie), BeautyOS (bellezza/SPA), CleanOS (pulizia), DermalyOS (dermatologia), DineOS (ristoranti), FranchiseOS (franchising), LandIQ (costruttori), ServiceOS (facility management), MotorOS (automotive), NetworkOS (network marketing), PraxisOS (studi professionali), ProjectOS (project management), PropertyOS (immobiliare), ReputationOS (reputazione/recensioni), ShopOS (retail), StudioOS (ingegneria/architettura), TenderOS (gare di appalto), TravelOS (turismo), WellnessOS (fitness/benessere)
GROWTH = 5 verticali a scelta completi. SCALE = tutti e 20 completi.

═══════════════════════════════════════
MAPPING PROBLEMA → SOLUZIONE:
═══════════════════════════════════════
Processi/SOP/magazzino/produzione → Process Analyzer (incluso da GROWTH)
Bilancio/KPI/finanza/cash flow/margini → Balance Sheet Analyzer (incluso da GROWTH)
Clienti/vendite/lead/CRM/pipeline → CRM (incluso da GROWTH)
Strategia/crescita/business model → Modulo Strategy (incluso da GROWTH)
Assistente WhatsApp 24/7 → SARA (incluso nel piano SCALE €197/mese, oppure add-on WhatsApp Connect €19/mese)
Contenuti marketing automatici → Content Repurposer (piano SCALE €197/mese)
Legale/commercialisti → PraxisOS (incluso da GROWTH)
Ristorazione → DineOS (incluso da GROWTH)
Estetica/dermatologia → DermalyOS (incluso da GROWTH)
Immobiliare → PropertyOS (incluso da GROWTH)
Automotive → MotorOS (incluso da GROWTH)
Turismo/hotel → TravelOS (incluso da GROWTH)
Agenzie/marketing → AgencyOS (incluso da GROWTH)
Contenuti/social/blog/newsletter → AI Content Repurposer (content.get-scala.com)
Strumenti AI/traduzioni/riassunti/generazione testi → AI Toolkit (toolkit.get-scala.com)
Rete vendita/distributori/MLM/network marketing → NetworkOS (network.get-scala.com)

═══════════════════════════════════════
STRATEGIA DI VENDITA (SALES AGENT MODE):
═══════════════════════════════════════
Sei anche un'agente di vendita consultativa. Il tuo obiettivo e' guidare naturalmente il lead verso l'acquisto.

LEAD SCORING INTERNO (non comunicare all'utente):
• Messaggio generico: +2 punti
• Chiede info su un prodotto specifico: +5 punti
• Chiede prezzo/costo: +15 punti (segnale fortissimo)
• Vuole provare/registrarsi: +18 punti
• Chiede demo: +12 punti
• Menziona urgenza/scadenza: +12 punti
• Confronta con competitor: +8 punti
• Chiede funzionalita' specifiche: +6 punti

QUALIFICAZIONE LEAD (raccogli naturalmente):
• Settore di appartenenza (mapping al verticale giusto)
• Dimensione azienda (solo/micro/small/medium/large)
• Budget indicativo (se emerge dalla conversazione)
• Decision maker? (titolare, manager, dipendente)
• Urgenza (immediata, entro 1 mese, esplorativo)

REGOLE CTA:
• MAI mandare CTA nei primi 3 messaggi — prima profila.
• Dopo il 4° messaggio, se il lead mostra interesse, inserisci UN link pertinente.
• Prezzo chiesto? → Rispondi con valore prima, poi prezzo, poi link pricing.
• Demo chiesta? → Link prenotazione demo.
• Vuole provare? → Link registrazione gratuita.
• MAI piu' di 1 CTA per messaggio.
• MAI ripetere lo stesso CTA in 2 messaggi consecutivi.
• Usa il link del prodotto PIU' PERTINENTE al problema dell'utente.
`;

// ─── Expanded keywords per settore ───
export function detectSector(text: string): string | null {
    const lower = text.toLowerCase();
    const keywords: Record<string, string[]> = {
        legale: [
            'avvocato', 'avvocata', 'studio legale', 'pratiche', 'causa', 'cause', 'tribunale',
            'diritto', 'legale', 'giuridico', 'contratto', 'contratti', 'consulenza legale',
            'codice civile', 'codice penale', 'difesa', 'querela', 'citazione', 'sentenza',
            'mediazione', 'arbitrato', 'notarile', 'notaio', 'procura', 'atto', 'atti',
            'giurisprudenza', 'normativa', 'regolamento', 'gdpr', 'compliance legale',
            'diritto societario', 'fallimento', 'concordato', 'pignoramento', 'esecuzione',
            'eredità', 'successione', 'divorzio', 'separazione', 'affidamento', 'tutela',
            'marchio', 'brevetto', 'proprietà intellettuale', 'copyright', 'illecito',
            'fascicolo', 'fascicoli', 'parcella', 'onorario', 'mandato professionale',
            'bisogno di una consulenza', 'problema con il condominio', 'controversia condominiale',
            // EN
            'lawyer', 'attorney', 'law firm', 'legal advice', 'lawsuit', 'court',
            'i need a lawyer', 'legal consultation', 'solicitor', 'barrister',
            // ES
            'abogado', 'abogada', 'necesito un abogado', 'bufete', 'demanda', 'juicio',
            // DE
            'anwalt', 'rechtsanwalt', 'anwältin', 'ich brauche einen anwalt', 'kanzlei', 'gericht',
            // PT
            'advogado', 'advogada', 'preciso de um advogado', 'escritório de advocacia', 'processo judicial',
        ],
        commercialista: [
            'commercialista', 'fiscale', 'fatture', 'fattura', 'dichiarazione', 'tasse',
            'contabilità', 'bilancio', 'iva', 'irpef', 'ires', 'irap', 'f24',
            'studio commercialista', 'revisore', 'revisione', 'partita iva', 'forfettario',
            'regime', 'redditi', 'unico', '730', 'cud', 'certificazione unica', 'contributi', 'inps',
            'tax return', 'tax returns', 'accountant', 'bookkeeping', 'tax planning',
            'cedolino', 'busta paga', 'paghe', 'tfr', 'liquidazione', 'ammortamento',
            'cespiti', 'nota integrativa', 'registro', 'libro giornale', 'scadenze fiscali',
            'accertamento', 'cartella esattoriale', 'ravvedimento', 'compensazione',
            'cash flow', 'tesoreria', 'budget', 'pianificazione fiscale',
            'holding', 'srl', 'spa', 'snc', 'sas', 'ditta individuale', 'fatturazione elettronica',
        ],
        agenzia: [
            'agenzia', 'comunicazione', 'social media', 'brand', 'creatività',
            'instagram', 'facebook', 'tiktok', 'linkedin', 'youtube', 'twitter',
            'content', 'contenuti', 'copywriting', 'copy', 'grafica', 'design', 'video',
            'campagna', 'campagne', 'advertising', 'adv', 'google ads', 'meta ads',
            'seo', 'sem', 'posizionamento', 'engagement', 'reach', 'impression',
            'influencer', 'creator', 'reels', 'stories', 'podcast', 'newsletter', 'blog',
            'piano editoriale', 'calendario editoriale', 'brief', 'pitch', 'portfolio',
            'identità visiva', 'logo', 'naming', 'payoff', 'claim', 'headline',
            'agenzia di comunicazione', 'agenzia marketing', 'agenzia digitale', 'web agency',
        ],
        marketing: [
            'marketing', 'growth', 'growth hacking', 'lead generation', 'funnel',
            'conversion', 'conversione', 'cro', 'ab test', 'split test',
            'kpi marketing', 'roi', 'roas', 'cac', 'ltv', 'churn', 'retention',
            'email marketing', 'automation marketing', 'hubspot', 'salesforce', 'mailchimp',
            'remarketing', 'retargeting', 'pixel', 'tracking', 'attribution',
            'inbound', 'outbound', 'cold email', 'sales', 'pipeline vendita',
            'buyer persona', 'customer journey', 'touchpoint', 'demand generation',
        ],
        ristorante: [
            'ristorante', 'pizzeria', 'bar', 'cucina', 'menu', 'menù', 'prenotazioni',
            'food', 'cibo', 'chef', 'cuoco', 'sala', 'cameriere', 'tavolo',
            'delivery', 'asporto', 'take away', 'glovo', 'deliveroo', 'justeat', 'uber eats',
            'food cost', 'marginalità', 'coperto', 'scontrino medio', 'ticket medio',
            'fornitori', 'materie prime', 'magazzino cucina', 'inventario cucina', 'haccp',
            'vino', 'carta vini', 'sommelier', 'cocktail', 'barman', 'mixology',
            'brunch', 'aperitivo', 'catering', 'banqueting', 'ristorazione',
            'tripadvisor', 'thefork', 'turni cucina', 'brigata', 'mise en place',
            'prenotazione cena', 'cena romantica', 'prenotare tavolo', 'prenotare ristorante',
            'table for', 'restaurant', 'booking dinner', 'dinner reservation',
            'mesa para', 'restaurante', 'reservar mesa',
            'tisch für', 'reservierung', 'speisekarte',
            'reserva', 'cardápio',
        ],
        dermatologia: [
            'dermatologo', 'dermatologia', 'pelle', 'cute', 'estetica', 'medico estetico',
            'medicina estetica', 'trattamento estetico', 'filler', 'botox', 'laser',
            'peeling', 'acne', 'rughe', 'macchie', 'nei', 'melanoma', 'screening',
            'paziente', 'pazienti', 'ambulatorio', 'clinica estetica', 'studio medico',
            'dermatite', 'eczema', 'psoriasi', 'cosmetico', 'cosmetici',
            'epilazione laser', 'lipofilling', 'biorivitalizzazione',
            'acido ialuronico', 'collagene', 'radiofrequenza', 'crioterapia',
            'tricologia', 'alopecia', 'chirurgia plastica', 'body contouring', 'lifting',
            // EN
            'dermatologist', 'dermatology', 'skin care', 'cosmetic surgery', 'how much does botox cost',
            'botox cost', 'filler cost', 'aesthetic medicine',
            // ES
            'dermatólogo', 'medicina estética', 'cuánto cuesta el botox',
            // PT
            'dermatologista', 'quanto custa o botox', 'medicina estética',
            // DE
            'hautarzt', 'dermatologie', 'ästhetische medizin', 'botox kosten',
        ],
        immobiliare: [
            'immobiliare', 'agenzia immobiliare', 'appartamento', 'villa', 'terreno',
            'vendita immobile', 'affitto', 'locazione', 'compravendita', 'preliminare',
            'compromesso', 'mutuo', 'ipoteca', 'catasto', 'visura', 'planimetria', 'ape',
            'classe energetica', 'condominio', 'amministratore condominiale',
            'agente immobiliare', 'provvigione', 'mandato immobiliare', 'esclusiva immobiliare',
            'home staging', 'valutazione immobile', 'perizia', 'annuncio immobiliare',
            'immobiliare.it', 'idealista', 'subito annunci', 'portale immobiliare',
            'box auto', 'locale commerciale', 'capannone', 'investimento immobiliare',
            'bilocale', 'trilocale', 'quadrilocale', 'monolocale', 'attico', 'mansarda',
            'penthouse', 'loft', 'duplex', 'piano terra', 'ultimo piano',
            'metri quadri', 'cerco casa', 'vendo casa', 'compro casa',
            'wohnung', 'apartamento', 'piso', 'inmueble', 'imóvel',
            // EN
            'apartment', 'flat', 'real estate', 'property', 'house for sale', 'rent apartment',
            'how much is the apartment', 'mortgage', 'estate agent',
            // DE
            'immobilie', 'mietwohnung', 'eigentumswohnung', 'makler',
            // ES
            'inmobiliaria', 'alquiler', 'comprar piso', 'agente inmobiliario',
            // PT
            'imobiliária', 'alugar apartamento', 'corretor de imóveis',
        ],
        automotive: [
            'auto', 'automobile', 'macchina', 'veicolo', 'concessionaria', 'officina',
            'meccanico', 'carrozzeria', 'tagliando', 'revisione auto', 'assicurazione auto',
            'km zero', 'usato auto', 'noleggio auto', 'leasing auto', 'finanziamento auto',
            'motore', 'cambio auto', 'freni', 'gomme', 'pneumatici', 'ricambi auto',
            'elettrica', 'ibrida', 'diesel', 'benzina', 'colonnina ricarica',
            'test drive', 'preventivo auto', 'permuta', 'valutazione usato',
            'garanzia auto', 'manutenzione auto', 'bollo', 'sinistro', 'CSI score',
            'ölwechsel', 'bremsen', 'werkstatt', 'tüv',
            'cambio de aceite', 'taller mecánico', 'revisión coche',
            'oil change', 'car service', 'brake pads',
            'car dealership', 'dealership', 'car dealer', 'auto repair',
            'concesionario', 'concessionário', 'autohaus',
        ],
        turismo: [
            'hotel', 'albergo', 'b&b', 'bed and breakfast', 'agriturismo', 'resort',
            'turismo', 'turista', 'vacanza', 'viaggio',
            'booking', 'prenotazione hotel', 'check-in', 'check-out', 'reception',
            'camera hotel', 'suite', 'colazione hotel', 'all inclusive',
            'tour operator', 'agenzia viaggi', 'guida turistica', 'escursione',
            'revenue management', 'tariffa hotel', 'occupancy', 'adr', 'revpar',
            'channel manager', 'pms hotel', 'housekeeping', 'spa hotel',
            'tripadvisor hotel', 'booking.com', 'airbnb', 'expedia', 'airbnb host',
            'tassa di soggiorno', 'alloggiati web', 'istat turismo', 'mice',
            'camera', 'camera doppia', 'camera singola', 'prenotazione camera',
            'zimmer', 'habitación', 'habitaciones', 'quarto hotel', 'quartos',
            'pacchetti', 'pacchetto weekend', 'weekend disponibili',
            'rooms available', 'available rooms', 'room for',
            'crociera',
        ],
        beauty: [
            'parrucchiere', 'parrucchiera', 'salone bellezza', 'salone di bellezza',
            'estetista', 'centro estetico', 'beauty', 'hair', 'hairstylist',
            'taglio capelli', 'taglio donna', 'taglio uomo', 'piega', 'colore capelli',
            'colorazione', 'meches', 'balayage', 'cheratina', 'extension ciglia',
            'manicure', 'pedicure', 'nail art', 'unghie', 'ceretta', 'depilazione',
            'massaggio estetico', 'trattamento viso', 'pulizia viso', 'make up',
            'laminazione', 'sopracciglia', 'trucco', 'messa in piega',
            'barbiere', 'barber', 'spa estetica', 'centro benessere estetico',
            'haircut', 'corte de pelo', 'corte de cabelo', 'haarschnitt', 'friseur',
        ],
        cleaning: [
            'pulizia', 'pulizie', 'impresa di pulizie', 'servizio pulizia',
            'sanificazione', 'igienizzazione', 'disinfezione', 'lavaggio',
            'pulizia uffici', 'pulizia condominio', 'pulizia industriale',
            'pulizia post cantiere', 'pulizia appartamento', 'pulizia scale',
            'cleaning', 'limpieza', 'limpeza', 'reinigung',
            'bidello', 'housekeeping professionale',
            'impresa pulizie', 'detergenti professionali', 'cera pavimenti',
            'büroreinigung', 'gebäudereinigung', 'putzdienst', 'sauberkeit',
            'limpieza de oficinas', 'limpieza', 'servicio de limpieza',
            'serviço de limpeza',
        ],
        waste: [
            'rifiuti', 'rifiuto', 'raccolta differenziata', 'tari', 'spazzatura',
            'immondizia', 'cassonetto', 'bidone', 'compostaggio', 'riciclaggio',
            'discarica', 'inceneritore', 'termovalorizzatore', 'isola ecologica',
            'ingombranti', 'smaltimento', 'waste', 'residuos', 'abfall',
            'wertstoff', 'plastica riciclabile', 'organico', 'indifferenziato',
            'eco centro', 'centro raccolta', 'raee', 'pile esauste',
            'sperrmüll', 'mülltrennung', 'müllabfuhr', 'entsorgung',
            'basura', 'tasa de basura', 'reciclaje',
            'resíduos', 'resíduos volumosos', 'descartar', 'coleta seletiva',
        ],
        franchise: [
            'franchising', 'franchise', 'affiliazione', 'affiliato', 'rete affiliati',
            'franquicia', 'fee ingresso', 'royalty franchising', 'master franchise',
            'punto vendita affiliato', 'multi sede', 'catena negozi',
            'concept store', 'format replicabile', 'manuale operativo franchising',
            'franquicia', 'franquia',
        ],
        service: [
            'assistenza tecnica', 'manutenzione', 'intervento tecnico', 'riparazione',
            'post vendita', 'post-vendita', 'ticket assistenza', 'help desk',
            'caldaia', 'condizionatore', 'elettricista', 'idraulico', 'installazione',
            'contratto manutenzione', 'contratto assistenza', 'garanzia',
            'field service', 'tecnico', 'intervento', 'rapportino',
            'serviceeinsatz', 'servicio técnico', 'manutenção',
            'calefacción', 'caldera', 'heating', 'boiler', 'reparación',
            'aquecimento', 'aquecedor',
        ],
        wellness: [
            'palestra', 'fitness', 'gym', 'personal trainer', 'allenamento',
            'abbonamento palestra', 'corso fitness', 'pilates', 'yoga', 'crossfit',
            'sala pesi', 'cardio', 'spinning', 'functional training',
            'fitnessstudio', 'gimnasio', 'academia', 'centro sportivo',
            'piscina', 'nuoto', 'wellness', 'benessere', 'spa',
        ],
        network_marketing: [
            'network marketing', 'mlm', 'vendita diretta', 'multi livello',
            'multilivello', 'distributore', 'downline', 'upline',
            'piano compensi', 'rete vendita', 'rete commerciale',
            'provvigioni multilivello', 'guadagno passivo rete',
            'compensation plan', 'direct sales', 'direct selling',
            'plan de compensación', 'venda direta',
        ],
        studio_creativo: [
            'architetto', 'architettura', 'studio architettura', 'interior design',
            'progettazione', 'cantiere', 'rendering', 'ristrutturazione interni',
            'design interni', 'fotografo', 'studio fotografico', 'studio grafico',
            'studio creativo', 'studio design', 'designer freelance',
            'SAL cantiere', 'direzione lavori', 'computo metrico',
        ],
        shop: [
            'negozio', 'punto vendita', 'retail', 'commercio', 'bottega',
            'vendita al dettaglio', 'magazzino', 'inventario', 'pos',
            'e-commerce', 'ecommerce', 'scontrino', 'cassa', 'scaffale',
            'tienda', 'horarios de la tienda', 'loja', 'laden', 'store',
            'prodotto', 'prodotti', 'catalogo', 'vetrina',
            'maglietta', 'pantaloni', 'scarpe', 'abbigliamento', 'vestito', 'vestiti',
            'taglia', 'misura', 'prezzo prodotto', 'quanto costa questo',
            'camicia', 'giacca', 'borsa', 'accessori', 'gioielli',
        ],
        enterprise: [
            'enterprise', 'multinazionale', 'grandi aziende', 'grande azienda',
            'corporation', 'global', 'sla', '99.99',
            'white label', 'self hosted', 'custom development',
            '200 dipendenti', '500 dipendenti', '1000 dipendenti',
            'facility management', 'gestione strutture', 'multi sede', 'multi-sede',
            'group company', 'corporate', 'ERP', 'SAP',
        ],
        solo_sara: [
            'solo sara', 'freelance whatsapp', 'bot whatsapp freelance',
            'assistente whatsapp personale', 'chatbot personale',
        ],
        ortofrutticolo: [
            'ortofrutta', 'ortofrutticolo', 'ortofrutticoli', 'frutta e verdura',
            'frutta fresca', 'verdura fresca', 'grossista frutta', 'ingrosso frutta',
            'mercato ortofrutticolo', 'mercato all\'ingrosso', 'mercato generale',
            'fruttivendolo', 'cassette frutta', 'IV gamma', 'quarta gamma',
            'catena del freddo', 'cold chain', 'food cost frutta',
            'agrumi', 'mele', 'pere', 'pesche', 'fragole', 'kiwi',
            'pomodori', 'insalate', 'zucchine', 'melanzane', 'peperoni',
            'frutta esotica', 'avocado', 'mango', 'ananas',
            'prodotti biologici', 'biologico certificato', 'globalg.a.p',
            'wholesale produce', 'fresh produce', 'fruit wholesale',
            'vegetable wholesale', 'produce distributor', 'produce supplier',
            'obst und gemüse', 'großhandel obst', 'obstgroßhandel',
            'gemüsegroßhandel', 'frischobst', 'frischgemüse',
            'mayorista fruta', 'mayorista verdura', 'hortofrutícola',
            'fruta y verdura', 'frutas y verduras', 'mercado mayorista',
            'atacadista frutas', 'atacadista', 'hortifrutícola', 'frutas e legumes',
            'hortifrúti', 'mercado atacadista', 'frutas e verduras',
        ],
        score: [
            'dati aziendali', 'database aziende', 'company data', 'business intelligence',
            'market research', 'ricerca aziende', 'informazioni commerciali',
            'partita iva azienda', 'score azienda', 'bilancio azienda',
            'dati su un', 'informazioni azienda', 'dati azienda',
        ],
    };

    // Score-based matching: accumulate score per sector, return highest
    const scores: Record<string, number> = {};
    for (const [sector, words] of Object.entries(keywords)) {
        let score = 0;
        for (const w of words) {
            if (w.length <= 3) {
                const regex = new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
                if (regex.test(lower)) score += 2;
            } else if (w.includes(' ')) {
                // Multi-word phrases: substring match
                if (lower.includes(w)) score += 3;
            } else {
                // Single words: space-padded boundary OR substring for long keywords (DE compounds)
                const padded = ` ${lower} `;
                if (padded.includes(` ${w} `) || padded.includes(` ${w},`) || padded.includes(` ${w}.`) || padded.includes(` ${w}?`) || padded.includes(` ${w}!`)) {
                    score += 1;
                } else if (w.length >= 6 && lower.includes(w)) {
                    // Substring match for long keywords (handles German compounds like "büroreinigung")
                    score += 1;
                }
            }
        }
        if (score > 0) scores[sector] = score;
    }

    // Return highest scoring sector (minimum score 1)
    let bestSector: string | null = null;
    let bestScore = 0;
    for (const [sector, score] of Object.entries(scores)) {
        if (score > bestScore) {
            bestScore = score;
            bestSector = sector;
        }
    }
    return bestSector;
}

// ─── Company size detection ───
export function detectCompanySize(text: string): string | null {
    const lower = text.toLowerCase();
    if (/\b(solo|freelanc|autonomo|partita iva|da solo|libero professionista)\b/.test(lower)) return 'solo';
    if (/\b(micro|startup|2[-\s]?3 persone|piccol[oa]|1[-\s]?5 dipendenti)\b/.test(lower)) return 'micro';
    if (/\b(piccola|small|5[-\s]?20 dipendenti|10[-\s]?15|team di)\b/.test(lower)) return 'small';
    if (/\b(media|medium|20[-\s]?100|medie dimensioni|50 dipendenti|strutturata)\b/.test(lower)) return 'medium';
    if (/\b(grande|large|enterprise|multinazionale|oltre 100|200|500|1000 dipendenti)\b/.test(lower)) return 'large';
    return null;
}

// ─── CTA URLs — correct app.get-scala.com paths ───
export function getCTAUrl(sector: string): string {
    const urls: Record<string, string> = {
        legale: 'https://app.get-scala.com/praxisos', commercialista: 'https://app.get-scala.com/praxisos',
        agenzia: 'https://app.get-scala.com/agencyos', marketing: 'https://app.get-scala.com/agencyos',
        ristorante: 'https://app.get-scala.com/dineos',
        dermatologia: 'https://app.get-scala.com/dermalyos',
        immobiliare: 'https://app.get-scala.com/propertyos',
        automotive: 'https://app.get-scala.com/motoros',
        turismo: 'https://app.get-scala.com/travelos',
        general: 'https://app.get-scala.com',
    };
    return urls[sector] || urls.general;
}

export function getCTAMessage(sector: string, ctaType: string = 'general'): string {
    const url = getCTAUrl(sector);
    const names: Record<string, string> = {
        legale: 'PraxisOS', commercialista: 'PraxisOS',
        agenzia: 'AgencyOS', marketing: 'AgencyOS',
        ristorante: 'DineOS', dermatologia: 'DermalyOS',
        immobiliare: 'PropertyOS', automotive: 'MotorOS', turismo: 'TravelOS',
        general: 'SCALA AI OS',
    };
    const name = names[sector] || 'SCALA AI OS';
    const bookingUrl = 'https://calendar.google.com/calendar/appointments/schedules/scala-ai-demo?gv=true';

    const ctas: Record<string, string> = {
        pricing: `\n\nI piani: Growth €97/mese, Scale €197/mese. Vuoi vedere cosa include nel dettaglio? ${url}/pricing`,
        demo: `\n\nSe vuoi, puoi prenotare una demo gratuita di 30 min e vedere ${name} in azione sul tuo caso specifico: ${bookingUrl}`,
        trial: `\n\nPuoi iniziare gratis oggi, senza carta di credito: ${url}`,
        consultation: `\n\nPossiamo fare una call di 30 min per capire insieme la soluzione giusta per te: ${bookingUrl}`,
        general: `\n\nSe ti interessa approfondire, puoi provare ${name} gratis qui: ${url}`,
    };

    return ctas[ctaType] || ctas.general;
}

// ─── Product screenshots / module demos ───
export const MODULE_SCREENSHOTS: Record<string, { image: string; caption: string }> = {
    process: { image: 'process_analyzer.webp', caption: '📸 Ecco come appare il Process Analyzer — puoi mappare i tuoi flussi in pochi click.' },
    strategy: { image: 'strategy_bmc.webp', caption: '📸 Questa è la sezione Strategy con BMC, SWOT e Pareto integrati.' },
    crm: { image: 'crm_dashboard.webp', caption: '📸 Il CRM ti mostra tutti i contatti, lead scoring e automazioni.' },
    balance: { image: 'balance_ai.webp', caption: '📸 Ecco l\'analisi AI del bilancio con benchmark di settore.' },
    pilot: { image: 'pilot_center.webp', caption: '📸 Il Pilot Center ti permette di validare idee in 90 giorni.' },
    activation: { image: 'activation.webp', caption: '📸 Activation: organigramma, North Star e team alignment.' },
};

// ─── SARA Data Entry — Vertical CRUD via WhatsApp ───
// User sends natural language → SARA parses → calls backend API → creates record

export interface DataEntryCommand {
    vertical: string;
    table: string;
    fields: Record<string, string>;
}

export const DATA_ENTRY_PATTERNS: Record<string, { regex: RegExp; table: string; vertical: string; fieldMap: string[] }[]> = {
    immobiliare: [
        { regex: /(?:nuovo|aggiungi|inserisci)\s+immobile[:\s]+(.+)/i, table: 'propertyos_properties', vertical: 'propertyos', fieldMap: ['title'] },
    ],
    automotive: [
        { regex: /(?:nuov[oa]|aggiungi|inserisci)\s+(?:auto|veicolo|macchina)[:\s]+(.+)/i, table: 'motoros_vehicles', vertical: 'motoros', fieldMap: ['description'] },
    ],
    ristorazione: [
        { regex: /(?:nuov[oa]|aggiungi)\s+prenotazione[:\s]+(.+)/i, table: 'dineos_reservations', vertical: 'dineos', fieldMap: ['description'] },
        { regex: /(?:nuovo|aggiungi)\s+piatto[:\s]+(.+)/i, table: 'dineos_menu_items', vertical: 'dineos', fieldMap: ['name'] },
    ],
    dermatologia: [
        { regex: /(?:nuovo|aggiungi)\s+(?:appuntamento|paziente|visita)[:\s]+(.+)/i, table: 'dermalyos_appointments', vertical: 'dermalyos', fieldMap: ['description'] },
    ],
    legale: [
        { regex: /(?:nuov[oa]|aggiungi)\s+(?:causa|fascicolo|pratica)[:\s]+(.+)/i, table: 'praxisos_appointments', vertical: 'praxisos', fieldMap: ['description'] },
    ],
    agenzia: [
        { regex: /(?:nuov[oa]|aggiungi)\s+(?:campagna|commessa|progetto)[:\s]+(.+)/i, table: 'agencyos_campaigns', vertical: 'agencyos', fieldMap: ['name'] },
    ],
    viaggio: [
        { regex: /(?:nuovo|aggiungi)\s+(?:itinerario|viaggio|pacchetto)[:\s]+(.+)/i, table: 'travelos_itineraries', vertical: 'travelos', fieldMap: ['title'] },
    ],
    flotta: [
    ],
    bellezza: [
        { regex: /(?:nuovo|aggiungi)\s+(?:appuntamento|cliente|trattamento)[:\s]+(.+)/i, table: 'beautyos_appointments', vertical: 'beautyos', fieldMap: ['description'] },
    ],
    pulizie: [
        { regex: /(?:nuovo|aggiungi)\s+(?:lavoro|servizio|intervento)[:\s]+(.+)/i, table: 'cleanos_jobs', vertical: 'cleanos', fieldMap: ['description'] },
    ],
    studio: [
        { regex: /(?:nuovo|aggiungi)\s+(?:progetto|SAL|timesheet)[:\s]+(.+)/i, table: 'studioos_projects', vertical: 'studioos', fieldMap: ['name'] },
    ],
    network: [
        { regex: /(?:nuovo|aggiungi)\s+(?:membro|distributore|collaboratore)[:\s]+(.+)/i, table: 'networkos_members', vertical: 'networkos', fieldMap: ['name'] },
    ],
};

export function detectDataEntryIntent(text: string, userSector?: string): { detected: boolean; sector: string; pattern: typeof DATA_ENTRY_PATTERNS[string][0] | null; rawInput: string } {
    // Check all sectors (or prioritize user's sector)
    const sectorsToCheck = userSector ? [userSector, ...Object.keys(DATA_ENTRY_PATTERNS).filter(s => s !== userSector)] : Object.keys(DATA_ENTRY_PATTERNS);

    for (const sector of sectorsToCheck) {
        const patterns = DATA_ENTRY_PATTERNS[sector];
        if (!patterns) continue;
        for (const pattern of patterns) {
            const match = text.match(pattern.regex);
            if (match) {
                return { detected: true, sector, pattern, rawInput: match[1] || text };
            }
        }
    }
    return { detected: false, sector: '', pattern: null, rawInput: text };
}

export function getModuleScreenshot(text: string): { image: string; caption: string } | null {
    const lower = text.toLowerCase();
    if (/\b(process[io]|flusso|workflow|sop|procedur|mappatura|magazzino|produzione|logistica)\b/.test(lower))
        return MODULE_SCREENSHOTS.process;
    if (/\b(strateg|bmc|canvas|swot|pareto|crescita|business model|go.?to.?market)\b/.test(lower))
        return MODULE_SCREENSHOTS.strategy;
    if (/\b(crm|contatt|lead|email|newsletter|prospect|funnel|vendite)\b/.test(lower))
        return MODULE_SCREENSHOTS.crm;
    if (/\b(bilancio|balance|finanzi|budget|conto economico|kpi|cash.?flow|margine)\b/.test(lower))
        return MODULE_SCREENSHOTS.balance;
    if (/\b(pilot|valid|test|esperimento|mvp|idea|lancio|90 giorni)\b/.test(lower))
        return MODULE_SCREENSHOTS.pilot;
    if (/\b(team|organigramma|north star|obiettiv|okr|allineamento)\b/.test(lower))
        return MODULE_SCREENSHOTS.activation;
    return null;
}

// ═══════════════════════════════════════════════════
// Semantic sector detection (P1 fix 2026-04-12)
// ═══════════════════════════════════════════════════
// Keyword matching fails on phrasings like "ho un'attività dove la gente
// dorme" (a hotel) → no "turismo" keyword → wrong persona. We use
// Gemini text-embedding-004 to compute a single vector per sector, then
// classify incoming messages by cosine similarity.
// Cache is persisted so we pay the embedding cost once, not on every start.
// ═══════════════════════════════════════════════════

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { embedChain } from './lib/ai-providers.js';
import { promptDiPacchetto, pacchettiSettori } from './pack-loader.js';

/**
 * Sector prompts no longer live here: they are JSON packs in `packs/`.
 *
 * This constant is still exported because `ai.ts` and `lib/dream-cycle.ts`
 * read it as an object. It has the same shape as before — sector key →
 * Italian text — but the content comes from the loaded packs.
 */
export const SECTOR_PROMPTS: Record<string, string> = new Proxy({} as Record<string, string>, {
    get: (_t, k: string) => promptDiPacchetto('sector', k, 'it'),
    has: (_t, k: string) => k in pacchettiSettori(),
    ownKeys: () => Object.keys(pacchettiSettori()),
    getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }),
});


// Maps 15 SCALA verticals → the sector id expected downstream.
// For now, several verticals map to the existing legacy sectors above
// (legale/commercialista share → PraxisOS, etc.). Multi-sector verticals
// get their own id so SECTOR_PROMPTS lookups still work via the fallback.
export const SECTOR_DESCRIPTIONS: Record<string, string> = {
    immobiliare: "Vendo, affitto o gestisco immobili, case, appartamenti, locazioni, agenzia immobiliare (PropertyOS)",
    beauty: "Gestisco un salone di bellezza, parrucchiere, estetista, spa, centro estetico (BeautyOS)",
    ristorante: "Gestisco un ristorante, bar, pizzeria, caffetteria, locale food, pub (DineOS)",
    automotive: "Vendo auto, gestisco officina meccanica, carrozzeria, concessionaria (MotorOS)",
    turismo: "Organizzo viaggi, tour, pacchetti, hotel, B&B, alloggi turistici, albergo, struttura ricettiva (TravelOS)",
    legale: "Sono avvocato, studio legale, contenzioso, pratiche giudiziarie (PraxisOS)",
    commercialista: "Sono commercialista, CAF, consulente fiscale, studio contabile (PraxisOS)",
    studio: "Sono fotografo, architetto, designer, studio creativo (StudioOS)",
    pulizie: "Gestisco un'impresa di pulizie, sanificazione, servizi di cleaning (CleanOS)",
    network: "Faccio network marketing, MLM, distributore multilivello, vendita diretta (NetworkOS)",
    agenzia: "Sono un'agenzia di marketing, comunicazione, digital, web agency (AgencyOS)",
    dermatologia: "Sono dermatologo, medico estetico, clinica estetica medica (DermalyOS)",
};

const CACHE_FILE = resolve(process.env.CACHE_DIR || '/tmp', '.sector_embeddings.json');
const SIMILARITY_THRESHOLD = 0.6;

interface SectorEmbeddingCache {
    model: string;
    // Hash of descriptions so we invalidate if text changes.
    descriptionsHash: string;
    embeddings: Record<string, number[]>;
}

let sectorEmbeddings: Record<string, number[]> = {};
let embeddingsReady = false;

function hashDescriptions(): string {
    // Tiny non-crypto hash — only needs to detect description edits.
    const s = Object.entries(SECTOR_DESCRIPTIONS).map(([k, v]) => `${k}:${v}`).join('|');
    let h = 0;
    for (let i = 0; i < s.length; i++) {
        h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    }
    return h.toString(16);
}

/**
 * Fetch embedding using the unified embedChain (Ollama → Mistral).
 * Returns raw number[] or null on failure.
 */
async function fetchEmbedding(text: string): Promise<number[] | null> {
    try {
        const { vector } = await embedChain(text);
        return vector;
    } catch {
        return null;
    }
}

function cosine(a: number[], b: number[]): number {
    let dot = 0, na = 0, nb = 0;
    const len = Math.min(a.length, b.length);
    for (let i = 0; i < len; i++) {
        dot += a[i] * b[i];
        na += a[i] * a[i];
        nb += b[i] * b[i];
    }
    if (na === 0 || nb === 0) return 0;
    return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * Compute (or load from cache) the embedding for each sector description.
 * Safe to call multiple times — becomes a no-op after the first successful load.
 * Retries up to 6 times (10s apart) to wait for Ollama readiness at boot.
 */
export async function initSectorEmbeddings(): Promise<void> {
    if (embeddingsReady && Object.keys(sectorEmbeddings).length > 0) return;

    const currentHash = hashDescriptions();
    const modelTag = 'embedchain-1024d';

    // Try cache first
    if (existsSync(CACHE_FILE)) {
        try {
            const raw = readFileSync(CACHE_FILE, 'utf8');
            const cached = JSON.parse(raw) as SectorEmbeddingCache;
            if (cached.model === modelTag && cached.descriptionsHash === currentHash) {
                sectorEmbeddings = cached.embeddings;
                embeddingsReady = true;
                console.log(`[SECTORS] loaded ${Object.keys(sectorEmbeddings).length} embeddings from cache`);
                return;
            }
            console.log('[SECTORS] cache invalid (model or descriptions changed) — refetching');
        } catch {
            // Fall through to refetch.
        }
    }

    // Retry loop: wait for Ollama to be ready (max 60s = 6 attempts * 10s)
    for (let attempt = 0; attempt < 6; attempt++) {
        try {
            // Test embed to see if any provider is available
            const test = await fetchEmbedding('test');
            if (!test) {
                throw new Error('fetchEmbedding returned null');
            }

            // Provider is available — embed all sectors
            const fresh: Record<string, number[]> = {};
            for (const [sector, desc] of Object.entries(SECTOR_DESCRIPTIONS)) {
                const v = await fetchEmbedding(desc);
                if (v) fresh[sector] = v;
                else console.warn(`[SECTORS] failed to embed sector="${sector}"`);
            }

            if (Object.keys(fresh).length === 0) {
                console.warn('[SECTORS] no embeddings fetched — semantic detection disabled, keyword fallback only');
                return;
            }

            sectorEmbeddings = fresh;
            embeddingsReady = true;

            try {
                const cache: SectorEmbeddingCache = {
                    model: modelTag,
                    descriptionsHash: currentHash,
                    embeddings: fresh,
                };
                writeFileSync(CACHE_FILE, JSON.stringify(cache), 'utf8');
                console.log(`[SECTORS] cached ${Object.keys(fresh).length} embeddings to disk`);
            } catch (err: any) {
                console.warn('[SECTORS] could not write cache file:', err.message);
            }

            console.log(`[SECTORS] ${Object.keys(sectorEmbeddings).length} sectors embedded successfully`);
            return;
        } catch (e: any) {
            console.log(`[SECTORS] Embed attempt ${attempt + 1}/6 failed (${e?.message || 'unknown'}), retrying in 10s...`);
            await new Promise(r => setTimeout(r, 10000));
        }
    }

    console.log('[SECTORS] All embed attempts failed — keyword fallback only');
}

/**
 * Semantic sector detection. Tries embedding-based classification first;
 * falls back to keyword matching; then to null.
 * Returns the sector id that the rest of the pipeline understands.
 */
export async function detectSectorSemantic(text: string): Promise<string | null> {
    // Keyword match is fast and high-precision — prefer it when it agrees.
    const keywordHit = detectSector(text);

    if (!embeddingsReady || Object.keys(sectorEmbeddings).length === 0) {
        return keywordHit; // embeddings unavailable
    }
    if (!text || text.trim().length < 4) {
        return keywordHit;
    }

    const queryVec = await fetchEmbedding(text);
    if (!queryVec) return keywordHit;

    let best: { sector: string; score: number } | null = null;
    for (const [sector, vec] of Object.entries(sectorEmbeddings)) {
        const score = cosine(queryVec, vec);
        if (!best || score > best.score) best = { sector, score };
    }

    if (best && best.score >= SIMILARITY_THRESHOLD) {
        return best.sector;
    }

    // Low confidence → fall back to keyword hit, else null (caller treats as generic SMB).
    return keywordHit;
}

