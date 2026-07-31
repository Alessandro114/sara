// ═══════════════════════════════════════════════════
// S.A.R.A. — Tool Definitions (function calling / anti-hallucination)
// Added: 2026-04-22
// ═══════════════════════════════════════════════════
// Instead of SARA inventing prices/availability/certifications,
// she calls a "tool" which queries real DB data.
// If the tool fails or has no data, SARA responds with the
// escalation fallback ("Lasciami verificare con il team") instead
// of hallucinating.
//
// Architecture:
//  - SaraTool: definition of a callable function
//  - SARA_TOOLS: record of sector → tool list
//  - toolCallResult(): simulate tool call — returns real data or null
//  - formatToolResult(): turn tool result into SARA-readable context
// ═══════════════════════════════════════════════════

export interface SaraTool {
    name: string;
    description: string;
    params: string[];
    /** Whether this tool requires a live DB query (vs. static info) */
    requiresDB?: boolean;
}

export const SARA_TOOLS: Record<string, SaraTool[]> = {

    travel: [
        {
            name: 'check_availability',
            description: 'Verifica disponibilità camere/struttura per date e numero ospiti',
            params: ['check_in', 'check_out', 'guests'],
            requiresDB: true,
        },
        {
            name: 'get_rate',
            description: 'Ottieni tariffa per camera/tipologia e periodo',
            params: ['room_type', 'check_in', 'check_out'],
            requiresDB: true,
        },
        {
            name: 'book_consultation',
            description: 'Prenota chiamata con il team della struttura',
            params: ['name', 'phone', 'preferred_date', 'notes'],
            requiresDB: false,
        },
        {
            name: 'get_services',
            description: 'Lista servizi disponibili nella struttura (spa, parcheggio, colazione, etc.)',
            params: [],
            requiresDB: true,
        },
    ],

    beauty: [
        {
            name: 'book_appointment',
            description: 'Prenota un trattamento estetico',
            params: ['treatment', 'preferred_date', 'preferred_time', 'name', 'phone'],
            requiresDB: true,
        },
        {
            name: 'get_price_list',
            description: 'Ottieni listino prezzi per categoria di trattamenti',
            params: ['category'],
            requiresDB: true,
        },
        {
            name: 'check_availability',
            description: 'Verifica disponibilità cabine per data e orario',
            params: ['date', 'time', 'treatment'],
            requiresDB: true,
        },
        {
            name: 'get_treatments',
            description: 'Lista trattamenti disponibili nel centro',
            params: ['category'],
            requiresDB: true,
        },
    ],

    clean: [
        {
            name: 'request_quote',
            description: 'Richiedi preventivo per servizio di pulizia',
            params: ['service_type', 'address', 'surface_sqm', 'frequency', 'name', 'phone'],
            requiresDB: false,
        },
        {
            name: 'check_availability',
            description: 'Verifica disponibilità squadre per data e tipo intervento',
            params: ['date', 'service_type', 'address'],
            requiresDB: true,
        },
        {
            name: 'get_certifications',
            description: 'Lista certificazioni aziendali (ISO, HACCP, etc.)',
            params: [],
            requiresDB: true,
        },
        {
            name: 'book_inspection',
            description: 'Prenota sopralluogo gratuito per preventivo',
            params: ['name', 'phone', 'address', 'preferred_date'],
            requiresDB: false,
        },
    ],

    dermaly: [
        {
            name: 'book_consultation',
            description: 'Prenota visita/consulenza medica',
            params: ['treatment_interest', 'preferred_date', 'preferred_time', 'name', 'phone'],
            requiresDB: true,
        },
        {
            name: 'get_treatments',
            description: 'Lista trattamenti medico-estetici disponibili',
            params: ['area'],
            requiresDB: true,
        },
        {
            name: 'check_availability',
            description: 'Verifica disponibilità agenda medica per data',
            params: ['date', 'time', 'treatment_type'],
            requiresDB: true,
        },
        {
            name: 'get_price_list',
            description: 'Ottieni listino prezzi trattamenti (solo se disponibile pubblicamente)',
            params: ['treatment'],
            requiresDB: true,
        },
    ],

    dine: [
        {
            name: 'book_table',
            description: 'Prenota un tavolo al ristorante',
            params: ['date', 'time', 'guests', 'name', 'phone', 'notes'],
            requiresDB: true,
        },
        {
            name: 'check_availability',
            description: 'Verifica disponibilità tavoli per data, ora e numero coperti',
            params: ['date', 'time', 'guests'],
            requiresDB: true,
        },
        {
            name: 'get_menu',
            description: 'Ottieni menu attuale o per categoria (antipasti, primi, secondi, dolci)',
            params: ['category'],
            requiresDB: true,
        },
        {
            name: 'get_allergens',
            description: 'Verifica allergeni per piatto specifico',
            params: ['dish_name'],
            requiresDB: true,
        },
    ],

    motor: [
        {
            name: 'check_stock',
            description: 'Verifica disponibilità veicolo per modello, alimentazione, colore',
            params: ['brand', 'model', 'fuel_type', 'color'],
            requiresDB: true,
        },
        {
            name: 'get_quote',
            description: 'Ottieni preventivo veicolo con eventuali promozioni attive',
            params: ['brand', 'model', 'trim', 'trade_in'],
            requiresDB: true,
        },
        {
            name: 'book_test_drive',
            description: 'Prenota un test drive',
            params: ['brand', 'model', 'preferred_date', 'name', 'phone'],
            requiresDB: false,
        },
        {
            name: 'book_service',
            description: 'Prenota intervento officina (tagliando, revisione, riparazione)',
            params: ['service_type', 'vehicle', 'preferred_date', 'name', 'phone'],
            requiresDB: true,
        },
        {
            name: 'get_trade_in_estimate',
            description: 'Prenota valutazione usato/permuta',
            params: ['brand', 'model', 'year', 'km', 'name', 'phone'],
            requiresDB: false,
        },
    ],

    network: [
        {
            name: 'get_compensation_plan',
            description: 'Informazioni sul piano compensi (generale, non promesse di guadagno)',
            params: ['rank'],
            requiresDB: true,
        },
        {
            name: 'get_products',
            description: 'Lista prodotti disponibili per categoria',
            params: ['category'],
            requiresDB: true,
        },
        {
            name: 'register_lead',
            description: 'Registra interesse di un nuovo potenziale distributore',
            params: ['name', 'phone', 'city', 'interest'],
            requiresDB: false,
        },
        {
            name: 'book_presentation',
            description: 'Prenota presentazione del piano business',
            params: ['name', 'phone', 'preferred_date'],
            requiresDB: false,
        },
    ],

    praxis: [
        {
            name: 'book_appointment',
            description: 'Prenota appuntamento con professionista dello studio',
            params: ['matter_type', 'preferred_date', 'preferred_time', 'name', 'phone'],
            requiresDB: true,
        },
        {
            name: 'check_availability',
            description: 'Verifica disponibilità agenda professionista',
            params: ['date', 'time', 'professional'],
            requiresDB: true,
        },
        {
            name: 'get_fee_estimate',
            description: 'Richiedi stima onorari per tipo di pratica',
            params: ['matter_type', 'complexity'],
            requiresDB: false,
        },
        {
            name: 'get_team',
            description: 'Lista professionisti dello studio e specializzazioni',
            params: [],
            requiresDB: true,
        },
    ],

    property: [
        {
            name: 'search_listings',
            description: 'Cerca immobili per zona, tipo, prezzo, superficie',
            params: ['city', 'zone', 'type', 'min_price', 'max_price', 'min_sqm', 'max_sqm'],
            requiresDB: true,
        },
        {
            name: 'book_visit',
            description: 'Prenota visita immobile',
            params: ['listing_id', 'preferred_date', 'preferred_time', 'name', 'phone'],
            requiresDB: true,
        },
        {
            name: 'request_valuation',
            description: 'Prenota valutazione gratuita immobile',
            params: ['address', 'type', 'sqm', 'name', 'phone'],
            requiresDB: false,
        },
        {
            name: 'get_listing_detail',
            description: 'Ottieni dettagli completi di un immobile (superficie, piano, classe energetica, etc.)',
            params: ['listing_id'],
            requiresDB: true,
        },
    ],

    studio: [
        {
            name: 'generate_sal',
            description: 'Genera report SAL (Stato Avanzamento Lavori) in PDF per un progetto',
            params: ['project_name'],
            requiresDB: true,
        },
        {
            name: 'parse_bando',
            description: 'Analizza un bando di gara PDF ed estrai scadenze, requisiti, documenti richiesti',
            params: ['file_url'],
            requiresDB: true,
        },
        {
            name: 'checklist_gara',
            description: 'Verifica completezza documentazione per una gara: documenti richiesti vs caricati',
            params: ['project_name'],
            requiresDB: true,
        },
        {
            name: 'scadenze_gare',
            description: 'Mostra scadenze gare imminenti con stato completezza documentazione',
            params: ['days_ahead'],
            requiresDB: true,
        },
        {
            name: 'request_quote',
            description: 'Richiedi preventivo per servizio creativo',
            params: ['service_type', 'description', 'deadline', 'name', 'phone'],
            requiresDB: false,
        },
        {
            name: 'book_briefing',
            description: 'Prenota sessione di briefing gratuita',
            params: ['project_type', 'preferred_date', 'name', 'phone'],
            requiresDB: false,
        },
        {
            name: 'get_portfolio',
            description: 'Richiedi portfolio lavori per categoria/settore',
            params: ['category', 'sector'],
            requiresDB: true,
        },
        {
            name: 'check_availability',
            description: 'Verifica disponibilità team per data di inizio progetto',
            params: ['start_date', 'project_type'],
            requiresDB: true,
        },
    ],

    agency: [
        {
            name: 'request_audit',
            description: 'Richiedi audit gratuito marketing/SEO/social',
            params: ['audit_type', 'website', 'name', 'phone'],
            requiresDB: false,
        },
        {
            name: 'get_case_studies',
            description: 'Ottieni case study per settore e tipo di servizio',
            params: ['sector', 'service_type'],
            requiresDB: true,
        },
        {
            name: 'request_quote',
            description: 'Richiedi preventivo per servizio marketing',
            params: ['service_type', 'objectives', 'budget_range', 'name', 'phone'],
            requiresDB: false,
        },
        {
            name: 'book_strategy_call',
            description: 'Prenota call strategica con il team',
            params: ['objectives', 'preferred_date', 'name', 'phone'],
            requiresDB: false,
        },
    ],

    shop: [
        {
            name: 'search_product',
            description: 'Cerca prodotti per nome, categoria o parola chiave',
            params: ['query', 'category'],
            requiresDB: true,
        },
        {
            name: 'check_stock_shop',
            description: 'Verifica disponibilità prodotto per SKU o nome',
            params: ['product_name', 'sku'],
            requiresDB: true,
        },
        {
            name: 'reserve_product',
            description: 'Prenota/riserva un prodotto (quantità, dati cliente)',
            params: ['product_name', 'sku', 'quantity', 'name', 'phone'],
            requiresDB: true,
        },
        {
            name: 'request_quote',
            description: 'Richiedi preventivo per ordine personalizzato o all\'ingrosso',
            params: ['product_name', 'quantity', 'name', 'phone'],
            requiresDB: false,
        },
    ],

    wellness: [
        {
            name: 'check_schedule',
            description: 'Consulta il calendario lezioni/classi per giorno o tipologia',
            params: ['class_name', 'day'],
            requiresDB: true,
        },
        {
            name: 'book_class',
            description: 'Prenota una lezione o classe',
            params: ['class_name', 'date', 'time', 'name', 'phone'],
            requiresDB: true,
        },
        {
            name: 'check_membership',
            description: 'Verifica stato abbonamento e scadenza per numero di telefono',
            params: ['phone'],
            requiresDB: true,
        },
        {
            name: 'book_consultation',
            description: 'Prenota consulenza con trainer o nutrizionista',
            params: ['name', 'phone', 'preferred_date', 'notes'],
            requiresDB: false,
        },
    ],

    franchise: [
        {
            name: 'get_franchise_info',
            description: 'Informazioni generali sul franchising (investimento, royalty, supporto)',
            params: [],
            requiresDB: false,
        },
        {
            name: 'request_franchise_kit',
            description: 'Richiedi il kit informativo franchising completo',
            params: ['name', 'phone', 'city'],
            requiresDB: false,
        },
        {
            name: 'book_presentation',
            description: 'Prenota presentazione del piano franchising',
            params: ['name', 'phone', 'preferred_date'],
            requiresDB: false,
        },
        {
            name: 'register_lead',
            description: 'Registra interesse per affiliazione franchising',
            params: ['name', 'phone', 'city', 'budget'],
            requiresDB: false,
        },
    ],

    reputation: [
        {
            name: 'get_reputation_report',
            description: 'Richiedi report reputazione online per brand/azienda',
            params: ['brand'],
            requiresDB: false,
        },
        {
            name: 'request_reputation_audit',
            description: 'Prenota audit reputazione gratuito',
            params: ['brand', 'website', 'name', 'phone'],
            requiresDB: false,
        },
        {
            name: 'book_strategy_call',
            description: 'Prenota call strategica per piano di reputazione',
            params: ['objectives', 'preferred_date', 'name', 'phone'],
            requiresDB: false,
        },
    ],

    project: [
        {
            name: 'get_project_status',
            description: 'Verifica stato avanzamento progetto per ID o nome',
            params: ['project_id', 'project_name'],
            requiresDB: true,
        },
        {
            name: 'request_quote',
            description: 'Richiedi preventivo per nuovo progetto',
            params: ['service_type', 'description', 'deadline', 'name', 'phone'],
            requiresDB: false,
        },
        {
            name: 'book_briefing',
            description: 'Prenota sessione di briefing progetto',
            params: ['project_type', 'preferred_date', 'name', 'phone'],
            requiresDB: false,
        },
    ],

    ad: [
        {
            name: 'get_ad_performance',
            description: 'Consulta performance campagne pubblicitarie attive',
            params: [],
            requiresDB: true,
        },
        {
            name: 'request_audit',
            description: 'Richiedi audit gratuito delle campagne ads',
            params: ['audit_type', 'website', 'name', 'phone'],
            requiresDB: false,
        },
        {
            name: 'book_strategy_call',
            description: 'Prenota call per strategia campagne advertising',
            params: ['objectives', 'preferred_date', 'name', 'phone'],
            requiresDB: false,
        },
    ],

    service: [
        {
            name: 'create_ticket',
            description: 'Apri ticket di supporto/manutenzione (guasto, intervento, segnalazione)',
            params: ['title', 'description', 'priority', 'location', 'name', 'phone'],
            requiresDB: true,
        },
        {
            name: 'check_asset_status',
            description: 'Verifica stato asset o ticket aperto per ID o nome',
            params: ['asset_name', 'asset_id', 'location'],
            requiresDB: true,
        },
        {
            name: 'book_inspection',
            description: 'Prenota sopralluogo tecnico o ispezione',
            params: ['name', 'phone', 'address', 'preferred_date'],
            requiresDB: false,
        },
        {
            name: 'request_quote',
            description: 'Richiedi preventivo per servizio di manutenzione o facility',
            params: ['service_type', 'address', 'name', 'phone'],
            requiresDB: false,
        },
    ],

    general: [
        {
            name: 'get_platform_info',
            description: 'Ottieni informazioni certificate su SCALA AI OS (piani, funzionalità, verticali)',
            params: ['topic'],
            requiresDB: false,
        },
        {
            name: 'book_demo',
            description: 'Prenota demo gratuita di SCALA AI OS',
            params: ['sector', 'preferred_date', 'name', 'phone'],
            requiresDB: false,
        },
        {
            name: 'start_trial',
            description: 'Avvia trial gratuito 14 giorni su SCALA',
            params: ['plan', 'email'],
            requiresDB: false,
        },
        {
            name: 'contact_team',
            description: 'Metti in contatto con il team dedicato SCALA',
            params: ['name', 'phone', 'message'],
            requiresDB: false,
        },
    ],

    landiq: [
        {
            name: 'start_feasibility_analysis',
            description: 'Avvia analisi fattibilità LandIQ per un terreno o immobile',
            params: ['address', 'city', 'sqm', 'asking_price', 'target_use'],
            requiresDB: false,
        },
        {
            name: 'get_omi_values',
            description: 'Recupera quotazioni OMI per zona e categoria catastale',
            params: ['city', 'zone_omi', 'category'],
            requiresDB: false,
        },
        {
            name: 'check_urban_constraints',
            description: 'Verifica vincoli urbanistici PRG, PAI, SITAP per un indirizzo',
            params: ['address', 'city', 'province'],
            requiresDB: false,
        },
        {
            name: 'search_auctions',
            description: 'Cerca aste immobiliari PVP per zona e budget',
            params: ['city', 'province', 'max_price', 'property_type'],
            requiresDB: false,
        },
        {
            name: 'collect_investment_interest',
            description: 'Raccoglie interesse per investimento immobiliare e passa al team',
            params: ['name', 'phone', 'budget', 'target_zone', 'investment_type'],
            requiresDB: false,
        },
    ],
};

