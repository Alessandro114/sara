// ===================================================
// SCALA WhatsApp Bot — Text Handler (v4 — Sales Agent + Intent Scoring)
// ===================================================
type WASocket = any;
type WAMessage = any;
import { extractTextContent } from '../media.js';
import { getAIResponse, extractLeadInfo, extractLeadInfoAI } from '../ai.js';
import { getSession, upsertSession, logMessage, updateLeadInfo, updateLeadScore, scheduleFollowups, cancelPendingFollowups, lookupScalaUser } from '../db.js';
import { detectSector, detectSectorSemantic, detectCompanySize, getCTAMessage } from '../sectors.js';
import { detectIntent, getIntentScore, getBestCTAType, getDominantIntent } from '../intent.js';
import { isScalaPlatformQuery } from '../scala-knowledge.js';
import { BOT_NAME } from '../config.js';
import { sendHumanized } from '../humanize.js';
import {
    sanitizeUserInput,
    validateOutput,
    injectionRefusalMessage,
    logGuardrailEvent,
    strictHallucinationCheck,
    checkForbiddenClaims,
    lowConfidenceFallback,
} from '../lib/sara-bot-guardrails.js';
import { enforcePersonaRules } from '../lib/output-enforcer.js';
import { callDataEntry, looksLikeDataEntry, extractContactFromText } from '../lib/backend-api.js';
import { storeInRAG, ragSearchWithScore, evaluateRetrieval } from '../ai.js';
import { getTenantConfig } from '../lib/tenant-config.js';
import { resolveBranchForPhone, branchContextSnippet } from '../lib/branches.js';
import { updateClientProfile, checkAndGenerateSummary, getAiMode, setAiMode } from '../lib/conversation-memory.js';
import { syncContactToCRM, detectCRMTags, getAdminUserId } from '../crm-sync.js';
import { processPropertyListingFromText, isPropertyListing } from './property-listing.js';
import { autonomyGate } from '../lib/autonomy-gate.js';
import { redactPhone } from '../lib/phone-utils.js';

/**
 * Bag-of-words language detector.
 * Returns 'it', 'en', 'es', or 'pt'. Defaults to 'it'.
 *
 * TODO(quality): replace with `franc` npm package for better multi-lingual
 * detection — see https://www.npmjs.com/package/franc. The bag-of-words
 * approach is good enough for short WhatsApp messages but fails on code
 * switching and very short texts.
 */
