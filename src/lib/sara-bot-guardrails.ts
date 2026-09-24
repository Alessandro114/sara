// ═══════════════════════════════════════════════════
// S.A.R.A. WhatsApp bot — prompt injection guardrails
// ═══════════════════════════════════════════════════
// P1 fix 2026-04-12: users can try to extract the persona/system prompt
// by sending "ignore previous instructions" or impersonating the system
// role. We sanitize the input before it reaches Gemini/Groq and validate
// the output to catch any leaked persona markers.
//
// NOTE: this file is intentionally NOT called `sara-guardrails.ts` — that
// exists in scala-backend and is a different module. Keep the names apart
// to avoid import confusion during rsync.
// ═══════════════════════════════════════════════════

import pino from 'pino';

const log = pino({ name: 'sara-guardrails', level: 'info' });

// ─── Input sanitisation patterns ───
// Case-insensitive regex fragments covering IT/EN/ES/PT variants of the
// usual prompt-injection templates. We block (not just strip) because any
// match means the user is probing — replying with a polite refusal is safer
// than trying to salvage a partially-cleaned message.
const INJECTION_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
    // EN
    { pattern: /ignore\s+(all\s+)?(previous|prior|above)\s+(instructions|prompts|rules|messages)/i, label: 'ignore_previous_en' },
    { pattern: /disregard\s+(all\s+)?(previous|prior|above)\s+(instructions|prompts|rules)/i, label: 'disregard_previous_en' },
    { pattern: /reveal\s+(your|the)\s+(system\s+)?(prompt|instructions|rules)/i, label: 'reveal_prompt_en' },
    { pattern: /print\s+(your|the)\s+(system\s+)?(prompt|instructions|message)/i, label: 'print_prompt_en' },
    { pattern: /show\s+(me\s+)?(your|the)\s+(system\s+)?(prompt|instructions)/i, label: 'show_prompt_en' },
    { pattern: /you\s+are\s+now\s+(a|an)\s+/i, label: 'you_are_now_en' },
    { pattern: /\bact\s+as\s+(a|an|if)\b/i, label: 'act_as_en' },
    { pattern: /pretend\s+(you\s+are|to\s+be)/i, label: 'pretend_en' },
    { pattern: /forget\s+(everything|all|your\s+instructions)/i, label: 'forget_en' },
    { pattern: /(jailbreak|dan\s+mode|developer\s+mode|god\s+mode)/i, label: 'jailbreak_en' },

    // IT
    { pattern: /ignora\s+(tutte\s+le\s+|le\s+)?(precedenti|istruzioni|regole)/i, label: 'ignora_istruzioni_it' },
    { pattern: /dimentica\s+(tutte\s+le\s+|le\s+)?(istruzioni|regole|precedenti)/i, label: 'dimentica_it' },
    { pattern: /(mostrami|rivela|stampa)\s+(il\s+tuo|le\s+tue)\s+(prompt|istruzioni|regole\s+interne|system)/i, label: 'mostrami_prompt_it' },
    { pattern: /(fai\s+finta\s+di|fingi\s+di)\s+essere/i, label: 'fingi_it' },
    { pattern: /(comportati\s+come|agisci\s+come)\s+(se\s+fossi|un|una)/i, label: 'comportati_it' },
    { pattern: /sei\s+ora\s+(un|una)\s+/i, label: 'sei_ora_it' },

    // ES
    { pattern: /ignora\s+(todas\s+las\s+|las\s+)?(instrucciones|reglas|anteriores)/i, label: 'ignora_es' },
    { pattern: /olvida\s+(todas\s+las\s+|las\s+)?(instrucciones|reglas)/i, label: 'olvida_es' },
    { pattern: /(muestra|revela|imprime)\s+(tu|el)\s+(prompt|instrucciones|sistema)/i, label: 'muestra_prompt_es' },
    { pattern: /(finge|pretende)\s+(ser|que\s+eres)/i, label: 'finge_es' },
    { pattern: /ahora\s+eres\s+(un|una)\s+/i, label: 'ahora_eres_es' },

    // PT
    { pattern: /ignore\s+(todas\s+as\s+|as\s+)?(instruções|regras|anteriores)/i, label: 'ignore_pt' },
    { pattern: /esqueça\s+(todas\s+as\s+|as\s+)?(instruções|regras)/i, label: 'esqueca_pt' },
    { pattern: /(mostre|revele|imprima)\s+(seu|o)\s+(prompt|instruções|sistema)/i, label: 'mostre_prompt_pt' },
    { pattern: /(finja|pretenda)\s+(ser|que\s+é)/i, label: 'finja_pt' },
    { pattern: /agora\s+você\s+é\s+(um|uma)\s+/i, label: 'agora_voce_pt' },

    // Role-injection markers (any language)
    { pattern: /(^|\n)\s*system\s*[:\-]/i, label: 'role_system' },
    { pattern: /(^|\n)\s*assistant\s*[:\-]/i, label: 'role_assistant' },
    { pattern: /(^|\n)\s*###\s*(system|instructions)/i, label: 'hash_system' },
    { pattern: /<\|im_start\|>/i, label: 'chatml_marker' },
    { pattern: /<\|system\|>/i, label: 'system_marker' },
];

