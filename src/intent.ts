// ═══════════════════════════════════════════════════
// SCALA WhatsApp Bot — Intent Scoring Engine (v5)
// ═══════════════════════════════════════════════════
// Detects buying signals in real-time and scores them.
// Higher scores = closer to purchase decision.
// ═══════════════════════════════════════════════════

export type IntentType = 'pricing' | 'demo' | 'trial' | 'comparison' | 'urgency' | 'objection' | 'feature' | 'general' | 'help_module' | 'create_data' | 'analyze';

export interface IntentSignal {
    type: IntentType;
    score: number;       // Points to add to lead_score
    ctaType: string;     // Which micro-CTA to show
    confidence: number;  // 0-1
}

// ─── High-intent buying signals ───
const BUYING_SIGNALS: Array<{ pattern: RegExp; type: IntentType; score: number; ctaType: string }> = [
    // PRICING — strongest signal
    { pattern: /\b(quanto costa|prezzo|costo|tariff[ae]|listino|pricing|abbonamento|piano|piani|mensile|annuale|sconto|offerta|promozione)\b/i, type: 'pricing', score: 15, ctaType: 'pricing' },
    { pattern: /\b(budget|investimento|spesa|conveniente|economico|gratis|gratuito|free trial)\b/i, type: 'pricing', score: 10, ctaType: 'pricing' },

    // DEMO — wants to see it
    { pattern: /\b(demo|mostrami|far[me]i vedere|come funziona|video|tutorial|provare|prova|test|vedere)\b/i, type: 'demo', score: 12, ctaType: 'demo' },
    { pattern: /\b(come si usa|come lo uso|interfaccia|schermata|screenshot)\b/i, type: 'demo', score: 10, ctaType: 'demo' },

    // TRIAL — ready to try
    { pattern: /\b(prova gratuita|free trial|provare gratis|attivare|attivazione|registr|iscri[vz]|sign.?up|iniziare|cominciare)\b/i, type: 'trial', score: 18, ctaType: 'trial' },
    { pattern: /\b(come mi registro|come faccio a provarlo|posso provarlo|vorrei provarlo|mi interessa)\b/i, type: 'trial', score: 15, ctaType: 'trial' },

    // COMPARISON — evaluating
    { pattern: /\b(rispetto a|confronto|alternativ[ae]|competitor|meglio di|differenz[ae]|vs|versus|paragonato)\b/i, type: 'comparison', score: 8, ctaType: 'demo' },

    // URGENCY — needs it now
    { pattern: /\b(urgente|subito|immediatamente|al più presto|ho bisogno ora|ho fretta|domani|entro|scadenza)\b/i, type: 'urgency', score: 12, ctaType: 'trial' },

    // FEATURE — specific need
    { pattern: /\b(funzionalità|modulo|integra[rz]|api|automazi|workflow|crm|dashboard|report|analisi)\b/i, type: 'feature', score: 6, ctaType: 'demo' },
    { pattern: /\b(fattur|billing|pagament|team|collabor|notific|alert|monitor|track)\b/i, type: 'feature', score: 5, ctaType: 'demo' },

    // OBJECTION — needs reassurance
    { pattern: /\b(non sono sicuro|dubbio|perpless[oa]|preoccupat[oa]|rischio|complesso|complicato|difficile|tempo|impegno)\b/i, type: 'objection', score: 3, ctaType: 'consultation' },
    { pattern: /\b(sicurezza|dati|privacy|gdpr|garanzia|rimborso|disdetta|cancell)\b/i, type: 'objection', score: 4, ctaType: 'consultation' },

    // HELP_MODULE — user asking how to use a SCALA module
    { pattern: /\b(come si usa|come faccio|come creo|come imposto|come aggiungo|come funziona il|come funziona la|dove trovo|come carico|guidami|aiutami a|spiegami come)\b/i, type: 'help_module', score: 8, ctaType: 'general' },
    { pattern: /\b(bmc|swot|pareto|porter|okr|north star|process analyzer|balance sheet|pilot|crm|pipeline|knowledge base|ai advisor|ai coach|roadmap)\b/i, type: 'help_module', score: 10, ctaType: 'general' },
    { pattern: /\b(praxisos|agencyos|dineos|dermalyos|propertyos|motoros|travelos|networkos|studioos)\b/i, type: 'help_module', score: 12, ctaType: 'general' },
    { pattern: /\b(nella piattaforma|su scala|in scala|sulla piattaforma|il modulo|la sezione|dal menu)\b/i, type: 'help_module', score: 6, ctaType: 'general' },

    // CREATE_DATA — user wants to create/add something via voice command
    { pattern: /\b(inserisci|crea un|aggiungi un|registra|prenota|schedula|imposta|configura|nuovo contatto|nuova pratica|nuovo progetto)\b/i, type: 'create_data', score: 8, ctaType: 'general' },
    { pattern: /\b(aggiungi.*appuntamento|crea.*evento|inserisci.*sop|aggiungi.*contatto|crea.*pratica)\b/i, type: 'create_data', score: 12, ctaType: 'general' },

    // ANALYZE — user wants AI analysis
    { pattern: /\b(analizza|analisi|analizzare|valuta|valutazione|confronta|benchmark|forecast|previsione|simula|scenario)\b/i, type: 'analyze', score: 8, ctaType: 'general' },
    { pattern: /\b(analizza.*bilancio|analisi.*processo|valuta.*immobile|analizza.*menu|analizza.*competitor)\b/i, type: 'analyze', score: 12, ctaType: 'general' },
];

/**
 * Analyze a message for buying intent signals.
 * Returns all detected signals sorted by score.
 */
export function detectIntent(text: string): IntentSignal[] {
    const signals: IntentSignal[] = [];

    for (const signal of BUYING_SIGNALS) {
        const match = signal.pattern.test(text);
        if (match) {
            signals.push({
                type: signal.type,
                score: signal.score,
                ctaType: signal.ctaType,
                confidence: signal.score >= 12 ? 0.9 : signal.score >= 8 ? 0.7 : 0.5,
            });
        }
    }

    return signals.sort((a, b) => b.score - a.score);
}

/**
 * Get the dominant intent type from detected signals.
 */
export function getDominantIntent(signals: IntentSignal[]): IntentType {
    if (signals.length === 0) return 'general';
    return signals[0].type;
}

/**
 * Calculate total intent score from detected signals.
 */
export function getIntentScore(signals: IntentSignal[]): number {
    return signals.reduce((sum, s) => sum + s.score, 0);
}

/**
 * Get the best CTA type based on detected intent.
 */
export function getBestCTAType(signals: IntentSignal[]): string {
    if (signals.length === 0) return 'general';
    // Prioritize: trial > pricing > demo > consultation > general
    const priorities = ['trial', 'pricing', 'demo', 'consultation', 'general'];
    const types = new Set(signals.map(s => s.ctaType));
    return priorities.find(p => types.has(p)) || 'general';
}