function detectLanguage(text: string): string {
    const lower = text.toLowerCase();

    // Expanded vocabulary — 50+ tokens per language including common
    // function words, greetings, and business-related terms.
    const enWords = new Set([
        'the', 'and', 'have', 'for', 'are', 'but', 'not', 'you', 'this', 'with',
        'how', 'what', 'would', 'like', 'about', 'want', 'need', 'help', 'can',
        'could', 'thanks', 'hello', 'please', 'business', 'company', 'from',
        'will', 'just', 'know', 'your', 'they', 'some', 'more', 'does', 'been',
        'very', 'when', 'make', 'good', 'morning', 'evening', 'night', 'today',
        'tomorrow', 'work', 'my', 'i\'m', 'we', 'us', 'our', 'hi', 'hey',
        'question', 'tell', 'think', 'looking',
    ]);
    const esWords = new Set([
        'los', 'las', 'que', 'una', 'por', 'con', 'como', 'para', 'pero', 'hola',
        'quiero', 'necesito', 'tengo', 'puedo', 'empresa', 'negocio', 'gracias',
        'estoy', 'tiene', 'donde', 'soy', 'eres', 'somos', 'usted', 'nosotros',
        'buenos', 'buenas', 'dias', 'días', 'tardes', 'noches', 'muy', 'bien',
        'hacer', 'haciendo', 'trabajo', 'mi', 'mis', 'tu', 'tus', 'su', 'sus',
        'más', 'mas', 'también', 'cuando', 'quien', 'cuanto', 'cuánto',
        'precio', 'costo', 'favor', 'ayuda', 'información', 'sobre', 'pregunta',
    ]);
    const itWords = new Set([
        'che', 'per', 'non', 'con', 'sono', 'una', 'come', 'ciao', 'vorrei',
        'azienda', 'buongiorno', 'salve', 'grazie', 'posso', 'avrei', 'bisogno',
        'noi', 'voi', 'loro', 'ho', 'hai', 'abbiamo', 'avete', 'hanno', 'mio',
        'mia', 'miei', 'tuo', 'tua', 'suo', 'sua', 'molto', 'anche', 'quando',
        'dove', 'perché', 'perchè', 'quanto', 'prezzo', 'costo', 'aiuto',
        'informazioni', 'cortesia', 'domanda', 'risposta', 'lavoro', 'studio',
        'ristorante', 'agenzia', 'sei', 'siamo', 'siete', 'facciamo',
    ]);
    const ptWords = new Set([
        'oi', 'olá', 'ola', 'tudo', 'bem', 'você', 'voce', 'vocês', 'voces',
        'eu', 'nós', 'nos', 'meu', 'minha', 'seu', 'sua', 'nosso', 'nossa',
        'obrigado', 'obrigada', 'por', 'favor', 'com', 'sem', 'para', 'pra',
        'como', 'está', 'esta', 'estou', 'estamos', 'bom', 'boa', 'dia',
        'tarde', 'noite', 'muito', 'também', 'tambem', 'quando', 'onde',
        'porque', 'quanto', 'preço', 'preco', 'custo', 'ajuda', 'informação',
        'informacao', 'sobre', 'pergunta', 'resposta', 'trabalho', 'empresa',
        'negócio', 'negocio', 'agência', 'agencia', 'restaurante', 'fazer',
        'fazendo', 'isso', 'essa', 'esse', 'aquilo', 'gostaria', 'preciso',
        'quero', 'tenho', 'temos', 'são', 'sao', 'somos',
    ]);
    const frWords = new Set([
        'le', 'la', 'les', 'des', 'une', 'est', 'sont', 'nous', 'vous', 'ils',
        'bonjour', 'bonsoir', 'merci', 'comment', 'pourquoi', 'quand', 'quel',
        'quelle', 'avoir', 'être', 'etre', 'faire', 'avec', 'dans', 'pour',
        'sur', 'pas', 'plus', 'mais', 'aussi', 'très', 'tres', 'bien', 'bon',
        'bonne', 'jour', 'soir', 'nuit', 'matin', 'travail', 'entreprise',
        'besoin', 'aide', 'prix', 'information', 'question', 'réponse', 'reponse',
        'salut', 'oui', 'non', 'peut', 'pouvez', 'voudrais', 'veux', 'suis',
        'sommes', 'êtes', 'etes', 'mon', 'mes', 'votre', 'vos', 'leur', 'leurs',
        'ici', 'maintenant', 'aujourd', 'demain', 'hier', 'encore', 'toujours',
    ]);
    const deWords = new Set([
        'ich', 'du', 'er', 'sie', 'wir', 'ihr', 'und', 'oder', 'aber', 'nicht',
        'hallo', 'guten', 'morgen', 'abend', 'tag', 'danke', 'bitte', 'wie',
        'was', 'wann', 'warum', 'wo', 'wer', 'haben', 'sein', 'werden', 'mit',
        'für', 'fur', 'auf', 'von', 'aus', 'nach', 'bei', 'durch', 'über', 'uber',
        'sehr', 'gut', 'schön', 'schon', 'auch', 'noch', 'mehr', 'hier', 'jetzt',
        'heute', 'morgen', 'arbeit', 'unternehmen', 'firma', 'brauche', 'hilfe',
        'preis', 'frage', 'antwort', 'möchte', 'mochte', 'kann', 'können', 'konnen',
        'mein', 'meine', 'dein', 'deine', 'ihr', 'ihre', 'unser', 'unsere',
        'reinigung', 'sauberkeit', 'putzen', 'dienst', 'service',
    ]);

    const words = lower.split(/[\s,.!?;:()\[\]{}"']+/);
    let enScore = 0, esScore = 0, itScore = 0, ptScore = 0, frScore = 0, deScore = 0;
    for (const w of words) {
        if (enWords.has(w)) enScore++;
        if (esWords.has(w)) esScore++;
        if (itWords.has(w)) itScore++;
        if (ptWords.has(w)) ptScore++;
        if (frWords.has(w)) frScore++;
        if (deWords.has(w)) deScore++;
    }

    // Need at least 2 matches and a clear winner to be confident.
    const scores: Array<[string, number]> = [
        ['en', enScore], ['es', esScore], ['it', itScore], ['pt', ptScore],
        ['fr', frScore], ['de', deScore],
    ];
    scores.sort((a, b) => b[1] - a[1]);
    const [topLang, topScore] = scores[0];
    const [, secondScore] = scores[1];
    if (topScore >= 2 && topScore > secondScore) return topLang;
    return ''; // NOT confident → '' (unknown). Callers keep the existing language
               // instead of resetting it to Italian on every short/ambiguous message.
}

/**
 * Detect an EXPLICIT request to switch reply language, e.g. "reply in English",
 * "puoi scrivere in inglese?", "en español por favor". Returns the target lang
 * code or '' if none. Honors the user's intent even when the request is itself
 * written in another language (which is exactly when bag-of-words fails).
 */
function detectLanguageSwitchRequest(text: string): string {
    const t = (text || '').toLowerCase();
    // A request-y word must be present so we don't switch on an incidental mention.
    const REQUESTY = /\b(in|en|auf|reply|answer|respond|write|speak|switch|use|usa|parla|parli|parlare|scriv|rispond|posso|puoi|può|puoi|can you|could you|please|per favore|por favor|habl|escrib|fal)\b/;
    if (!REQUESTY.test(t)) return '';
    const NAMES: Array<[RegExp, string]> = [
        [/\b(english|inglese|ingl[eé]s|anglais|englisch)\b/, 'en'],
        [/\b(italiano|italian|italien|italienisch)\b/, 'it'],
        [/\b(spanish|spagnolo|espa[nñ]ol|espagnol|spanisch)\b/, 'es'],
        [/\b(portuguese|portoghese|portugu[eê]s|portugais|portugiesisch)\b/, 'pt'],
        [/\b(french|francese|franc[eé]s|fran[çc]ais|franz[oö]sisch)\b/, 'fr'],
        [/\b(german|tedesco|alem[aá]n|allemand|deutsch)\b/, 'de'],
    ];
    for (const [re, code] of NAMES) if (re.test(t)) return code;
    return '';
}

// Bilingual language prompt shown when the language is unclear on first contact.
const LANGUAGE_MENU =
    '🌍 In che lingua preferisci parlare? / Which language do you prefer?\n' +
    '🇮🇹 Italiano · 🇬🇧 English · 🇪🇸 Español · 🇵🇹 Português · 🇫🇷 Français · 🇩🇪 Deutsch\n' +
    'Rispondi con la lingua (es. "English"). / Just reply with your language.';

// Parse the user's answer to the language prompt (a name, code, or number 1-6).
function pickLangFromChoice(text: string): string {
    const t = (text || '').toLowerCase().trim();
    if (/^\s*1\b|\b(it|ita|italiano|italian)\b/.test(t)) return 'it';
    if (/^\s*2\b|\b(en|eng|english|inglese)\b/.test(t)) return 'en';
    if (/^\s*3\b|\b(es|esp|espa[nñ]ol|spanish|spagnolo)\b/.test(t)) return 'es';
    if (/^\s*4\b|\b(pt|por|portugu[eê]s|portuguese|portoghese)\b/.test(t)) return 'pt';
    if (/^\s*5\b|\b(fr|fra|fran[çc]ais|french|francese)\b/.test(t)) return 'fr';
    if (/^\s*6\b|\b(de|deu|deutsch|german|tedesco)\b/.test(t)) return 'de';
    return '';
}

/**
 * Detect budget signals from text
 */
function detectBudget(text: string): string | null {
    const lower = text.toLowerCase();
    if (/\b(gratis|free|gratuito|zero budget|niente budget)\b/.test(lower)) return '<100';
    if (/\b(100.*euro|cento euro|pochissimo|budget ridotto|minimo)\b/.test(lower)) return '<100';
    if (/\b(qualche centinaio|200|300|500.*euro|budget limitato)\b/.test(lower)) return '100-500';
    if (/\b(mille|1000|1\.000|un migliaio|budget medio)\b/.test(lower)) return '500-1000';
    if (/\b(migliaia|duemila|tremila|2000|3000|5000|budget buono|investire seriamente)\b/.test(lower)) return '1000-5000';
    if (/\b(diecimila|10\.000|10000|ventimila|budget alto|budget importante)\b/.test(lower)) return '5000+';
    return null;
}

/**
 * Detect if user is a decision maker
 */
function detectDecisionMaker(text: string): boolean {
    const lower = text.toLowerCase();
    return /\b(titolare|fondatore|founder|ceo|proprietario|socio|partner|direttore|amministratore|owner|io decido|decido io|gestisco|la mia azienda|il mio studio|il mio ristorante|il mio hotel)\b/.test(lower);
}

export async function handleText(
    sock: WASocket,
    msg: WAMessage,
    session: any
): Promise<void> {
    const phone = msg.key.remoteJid!;
    const realPhone = (msg as any)._realPhone || null;
    const text = extractTextContent(msg);
    if (!text.trim()) return;

    console.log(`[IN] ${redactPhone(phone)}: ${text.substring(0, 40)}...`);
    // Quick sentiment detection for per-message tracking
    const lower = text.toLowerCase();
    const msgSentiment = /\b(grazie|perfetto|ottimo|fantastico|great|thanks|excellent|amazing|bene|bravo|stupendo|wow)\b/i.test(lower) ? 'positive'
        : /\b(problema|difficolt|non funzion|frustrat|deluso|bad|terrible|issue|bug|lento|costoso|troppo caro|delusione|schifo)\b/i.test(lower) ? 'negative'
        : 'neutral';
    await logMessage(phone, 'in', text, 'text', undefined, undefined, msgSentiment);

    // ── Opt-out / Opt-in (GDPR) — duplicated here so unit tests that call
    // handleText directly also exercise this path (production uses index.ts too)
    if (session?.opted_out) {
        if (/riattiva|reactivate|resubscribe/i.test(text)) {
            await upsertSession(phone, { opted_out: false } as any);
            await sendHumanized(sock, phone, 'Bentornato! 🎉 Sono di nuovo qui per aiutarti. Come posso esserti utile?');
        }
        return; // silently ignore opted-out users
    }
    if (/\b(stop|basta|cancella|non mi contattare|disiscrivi|unsubscribe|opt.?out)\b/i.test(text)) {
        await upsertSession(phone, { opted_out: true } as any);
        await sendHumanized(sock, phone, 'Hai scelto di non ricevere più messaggi. Per riattivare, scrivi "riattiva". Grazie! 🙏');
        return;
    }

    // P1 fix: prompt-injection guardrail. If the user is trying to jailbreak
    // the persona, refuse politely in their language and stop before any AI
    // call — saves tokens AND protects the system prompt.
    const sanitized = sanitizeUserInput(text);
    if (sanitized.blocked) {
        logGuardrailEvent('injection_blocked', phone, { reason: sanitized.reason, sample: text });
        const refusalLang = (session?.user_language || 'it') as string;
        await sendHumanized(sock, phone, injectionRefusalMessage(refusalLang));
        return;
    }

    // ── Feature 4: AI/Human Toggle + Takeover ──
    // Supports: "SARA stop" → human takes over, "SARA riprendi" → AI resumes
    // "SARA bozza" → hybrid mode (AI drafts, human approves)
    // "prendo io" → human takeover shortcut
    // In human mode: SARA still logs + enriches CRM, just doesn't respond
    const { detectTakeoverCommand, isHumanTakeover, setTakeoverMode, getTakeoverMode } = await import('../lib/human-takeover.js');
    const { pool } = await import('../db.js');

    // ── Feature 7: Silent Group Listener Commands (1:1) ──
    // "SARA ascolta il gruppo X" / "SARA smetti di ascoltare il gruppo X" / "SARA gruppi silenziosi"
    const { detectSilentGroupCommand, handleSilentGroupCommand } = await import('./group-silent.js');
    const silentCmd = detectSilentGroupCommand(text);
    if (silentCmd) {
        const response = await handleSilentGroupCommand(sock, phone, silentCmd, pool);
        await sendHumanized(sock, phone, response);
        return;
    }

    const takeoverCmd = detectTakeoverCommand(text);
    if (takeoverCmd) {
        await setTakeoverMode(phone, takeoverCmd, pool, { taken_by: 'operator' });
        const modeLabels: Record<string, string> = {
            ai: '🤖 SARA riattivata — rispondo io da ora.',
            human: '👤 Ricevuto — mi fermo. Scrivi "SARA riprendi" quando vuoi che riprenda.',
            hybrid: '📝 Modalita bozza — preparo le risposte, tu approvi prima dell\'invio.',
        };
        await sendHumanized(sock, phone, modeLabels[takeoverCmd] || 'OK');
        return;
    }

    // Legacy toggle support
    const aiModeInfo = await getAiMode(phone);

    if (isHumanTakeover(phone) || aiModeInfo.mode === 'human_only') {
        // AI does NOT respond — but CRM enrichment continues silently
        console.log(`[TAKEOVER] ${redactPhone(phone)}: human mode — skipping AI, enriching CRM`);
        // Fire-and-forget CRM sync even in human mode
        (async () => {
            try {
                const adminId = await getAdminUserId();
                if (adminId) {
                    const tags = detectCRMTags(text);
                    await syncContactToCRM({
                        phone, name: session?.user_name, company: session?.company_name,
                        email: session?.email, sector: session?.sector,
                        lead_score: Math.min(100, 10 + (session?.messages_count || 0) * 2),
                        tags, note: `[human mode] ${text.substring(0, 200)}`,
                        owner_user_id: adminId,
                    });
                }
            } catch { /* non-fatal */ }
        })();
        return;
    }

    // ── utm_branch deep-link detection (Task 3, 2026-04-16) ──
    // If the first message contains "utm_branch=<id>", stamp the session
    // so future replies get branch context automatically.
    try {
        const utmMatch = text.match(/\butm_branch\s*=\s*(\d{1,10})\b/i);
        if (utmMatch) {
            const branchId = parseInt(utmMatch[1], 10);
            if (!isNaN(branchId) && branchId > 0) {
                const { pool } = await import('../db.js');
                await pool.query(
                    `UPDATE wa_sessions SET branch_id = $1 WHERE phone = $2`,
                    [branchId, phone]
                );
                console.log(`[BRANCH] ${redactPhone(phone)}: tagged with branch_id=${branchId}`);
            }
        }
    } catch { /* non-fatal */ }

    // Cancel pending follow-ups — user is interacting!
    await cancelPendingFollowups(phone);

    // Save real phone number if available
    const phoneDisplay = realPhone ? `+${realPhone}` : undefined;

    // ── Language: explicit request > confident detection > ASK if unknown ──
    // Never silently default to Italian: a short/ambiguous message no longer resets
    // a known language, and a genuinely-unknown first contact is ASKED, not assumed.
    const requestedLang = detectLanguageSwitchRequest(text);        // explicit "reply in X"
    const detectedLanguage = requestedLang || detectLanguage(text); // '' when not confident
    if (session?.context?.awaiting_language) {
        // User is answering our language prompt — capture their choice.
        const chosen = requestedLang || pickLangFromChoice(text) || detectLanguage(text);
        if (chosen) {
            const ctx = { ...(session.context || {}), awaiting_language: false };
            await upsertSession(phone, { user_language: chosen, context: ctx, phone_display: phoneDisplay } as any);
            session.user_language = chosen; session.context = ctx;
        } else {
            await sendHumanized(sock, phone, LANGUAGE_MENU);
            return;
        }
    } else if (session && detectedLanguage && detectedLanguage !== session.user_language) {
        // Confident detection or explicit request → set it (sticky) + apply to THIS reply.
        await upsertSession(phone, { user_language: detectedLanguage, phone_display: phoneDisplay } as any);
        session.user_language = detectedLanguage;
    } else if (session && !session.user_language && !detectedLanguage) {
        // First contact and language genuinely unknown → ASK, then wait for the reply.
        const ctx = { ...(session.context || {}), awaiting_language: true };
        await upsertSession(phone, { context: ctx, phone_display: phoneDisplay } as any);
        await sendHumanized(sock, phone, LANGUAGE_MENU);
        return;
    }

    // Detect sector from message (semantic first, keyword fallback)
    const detectedSector = await detectSectorSemantic(text);
    if (detectedSector && (!session || session.sector === 'general')) {
        await upsertSession(phone, { sector: detectedSector, phone_display: phoneDisplay } as any);
        session = await getSession(phone);
    } else {
        await upsertSession(phone, { phone_display: phoneDisplay } as any);
        session = await getSession(phone);
    }

    // Detect company size
    const companySize = detectCompanySize(text);
    if (companySize && !session.company_size) {
        await updateLeadInfo(phone, { company_size: companySize });
    }

    // Detect budget signal
    const budget = detectBudget(text);
    if (budget && !session.estimated_revenue) {
        await updateLeadInfo(phone, { estimated_revenue: budget });
    }

    // Extract lead info — try regex first, then the LLM chain as fallback
    const leadInfo = extractLeadInfo(text);
    let needsAIExtraction = !leadInfo.name && !leadInfo.company && !leadInfo.email;

    if (leadInfo.name && !session.user_name) {
        await updateLeadInfo(phone, { user_name: leadInfo.name });
        session.user_name = leadInfo.name;
    }
    if (leadInfo.company && !session.company_name) {
        await updateLeadInfo(phone, { company_name: leadInfo.company });
    }
    if (leadInfo.email && !session.email) {
        await updateLeadInfo(phone, { email: leadInfo.email });
    }

    // LLM-based extraction as fallback (only if regex found nothing AND we still need info)
    if (needsAIExtraction && (!session.user_name || !session.company_name) && text.length >= 15) {
        try {
            const aiInfo = await extractLeadInfoAI(text);
            if (aiInfo.name && !session.user_name) {
                await updateLeadInfo(phone, { user_name: aiInfo.name });
                session.user_name = aiInfo.name;
            }
            if (aiInfo.company && !session.company_name) {
                await updateLeadInfo(phone, { company_name: aiInfo.company });
            }
            if (aiInfo.email && !session.email) {
                await updateLeadInfo(phone, { email: aiInfo.email });
            }
            // Use AI sector hint if we still don't have a sector
            if (aiInfo.sector_hint && session.sector === 'general') {
                await upsertSession(phone, { sector: aiInfo.sector_hint });
                session = await getSession(phone);
            }
        } catch { /* ignore AI extraction errors */ }
    }

    // ── Intent Detection & Smart Lead Scoring ──
    const intentSignals = detectIntent(text);
    const intentScore = getIntentScore(intentSignals);
    const dominantIntent = getDominantIntent(intentSignals);
    const bestCTAType = getBestCTAType(intentSignals);

    // Dynamic lead scoring: base +2, plus intent-based bonus
    const scoreBonus = intentScore > 0 ? intentScore : 2;
    await updateLeadScore(phone, scoreBonus);

    // Track decision maker status
    if (detectDecisionMaker(text) && !session.context?.is_decision_maker) {
        await updateLeadInfo(phone, {} as any); // trigger context update
        // Store in session context
        const ctx = session.context || {};
        ctx.is_decision_maker = true;
        await upsertSession(phone, { context: ctx } as any);
    }

    // Auto-qualify: mark profiling_complete when we have enough data
    if (!session.profiling_complete) {
        const fresh = await getSession(phone);
        if (fresh?.user_name && fresh?.sector !== 'general' && (fresh?.company_size || fresh?.company_name)) {
            await upsertSession(phone, { profiling_complete: true } as any);
        }
    }

    // Welcome message ONLY for first-time users
    if (session.messages_count <= 1) {
        // Check if phone matches a registered SCALA user
        let scalaUser: Awaited<ReturnType<typeof lookupScalaUser>> = null;
        try {
            scalaUser = await lookupScalaUser(phone);
        } catch { /* ignore lookup errors */ }

        // Language-aware welcome message (IT/EN/ES/PT).
        const welcomeLang = (session?.user_language || detectedLanguage || 'it') as string;
        const welcomeTemplates = {
            it: {
                registered: (name: string, tier: string) => `Ciao ${name}! 👋 Sono ${BOT_NAME}, la tua assistente AI. Vedo che sei registrato a SCALA con piano ${tier}. Come posso aiutarti oggi? 🚀`,
                anon: `Ciao! 👋 Sono ${BOT_NAME}, la tua assistente AI di SCALA. Sono qui per aiutarti a scoprire come l'intelligenza artificiale può trasformare il tuo business. In che settore operi? 🚀`,
            },
            en: {
                registered: (name: string, tier: string) => `Hi ${name}! 👋 I'm ${BOT_NAME}, your AI assistant. I can see you're registered with SCALA on the ${tier} plan. How can I help you today? 🚀`,
                anon: `Hi! 👋 I'm ${BOT_NAME}, the AI assistant from SCALA. I'm here to help you discover how AI can transform your business. What sector do you work in? 🚀`,
            },
            es: {
                registered: (name: string, tier: string) => `¡Hola ${name}! 👋 Soy ${BOT_NAME}, tu asistente de IA. Veo que estás registrado en SCALA con el plan ${tier}. ¿Cómo puedo ayudarte hoy? 🚀`,
                anon: `¡Hola! 👋 Soy ${BOT_NAME}, la asistente de IA de SCALA. Estoy aquí para ayudarte a descubrir cómo la inteligencia artificial puede transformar tu negocio. ¿En qué sector trabajas? 🚀`,
            },
            pt: {
                registered: (name: string, tier: string) => `Oi ${name}! 👋 Eu sou a ${BOT_NAME}, sua assistente de IA. Vejo que você está registrado na SCALA no plano ${tier}. Como posso te ajudar hoje? 🚀`,
                anon: `Oi! 👋 Eu sou a ${BOT_NAME}, assistente de IA da SCALA. Estou aqui para te ajudar a descobrir como a inteligência artificial pode transformar o seu negócio. Em que setor você atua? 🚀`,
            },
        } as const;
        const tpl = (welcomeTemplates as any)[welcomeLang] || welcomeTemplates.it;

        if (scalaUser) {
            // Link the SCALA user to this WhatsApp session
            await upsertSession(phone, { user_name: scalaUser.full_name } as any);
            // Store scala_user_id in session via direct query
            const { pool } = await import('../db.js');
            await pool.query(
                'UPDATE wa_sessions SET scala_user_id = $1, plan_tier = $2 WHERE phone = $3',
                [scalaUser.id, scalaUser.plan_tier || 'starter', phone]
            );

            const tierName = scalaUser.plan_tier ? scalaUser.plan_tier.charAt(0).toUpperCase() + scalaUser.plan_tier.slice(1) : 'Free';
            const welcome = tpl.registered(scalaUser.full_name || '', tierName);
            await sendHumanized(sock, phone, welcome);
            console.log(`[SCALA-LINK] ${redactPhone(phone)} → user (plan: ${scalaUser.plan_tier})`);
        } else {
            await sendHumanized(sock, phone, tpl.anon);
        }
        // Schedule follow-up chain
        await scheduleFollowups(phone, session.user_name || scalaUser?.full_name, session.sector);
        return;
    }

    // ── Data Entry Detection — if message looks like data, insert via backend ──
    const userSector = session?.sector || 'general';
    if (userSector !== 'general' && looksLikeDataEntry(text)) {
        console.log(`[DATA-ENTRY] ${redactPhone(phone)}: Detected data entry for sector ${userSector}`);
        const scalaUserId = session?.scala_user_id || undefined;
        const result = await callDataEntry(text, userSector, scalaUserId);
        if (result.success) {
            const lang = session?.user_language || 'it';
            const confirmMsgs: Record<string, string> = {
                it: `Ho aggiunto "${result.record}" nel tuo ${userSector}. Serve altro?`,
                en: `I've added "${result.record}" to your ${userSector}. Anything else?`,
                es: `He añadido "${result.record}" a tu ${userSector}. ¿Algo más?`,
                pt: `Adicionei "${result.record}" ao seu ${userSector}. Mais alguma coisa?`,
            };
            const confirmMsg = confirmMsgs[lang] || confirmMsgs.it;
            await sendHumanized(sock, phone, confirmMsg);
            // Store in RAG for future reference
            try { await storeInRAG(text, userSector, 'data-entry'); } catch { /* ignore */ }
            return;
        }
        // If data entry failed, skip CRM extraction (avoid wrong contact detection)
        // and fall through directly to AI response
        console.log(`[DATA-ENTRY] ${redactPhone(phone)}: Failed (${result.error}), skipping CRM extraction, falling through to AI`);
        const aiResp = await getAIResponse(sanitizeUserInput(text).cleaned, session, phone);
        if (aiResp) await sendHumanized(sock, phone, aiResp);
        return;
    }

    // ── CRM Contact Detection — offer to save contact info ──
    const contactInfo = extractContactFromText(text);
    if (contactInfo && userSector !== 'general') {
        const lang = session?.user_language || 'it';
        const offerMsgs: Record<string, string> = {
            it: `Ho notato che hai menzionato ${contactInfo.name}${contactInfo.email ? ` (${contactInfo.email})` : ''}${contactInfo.phone ? ` ${contactInfo.phone}` : ''}. Vuoi che lo aggiunga al tuo CRM?`,
            en: `I noticed you mentioned ${contactInfo.name}${contactInfo.email ? ` (${contactInfo.email})` : ''}${contactInfo.phone ? ` ${contactInfo.phone}` : ''}. Want me to add them to your CRM?`,
            es: `He notado que mencionaste a ${contactInfo.name}${contactInfo.email ? ` (${contactInfo.email})` : ''}${contactInfo.phone ? ` ${contactInfo.phone}` : ''}. ¿Quieres que lo agregue a tu CRM?`,
            pt: `Notei que você mencionou ${contactInfo.name}${contactInfo.email ? ` (${contactInfo.email})` : ''}${contactInfo.phone ? ` ${contactInfo.phone}` : ''}. Quer que eu adicione ao seu CRM?`,
        };
        // Store pending contact in session context for confirmation
        const ctx = session.context || {};
        ctx.pending_contact = contactInfo;
        await upsertSession(phone, { context: ctx } as any);
        await sendHumanized(sock, phone, offerMsgs[lang] || offerMsgs.it);
        return;
    }

    // ── CRM Contact Confirmation — user said yes to previous offer ──
    const pendingContact = session?.context?.pending_contact;
    if (pendingContact && /^(s[iì]|ok|yes|aggiungi|add|salva|save|confirma)/i.test(text.trim())) {
        const contactMsg = `${pendingContact.name || ''}${pendingContact.email ? ' ' + pendingContact.email : ''}${pendingContact.phone ? ' ' + pendingContact.phone : ''}`;
        const result = await callDataEntry(contactMsg, userSector, session?.scala_user_id);
        const ctx = session.context || {};
        delete ctx.pending_contact;
        await upsertSession(phone, { context: ctx } as any);
        if (result.success) {
            const lang = session?.user_language || 'it';
            const doneMsgs: Record<string, string> = {
                it: `Fatto! Ho salvato ${pendingContact.name} nel CRM.`,
                en: `Done! I've saved ${pendingContact.name} to the CRM.`,
                es: `¡Hecho! He guardado ${pendingContact.name} en el CRM.`,
                pt: `Feito! Salvei ${pendingContact.name} no CRM.`,
            };
            await sendHumanized(sock, phone, doneMsgs[lang] || doneMsgs.it);
            return;
        }
        // Fall through if failed
    } else if (pendingContact && /^(no|non|nah|cancel)/i.test(text.trim())) {
        // User declined — clear pending
        const ctx = session.context || {};
        delete ctx.pending_contact;
        await upsertSession(phone, { context: ctx } as any);
    }

    // Detect if user is asking about SCALA platform usage — temporarily switch to scala_user sector
    // BUT: if a real vertical sector was detected, this is NOT a SCALA platform question
    // (e.g. "quanto costa il TARI?" is waste sector, not SCALA pricing)
    const hasSectorContext = session?.sector && session.sector !== 'general' && session.sector !== 'scala_user';
    const isPlatformQuery = !hasSectorContext && isScalaPlatformQuery(text);
    const dominantIntentType = getDominantIntent(intentSignals);
    const isModuleHelp = dominantIntentType === 'help_module' || dominantIntentType === 'create_data' || dominantIntentType === 'analyze';

    let aiSession = session;
    if (isPlatformQuery || isModuleHelp) {
        aiSession = { ...session, sector: 'scala_user' };
        console.log(`[SCALA] ${redactPhone(phone)}: Platform query detected (intent: ${dominantIntentType})`);
    }

    // ── Zero-hallucination gate (Task 1, 2026-04-16) ──
    // Step 1: check RAG confidence against the per-tenant threshold.
    // If below, we still call the LLM, but with a strict fallback system
    // prompt that forbids inventing specifics, then run the forbidden-claim
    // validator on the output.
    const tenantCfg = await getTenantConfig(session?.scala_user_id || null);
    let ragTopScore = 0;
    let cragVerdict: 'correct' | 'ambiguous' | 'incorrect' = 'ambiguous';
    try {
        const { topScore, matches } = await ragSearchWithScore(text, aiSession.sector || 'general', 3);
        ragTopScore = topScore;
        const crag = evaluateRetrieval(matches, text, aiSession.sector || 'general');
        cragVerdict = crag.verdict;
        console.log(`[CRAG] verdict=${crag.verdict} ${crag.reason}`);
    } catch { /* ignore */ }
    const lowConfidence = ragTopScore < tenantCfg.confidenceThreshold || cragVerdict === 'incorrect';
    const outLangHint = (session?.user_language || 'it') as string;

    // ── Resolve branch (Task 3) ──
    let branch = null;
    try {
        const tags: string[] = Array.isArray(session?.context?.tags) ? session.context.tags : [];
        branch = await resolveBranchForPhone(phone, session?.scala_user_id || null, tags);
    } catch { /* ignore */ }
    const branchSnippet = branchContextSnippet(branch, outLangHint);

    // Build escalation target: prefer branch manager, else tenant default.
    const escalation = branch && branch.manager_name
        ? { name: branch.manager_name, email: branch.manager_email || undefined, phone: branch.phone || undefined }
        : { name: tenantCfg.escalationName, email: tenantCfg.escalationEmail || undefined, phone: tenantCfg.escalationPhone || undefined };

    // Thread tone + branch context + (optional) strict instruction into session
    // so downstream sector-prompt assembly in ai.ts picks them up.
    aiSession = {
        ...aiSession,
        tone_preset: tenantCfg.tonePreset,
        branch_context: branchSnippet || null,
        low_confidence: lowConfidence,
        escalation,
    };

    console.log(`[RAG] ${redactPhone(phone)}: topScore=${ragTopScore.toFixed(3)} threshold=${tenantCfg.confidenceThreshold} lowConf=${lowConfidence} tone=${tenantCfg.tonePreset} branch=${branch?.city || 'none'}`);

    // ── Property Listing pre-check (non-blocking, result used after AI response) ──
    const isPropertyListing_check = isPropertyListing(text);

    // Get AI response WITH conversation history
    let response = await getAIResponse(sanitizeUserInput(text).cleaned, aiSession, phone);

    // ── Task 1 post-LLM forbidden-claim guard (only when low confidence) ──
    if (lowConfidence) {
        const allowed: string[] = [
            // Hard-coded correct SCALA prices that must never be flagged.
            // Monthly: Free €0, Growth €97, Scale €197, SOLO SARA €9,90.
            // Annual: Growth €970, Scale €1970. Add-on: €5 per 1000 AI credits.
            // Both decimal separators are listed because the KB quotes SOLO SARA
            // as "€9,90" (IT/ES/PT) and "€9.90" (EN).
            '€0', '€97', '€197', '30',
            '€9,90', '€9.90', '€970', '€1970', '€1.970', '€5',
            'contact@get-scala.com', 'app.get-scala.com', 'get-scala.com',
            escalation.email || '',
            escalation.phone || '',
            escalation.name || '',
        ].filter(Boolean);
        const forbidden = checkForbiddenClaims(response, allowed);
        if (!forbidden.safe) {
            logGuardrailEvent('output_violation', phone, {
                violations: forbidden.violations,
                sample: response,
            });
            console.log(`[GUARDRAIL-LOWCONF] ${redactPhone(phone)}: blocked (${forbidden.violations.join(', ')}) score=${ragTopScore.toFixed(3)}`);
            response = lowConfidenceFallback(outLangHint, escalation);
        }
    }

    // P1 fix: validate output for persona/system-prompt leakage. Replace
    // wholesale on any hit — partial redaction is too risky.
    const outLang = (session?.user_language || 'it') as string;
    const validation = validateOutput(response, outLang);
    if (!validation.safe) {
        logGuardrailEvent('output_violation', phone, {
            violations: validation.violations,
            sample: response,
        });
        response = validation.sanitized;
    }

    // P1 fix: enforce persona rules post-gen (word cap, emoji cap, markdown strip).
    response = enforcePersonaRules(response, 80);

    // ── Strict anti-hallucination check (2026-04-16) ──
    // Catches: unsolicited vertical mentions (e.g. AgencyOS to a prospect
    // asking about PraxisOS) + URLs outside allowed hosts. On violation,
    // replace the full response with the Alessandro escalation fallback.
    // Recent user turns (last 3) used as grounding context to avoid false
    // positives when the user had already mentioned the vertical earlier.
    try {
        let recentUserMsgs: string[] = [];
        if (phone) {
            const { getConversationHistory } = await import('../db.js');
            const hist = await getConversationHistory(phone, 6);
            recentUserMsgs = hist
                .filter((h: any) => h.role === 'user')
                .slice(-3)
                .map((h: any) => h.content as string);
        }
        const strict = strictHallucinationCheck(response, text, recentUserMsgs, outLang);
        if (!strict.safe) {
            logGuardrailEvent('output_violation', phone, {
                violations: strict.violations,
                sample: response,
            });
            console.log(`[STRICT] Hallucination blocked for ${redactPhone(phone)}: ${strict.violations.join(', ')}`);
            response = strict.sanitized;
        }
    } catch (err: any) {
        // Strict check must never crash the handler — log and pass original.
        console.error('[STRICT] check failed:', err.message);
    }

    // ── Smart CTA Logic — DISABLED by default 2026-04-16 ──
    // Root cause of "AgencyOS hallucination" (16 apr 05:34): this block
    // deterministically appended a second sales message based on a heuristic
    // sector classifier that frequently misfires (e.g. prospect asks about
    // PraxisOS+PropertyOS, sector detector guesses 'agenzia', appends
    // "puoi provare AgencyOS gratis qui: app.get-scala.com/agencyos").
    // The LLM (with FACTS injected) already generates contextual CTAs when
    // warranted. Re-enabling this hardcoded append regresses correctness.
    // Keep flag for emergency rollback only. Must be 'true' explicitly.
    if (process.env.DETERMINISTIC_CTA_APPEND === 'true') {
        const messageCount = session.messages_count || 0;
        const shouldShowCTA = (
            (intentScore >= 12 && messageCount >= 3) ||
            (intentScore >= 6 && messageCount >= 5 && session.user_name) ||
            (messageCount >= 15 && !session.cta_shown && session.user_name)
        );
        const lastCTAMsg = session.context?.last_cta_msg || 0;
        const ctaCooldown = messageCount - lastCTAMsg >= 5;

        if (shouldShowCTA && ctaCooldown) {
            const ctaType = intentScore > 0 ? bestCTAType : 'general';
            response += getCTAMessage(session.sector || 'general', ctaType);
            const ctx = session.context || {};
            ctx.last_cta_msg = messageCount;
            ctx.last_cta_type = ctaType;
            await upsertSession(phone, { cta_shown: true, context: ctx } as any);
        }
    }

    // ── SARA Autonomy Gate: check tenant level before sending ──
    // Level 0 (OFF) = send normally. Level 1+ may queue instead.
    let _autonomyQueued = false;
    try {
        const _adminIdAG = await getAdminUserId();
        if (_adminIdAG) {
            _autonomyQueued = await autonomyGate(_adminIdAG, phone, response, text.substring(0, 200));
        }
    } catch { /* fail open — never block a message */ }

    // Send in human-like fashion (with delays, split if long)
    if (!_autonomyQueued) {
        await sendHumanized(sock, phone, response);
    }

    // ── Property Listing Detection: if message looks like a property listing, extract + save ──
    if (isPropertyListing_check) {
        (async () => {
            try {
                const confirmMsg = await processPropertyListingFromText(text, phone, session);
                if (confirmMsg) {
                    await sendHumanized(sock, phone, confirmMsg);
                    await logMessage(phone, 'out', confirmMsg);
                }
            } catch (err: any) {
                console.error('[PROPERTY] non-blocking error:', err.message);
            }
        })();
    }

    // ── Store meaningful exchanges in RAG for learning ──
    const isGreeting = /^(ciao|hi|hello|hey|buongiorno|salve|oi|hola|buenas)\s*[!.?]*$/i.test(text.trim());
    if (!isGreeting && text.length > 20 && userSector !== 'general') {
        try {
            const ragSummary = `Q: ${text.substring(0, 200)}\nA: ${response.substring(0, 300)}`;
            await storeInRAG(ragSummary, userSector, `conversation-${phone.substring(0, 8)}`);
        } catch { /* ignore RAG errors */ }
    }

    // Re-schedule follow-ups after each interaction
    await scheduleFollowups(phone, session.user_name, session.sector);

    // ── Feature 1: Update conversation memory (non-blocking) ──
    updateClientProfile(phone, text, response, session).catch(() => {});
    checkAndGenerateSummary(phone, session.messages_count || 0).catch(() => {});

    // ── L7: Trigger business insights refresh (non-blocking) ──
    try {
        const { maybeRefreshInsights } = await import('../lib/business-insights.js');
        if (session?.scala_user_id) maybeRefreshInsights(session.scala_user_id);
    } catch { /* L7 non-blocking */ }

    // ── L8: Log sentiment (non-blocking, fire-and-forget) ──
    try {
        const { logSentiment } = await import('../lib/sentiment-tracker.js');
        logSentiment(session?.scala_user_id || null, phone, text);
    } catch { /* L8 non-blocking */ }

    // ── L9: Log SARA actions from response (non-blocking, fire-and-forget) ──
    try {
        const { logActions } = await import('../lib/action-memory.js');
        logActions(session?.scala_user_id || null, phone, response);
    } catch { /* L9 non-blocking */ }

    // ── CRM Auto-Sync: every contact → crm_contacts (non-blocking) ──
    // Detects tags from user message, enriches progressively, debounced 5min
    (async () => {
        try {
            const adminId = await getAdminUserId();
            if (!adminId) return;

            // Detect auto-tags from user message
            const crmTags = detectCRMTags(text);

            // Calculate score: base 10 for first contact, +2 per message, +intent bonus
            const msgCount = session.messages_count || 1;
            const baseScore = msgCount <= 1 ? 10 : Math.min(10 + msgCount * 2 + intentScore, 100);

            // Build note from first 100 chars of user message (for activity log)
            const noteSnippet = text.length > 5 ? text.substring(0, 100) : undefined;

            await syncContactToCRM({
                phone,
                name: session.user_name || leadInfo.name || undefined,
                company: session.company_name || leadInfo.company || undefined,
                email: session.email || leadInfo.email || undefined,
                sector: session.sector !== 'general' ? session.sector : undefined,
                company_size: session.company_size || companySize || undefined,
                estimated_revenue: session.estimated_revenue || budget || undefined,
                lead_score: baseScore,
                tags: crmTags,
                note: noteSnippet,
                owner_user_id: adminId,
            });
        } catch (err: any) {
            console.error('[CRM-SYNC] non-blocking error:', err.message, err.stack?.split('\n').slice(0, 3).join(' | '));
        }
    })();

    // Log intent for debugging
    if (intentSignals.length > 0) {
        console.log(`[INTENT] ${redactPhone(phone)}: ${dominantIntent} (score: ${intentScore}, CTA: ${bestCTAType})`);
    }

    console.log(`[OUT] ${redactPhone(phone)}: ${response.substring(0, 40)}...`);
}