// ─── Sector key normalizer ───────────────────────────────────────────────
// Maps legacy sector ids to the SARA_TOOLS keys above.
const SECTOR_TO_TOOLS_KEY: Record<string, string> = {
    turismo:        'travel',
    beauty:         'beauty',
    bellezza:       'beauty',
    pulizie:        'clean',
    clean:          'clean',
    dermatologia:   'dermaly',
    dermaly:        'dermaly',
    ristorante:     'dine',
    dine:           'dine',
    automotive:     'motor',
    motor:          'motor',
    network:        'network',
    legale:         'praxis',
    commercialista: 'praxis',
    praxis:         'praxis',
    immobiliare:    'property',
    property:       'property',
    studio:         'studio',
    studioos:       'studio',
    agenzia:        'agency',
    marketing:      'agency',
    agency:         'agency',
    general:        'general',
    scala_user:     'general',
    landiq:         'landiq',
    terreni:        'landiq',
    investimento:   'landiq',
    costruttore:    'landiq',
    builder:        'landiq',
    // ShopOS
    shop:           'shop',
    negozio:        'shop',
    ecommerce:      'shop',
    retail:         'shop',
    // WellnessOS
    wellness:       'wellness',
    palestra:       'wellness',
    fitness:        'wellness',
    pilates:        'wellness',
    yoga:           'wellness',
    // FranchiseOS
    franchise:      'franchise',
    franchising:    'franchise',
    affiliazione:   'franchise',
    // ReputationOS
    reputation:     'reputation',
    reputazione:    'reputation',
    // ProjectOS
    project:        'project',
    progetto:       'project',
    // AdOS
    ad:             'ad',
    ads:            'ad',
    advertising:    'ad',
    // ServiceOS / FacilityOS
    service:        'service',
    facility:       'service',
    manutenzione:   'service',
    facilitoos:     'service',
    markasos:       'service',
};