export interface SanitizeResult {
    cleaned: string;
    blocked: boolean;
    reason?: string;
}

/**
 * Sanitize user input before forwarding it to the LLM.
 * Returns `blocked=true` when the message matches a known injection template.
 * When blocked, callers should send a localized refusal message.
 */
export function sanitizeUserInput(text: string): SanitizeResult {
    if (!text || typeof text !== 'string') {
        return { cleaned: '', blocked: false };
    }

    for (const { pattern, label } of INJECTION_PATTERNS) {
        if (pattern.test(text)) {
            return { cleaned: '', blocked: true, reason: label };
        }
    }

    // Strip any raw ChatML / role delimiters that snuck through — belt & braces.
    const cleaned = text
        .replace(/<\|[^|>]{1,40}\|>/g, '')
        .trim();

    return { cleaned, blocked: false };
}

// ─── Output validation ───
// These fragments should NEVER reach the user; if the model echoes them back
// it means the system prompt has leaked and we must replace the response.
const LEAK_MARKERS: Array<{ pattern: RegExp; label: string }> = [
    { pattern: /sei\s+s\.?a\.?r\.?a\./i, label: 'persona_declaration_it' },
    { pattern: /you\s+are\s+s\.?a\.?r\.?a\./i, label: 'persona_declaration_en' },
    { pattern: /your\s+role\s*:/i, label: 'your_role_en' },
    { pattern: /il\s+tuo\s+ruolo\s*:/i, label: 'your_role_it' },
    { pattern: /\b(gemini|groq|mistral|llama|claude|gpt-?\d|openai)\b/i, label: 'model_name_leak' },
    { pattern: /system[_ ]instruction/i, label: 'system_instruction_leak' },
    { pattern: /persona[_ ]instruction/i, label: 'persona_instruction_leak' },
    { pattern: /sector_prompts/i, label: 'sector_prompts_leak' },
    { pattern: /\/home\/ale\//, label: 'filepath_leak' },
    // Internal source paths — the bot talks to restaurant owners, it has no
    // legitimate reason to ever name a file in this repo.
    { pattern: /\b(?:src|dist|lib|scripts)\/[\w./-]+\.(?:ts|tsx|js|mjs|cjs|json)\b/i, label: 'source_path_leak' },
    { pattern: /scala-backend|whatsapp-bot\/src/i, label: 'repo_path_leak' },
    // SCALA acronym must never be decoded as Cash vs Confirmation
    { pattern: /\bcash\s+vs\s+confirmation\b/i, label: 'acronym_leak' },
    { pattern: /\bs\s*=\s*strategy.*c\s*=\s*(cash|confirmation)/i, label: 'acronym_breakdown' },
];

export interface ValidationResult {
    safe: boolean;
    sanitized: string;
    violations: string[];
}

const SAFE_FALLBACKS: Record<string, string> = {
    it: "Scusa, fammi riformulare! Di cosa avevi bisogno esattamente? 😊",
    en: "Sorry, let me rephrase! What exactly did you need? 😊",
    es: "¡Perdón, déjame reformular! ¿Qué necesitabas exactamente? 😊",
    pt: "Desculpa, deixa eu reformular! O que você precisava exatamente? 😊",
};

/**
 * Validate LLM output against leakage markers.
 * When a violation is found, the response is replaced wholesale with a safe
 * localized fallback — partial redaction is risky because an attacker might
 * reconstruct the prompt from whatever remains.
 */
export function validateOutput(text: string, lang: string = 'it'): ValidationResult {
    if (!text) return { safe: true, sanitized: '', violations: [] };

    const violations: string[] = [];
    for (const { pattern, label } of LEAK_MARKERS) {
        if (pattern.test(text)) violations.push(label);
    }

    if (violations.length === 0) {
        return { safe: true, sanitized: text, violations: [] };
    }

    const fallback = SAFE_FALLBACKS[lang] || SAFE_FALLBACKS.it;
    return { safe: false, sanitized: fallback, violations };
}

// ─── Localised refusal for blocked injection attempts ───
const INJECTION_REFUSAL: Record<string, string> = {
    it: "Ehi, non posso cambiare le mie istruzioni 😊 Però posso aiutarti davvero: dimmi che problema stai cercando di risolvere nel tuo business e vediamo insieme!",
    en: "Hey, I can't change my instructions 😊 But I can actually help you: tell me what problem you're trying to solve in your business and let's look at it together!",
    es: "¡Ey, no puedo cambiar mis instrucciones! 😊 Pero sí puedo ayudarte de verdad: cuéntame qué problema estás intentando resolver en tu negocio y lo vemos juntos.",
    pt: "Ei, eu não posso mudar as minhas instruções 😊 Mas posso ajudar de verdade: me conta que problema você está tentando resolver no seu negócio e a gente vê junto!",
};

export function injectionRefusalMessage(lang: string = 'it'): string {
    return INJECTION_REFUSAL[lang] || INJECTION_REFUSAL.it;
}

// ─── Phone redactor — never log full numbers ───
function redactPhone(phone: string): string {
    const digits = (phone || '').replace(/\D/g, '');
    return digits.length >= 4 ? `***${digits.slice(-4)}` : '****';
}

/**
 * Emit a structured log line for a blocked injection or leaked output.
 * Exported so handlers can log with consistent shape.
 */
export function logGuardrailEvent(
    kind: 'injection_blocked' | 'output_violation',
    phone: string,
    details: { reason?: string; violations?: string[]; sample?: string }
): void {
    log.warn(
        {
            kind,
            phone: redactPhone(phone),
            reason: details.reason,
            violations: details.violations,
            // First 60 chars only — enough to triage, not enough to leak PII.
            sample: details.sample ? details.sample.slice(0, 60) : undefined,
        },
        kind === 'injection_blocked' ? 'blocked prompt injection attempt' : 'leaked persona in LLM output'
    );
}

// ═══════════════════════════════════════════════════
// ANTI-HALLUCINATION STRICT CHECK — added 2026-04-16
// ═══════════════════════════════════════════════════
// Root cause for this: SARA at 05:34 appended a second message proposing
// AgencyOS to a prospect who asked about PraxisOS + PropertyOS. The LLM
// had not been asked about AgencyOS, yet SARA mentioned it as if it had.
// This check catches responses that mention a vertical/product never
// surfaced by the user in the current turn or the short-term history,
// and rewrites them with the Alessandro escalation fallback.

const SCALA_VERTICAL_NAMES = [
    'PropertyOS', 'AgencyOS', 'BeautyOS', 'DermalyOS', 'DineOS',
    'MotorOS', 'TravelOS', 'PraxisOS', 'StudioOS', 'CleanOS', 'NetworkOS',
    'WellnessOS', 'ShopOS', 'FranchiseOS', 'ProjectOS', 'ReputationOS',
    'LandIQ', 'FacilityOS', 'AdOS',
];

// Canonical SCALA domains. Any other hostname in an http(s) URL = suspect.
const ALLOWED_HOSTS = new Set([
    'get-scala.com',
    'app.get-scala.com',
    'content.get-scala.com',
    'wa.me',
    't.me',
]);

const FALLBACK_BY_LANG: Record<string, string> = {
    it: 'Non ho informazioni precise su questo punto. Lasciami il tuo numero e il momento migliore per essere chiamato/a — il team dedicato ti risponde personalmente. In alternativa scrivi a contact@get-scala.com.',
    en: "I don't have precise information on this. Leave me your number and best time — our dedicated team will get back to you personally. Alternatively: contact@get-scala.com.",
    es: 'No tengo información precisa sobre esto. Déjame tu número y el mejor horario — el equipo dedicado te responde personalmente. Alternativa: contact@get-scala.com.',
    pt: 'Não tenho informação precisa sobre isso. Deixa-me o teu número e o melhor horário — a equipa dedicada responde-te pessoalmente. Alternativa: contact@get-scala.com.',
};

export interface StrictCheckResult {
    safe: boolean;
    sanitized: string;
    violations: string[];
}

/**
 * Strict anti-hallucination check. Runs AFTER validateOutput.
 *
 * Rules:
 *  1. If response mentions a vertical (PropertyOS, AgencyOS, ...) that is
 *     NOT present in the current user message nor in the last `recentMessages`
 *     user turns → violation 'unsolicited_vertical'
 *  2. If response contains a URL whose host is not in ALLOWED_HOSTS →
 *     violation 'unknown_host'
 *
 * On any violation, returns sanitized = Alessandro fallback message.
 */
export function strictHallucinationCheck(
    response: string,
    userMessage: string,
    recentUserMessages: string[],
    lang: string = 'it'
): StrictCheckResult {
    const violations: string[] = [];
    if (!response) return { safe: true, sanitized: '', violations: [] };

    // Context for grounding: current msg + recent turns from user only.
    const context = [userMessage, ...recentUserMessages].join(' \n ').toLowerCase();

    // If user explicitly asks about verticals, all mentions are grounded — skip Rule 1
    const asksAboutVerticals = /vertical|settori|sectors?|industries|moduli|which.*os\b|what.*os\b/i.test(userMessage);
    if (asksAboutVerticals) return { safe: true, sanitized: response, violations: [] };

    // Rule 1: unsolicited vertical mention
    for (const vertical of SCALA_VERTICAL_NAMES) {
        const lower = vertical.toLowerCase();
        // Mentioned in response?
        const inResponse = new RegExp(`\\b${lower}\\b`, 'i').test(response);
        if (!inResponse) continue;
        // Grounded in user context? Accept either exact name or a clear topical
        // keyword (e.g. "immobiliare" for PropertyOS).
        const groundedByName = context.includes(lower);
        if (groundedByName) continue;
        // Keyword mapping — if user talked about the topic, vertical is fair game.
        const topicalMap: Record<string, string[]> = {
            propertyos: ['immobilia', 'property', 'casa', 'affit', 'vendita immobi', 'agenzia immobi'],
            agencyos: ['agenzia', 'marketing', 'comunicazione', 'campagne', 'adv', 'pubblicit'],
            beautyos: ['saloni', 'parrucch', 'estetic', 'barberia', 'beauty', 'centri estetici', 'nail'],
            dermalyos: ['dermatolog', 'medicina estetic', 'clinica', 'pazienti', 'trattamento estetico'],
            dineos: ['ristor', 'pizzeria', 'bar ', 'menu', 'prenotazioni tavol', 'cucina'],
            motoros: ['concessionari', 'officina', 'auto ', 'automotive', 'veicol', 'moto '],
            travelos: ['turism', 'agenzia viaggi', 'tour operator', 'hotel ', 'viagg'],
            praxisos: ['studio professionale', 'avvocat', 'commercialist', 'notaio', 'consulente', 'legal'],
            studioos: ['architett', 'designer', 'fotograf', 'creativi', 'studio creativo'],
            cleanos: ['pulizi', 'facility', 'sanifica', 'cleaning'],
            networkos: ['mlm', 'network marketing', 'multilevel', 'herbalife', 'distributori'],
        };
        const keywords = topicalMap[lower] || [];
        const topicallyGrounded = keywords.some(k => context.includes(k));
        if (topicallyGrounded) continue;
        violations.push(`unsolicited_vertical:${vertical}`);
    }

    // Rule 2: URL whitelist
    const urls = response.match(/https?:\/\/[^\s)>"']+/gi) || [];
    for (const url of urls) {
        try {
            const host = new URL(url).hostname.replace(/^www\./, '');
            if (!ALLOWED_HOSTS.has(host)) {
                violations.push(`unknown_host:${host}`);
            }
        } catch {
            violations.push(`malformed_url:${url.slice(0, 40)}`);
        }
    }

    if (violations.length === 0) {
        return { safe: true, sanitized: response, violations: [] };
    }

    const fallback = FALLBACK_BY_LANG[lang] || FALLBACK_BY_LANG.it;
    return { safe: false, sanitized: fallback, violations };
}

// ═══════════════════════════════════════════════════
// ZERO-HALLUCINATION GUARDRAILS — added 2026-04-16
// ═══════════════════════════════════════════════════
// Task 1 (Alessandro brief): when RAG retrieval confidence is below the
// configured threshold, SARA MUST politely decline instead of fabricating
// prices/features/dates/names. These helpers are consumed by text.ts.

// 2026-06-28: lowered 0.65→0.55. Real mxbai cosine sims for good matches sit
// ~0.60-0.70, so 0.65 flagged too many legit answers as low-confidence and
// triggered the canned escalation fallback. 0.55 keeps grounded answers while
// still catching genuinely off-topic queries.
export const DEFAULT_RAG_CONFIDENCE_THRESHOLD = 0.55;

export interface EscalationTarget {
    name: string;   // e.g. "Alessandro" or "Marco (direttore Verona)"
    email?: string;
    phone?: string;
}

/**
 * Compose the low-confidence fallback message (when ragScore < threshold
 * or no KB grounding exists). Offers escalation to a named target.
 */
export function lowConfidenceFallback(
    lang: string = 'it',
    escalation?: EscalationTarget | null
): string {
    const base = FALLBACK_BY_LANG[lang] || FALLBACK_BY_LANG.it;
    if (!escalation) return base;
    const byLang: Record<string, string> = {
        it: `Su questo non ho informazioni precise — ti metto in contatto con ${escalation.name}` +
            (escalation.email ? ` (${escalation.email})` : '') +
            (escalation.phone ? `, tel. ${escalation.phone}` : '') +
            '. Preferisci una mail o una chiamata?',
        en: `I don't have precise information on this — let me connect you with ${escalation.name}` +
            (escalation.email ? ` (${escalation.email})` : '') +
            (escalation.phone ? `, phone ${escalation.phone}` : '') +
            '. Do you prefer email or a call?',
        es: `No tengo información precisa — te pongo en contacto con ${escalation.name}` +
            (escalation.email ? ` (${escalation.email})` : '') +
            (escalation.phone ? `, tel. ${escalation.phone}` : '') +
            '. ¿Prefieres mail o llamada?',
        pt: `Não tenho informação precisa — passo-te para ${escalation.name}` +
            (escalation.email ? ` (${escalation.email})` : '') +
            (escalation.phone ? `, tel. ${escalation.phone}` : '') +
            '. Prefere email ou telefone?',
    };
    return byLang[lang] || byLang.it;
}

/**
 * Build the "strict fallback" system prompt used when RAG confidence is
 * below threshold. The LLM is told NOT to invent specifics and to offer
 * escalation instead.
 */
export function strictFallbackSystemPrompt(
    lang: string,
    escalation?: EscalationTarget | null
): string {
    const tgt = escalation
        ? `${escalation.name}${escalation.email ? ` (${escalation.email})` : ''}${escalation.phone ? `, tel. ${escalation.phone}` : ''}`
        : 'il team dedicato (contact@get-scala.com)';
    const prompts: Record<string, string> = {
        it: `ATTENZIONE: la domanda dell'utente NON è coperta dalla tua knowledge base. Devi rifiutare educatamente di rispondere con dettagli specifici e offrire di inoltrare la richiesta. Canale di escalation disponibile: ${tgt}. NON inventare prezzi, caratteristiche di prodotto, tempi di consegna, promozioni, nomi di persone. Rispondi in 1-2 frasi: ammetti che non hai informazioni precise e offri il contatto.`,
        en: `WARNING: the user's question is NOT covered by your knowledge base. You must politely decline to answer with specifics and offer to escalate. Available escalation: ${tgt}. NEVER invent prices, product features, delivery times, promotions, or names. Answer in 1-2 sentences: admit you don't have precise info and offer the contact.`,
        es: `ATENCIÓN: la pregunta no está cubierta por tu base de conocimiento. Debes rechazar educadamente y ofrecer escalar. Contacto: ${tgt}. NUNCA inventes precios, características, tiempos, promociones o nombres. Responde en 1-2 frases.`,
        pt: `ATENÇÃO: a pergunta não está coberta pela base de conhecimento. Recuse educadamente e ofereça escalar. Contacto: ${tgt}. NUNCA inventes preços, características, prazos, promoções ou nomes. Responde em 1-2 frases.`,
    };
    return prompts[lang] || prompts.it;
}

// ─── Forbidden-claim checker ───
// Detects fabricated prices/dates/names in a response when RAG confidence
// is below threshold. `allowedClaims` whitelists phrases that the KB
// actually contains (so they aren't treated as fabrications).
const DATE_PATTERNS = [
    /\b\d{1,2}[\/\-\.]\d{1,2}([\/\-\.]\d{2,4})?\b/,                 // 12/04/2026, 3-5
    /\b\d{1,2}\s+(?:gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre|january|february|march|april|may|june|july|august|september|october|november|december|enero|febrero|mayo|noviembre|janeiro|março|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\b/i,
    /\b(?:entro|by|dentro)\s+\d+\s+(?:giorni|days|días|dias|settimane|weeks|semanas)\b/i,
];
const PHONE_PATTERN = /\+?\d{2,3}[\s\-]?\d{3,4}[\s\-]?\d{3,4}/;

/**
 * Post-LLM validator that blocks fabricated specifics (€, dates, phones).
 * Only runs when RAG confidence < threshold. If a suspect token is found
 * AND it's not in `allowedClaims`, the response is blocked and callers
 * should replace with `lowConfidenceFallback(...)`.
 */
export interface ForbiddenCheckResult {
    safe: boolean;
    violations: string[];
}

// Full price-token matcher (global): captures the WHOLE amount incl.
// separators, e.g. "€4.999", "€1.300", "97€", "€0". This drives the
// per-token allow-list comparison so a fabricated "€4.999" can't hide
// behind an allowed substring (the old single-digit test missed this).
const PRICE_TOKEN_PATTERN = /(?:€|EUR|USD|\$)\s?\d[\d.,]*|\d[\d.,]*\s?(?:€|EUR|USD)/gi;
const CURRENCY_RE = /€|eur|usd|\$/i;

// Normalize a price token to bare digits/separators for exact comparison:
// strip currency symbols + spaces, then trailing/leading separators.
// "€97" → "97", "€197." → "197", "€4.999" → "4.999".
function normalizePriceToken(s: string): string {
    return s
        .replace(/€|eur|usd|\$/gi, '')
        .replace(/\s+/g, '')
        .replace(/^[.,]+|[.,]+$/g, '')
        .trim();
}

export function checkForbiddenClaims(
    response: string,
    allowedClaims: string[] = []
): ForbiddenCheckResult {
    if (!response) return { safe: true, violations: [] };
    const violations: string[] = [];

    const allowed = allowedClaims.map(c => c.toLowerCase().trim()).filter(Boolean);

    // Non-price allow check (dates/phones/names): the whitelisted claim must
    // appear verbatim inside the matched fragment, OR match it exactly. The
    // reverse direction (a tiny fragment "inside" an allowed claim) is dropped —
    // that was the over-broad path that let fabrications slip through.
    const isAllowedToken = (frag: string): boolean => {
        const f = frag.toLowerCase().trim();
        return allowed.some(a => a === f || f.includes(a));
    };

    // Currency amounts we accept, normalized to bare digits. ONLY allow-list
    // entries that are themselves currency amounts count here — a bare "30"
    // (the 30-day trial) must never whitelist a "€30"/"€3000" price token.
    const allowedPriceTokens = new Set(
        allowed.filter(a => CURRENCY_RE.test(a)).map(a => normalizePriceToken(a))
    );

    // ── Prices: check EVERY match with exact normalized-token comparison ──
    for (const m of response.matchAll(PRICE_TOKEN_PATTERN)) {
        const token = m[0];
        if (!allowedPriceTokens.has(normalizePriceToken(token))) {
            violations.push(`price:${token.trim().slice(0, 20)}`);
        }
    }

    // ── Dates: check every occurrence across all patterns ──
    for (const pat of DATE_PATTERNS) {
        const g = new RegExp(pat.source, pat.flags.includes('g') ? pat.flags : pat.flags + 'g');
        for (const m of response.matchAll(g)) {
            if (!isAllowedToken(m[0])) {
                violations.push(`date:${m[0].slice(0, 20)}`);
            }
        }
    }

    // ── Phones: check every occurrence ──
    const phoneRe = new RegExp(PHONE_PATTERN.source, PHONE_PATTERN.flags.includes('g') ? PHONE_PATTERN.flags : PHONE_PATTERN.flags + 'g');
    for (const m of response.matchAll(phoneRe)) {
        // Ignore well-known SCALA numbers if in allowed list.
        if (!isAllowedToken(m[0])) violations.push(`phone:${m[0]}`);
    }

    // crude fabricated-name detection: "il signor X" / "il dott. X" when name
    // is not in allowed whitelist. Opt-in: only flag if followed by a proper name.
    const nameRe = /\b(?:signor|dott\.?|dr\.?|mr\.?|mrs\.?|sra\.?)\s+([A-Z][a-zà-ú]{2,})/g;
    for (const m of response.matchAll(nameRe)) {
        if (!isAllowedToken(m[1])) violations.push(`name:${m[1]}`);
    }

    return { safe: violations.length === 0, violations };
}