/**
 * Get the tool list for a given sector key.
 * Falls back to 'general' tools if sector unknown.
 */
export function getSectorTools(sector: string): SaraTool[] {
    const key = SECTOR_TO_TOOLS_KEY[sector] || 'general';
    return SARA_TOOLS[key] || SARA_TOOLS.general;
}

/**
 * Build a tool context snippet for injection into the system prompt.
 * Lists the available tools so the LLM knows what to call instead of inventing.
 */
export function buildToolContextSnippet(sector: string): string {
    const tools = getSectorTools(sector);
    if (tools.length === 0) return '';

    const lines = tools.map(t =>
        `- ${t.name}(${t.params.join(', ')}): ${t.description}`
    );

    return `[STRUMENTI DISPONIBILI — CHIAMA questi tool per azioni reali]
${lines.join('\n')}

REGOLA AGENTICA: Quando l'utente chiede qualcosa che corrisponde a uno di questi strumenti (prenotazioni, disponibilita, prezzi, menu, appuntamenti), DEVI chiamare il tool corrispondente usando function calling. NON inventare dati. NON dire "verifico con il team" se hai il tool disponibile — USALO. Se il tool fallisce, allora offri di mettere in contatto con il team.`;
}

/**
 * Format a tool result (from DB or static data) as SARA-readable context.
 * Returns null if result is empty/null — caller should trigger escalation.
 */
export function formatToolResult(toolName: string, result: Record<string, unknown> | null): string | null {
    if (!result || Object.keys(result).length === 0) return null;
    return `[Risultato ${toolName}]: ${JSON.stringify(result)}`;
}
