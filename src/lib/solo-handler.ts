// ═══════════════════════════════════════════════════════════
// SOLO SARA Message Handler
// Handles inbound messages on customer-owned WhatsApp sessions.
// Reads the customer's sara_solo_config (tone, FAQ, autonomy)
// and generates AI responses within their conversation limits.
//
// Memory Levels:
//   L4 — Full conversation history from DB (not just 6 msgs in RAM)
//   L5 — Auto-enriching contact profile per sender
//   L6 — Business knowledge base (customer-specific KB)
// ═══════════════════════════════════════════════════════════

import { chatChain, type ChatMsg } from './ai-providers.js';
import {
    saveMessage,
    loadHistory,
    getConversationSummary,
    getContactProfile,
    upsertContactProfile,
    buildProfileContext,
    searchKnowledgeBase,
    buildKBContext,
} from './persistent-memory.js';

// ─── DB connection (same pattern as autonomy-gate.ts) ───
let _scalaPool: any = null;

async function getScalaPool() {
    if (_scalaPool) return _scalaPool;
    // SOLO handler needs the SCALA backend DB where sara_solo_config lives.
    // SCALA_DB_URL is the backend DB; DATABASE_URL is the WA bot DB.
    const dbUrl = process.env.SCALA_DB_URL || process.env.DATABASE_URL;
    if (!dbUrl) return null;
    try {
        const pgModule = await import('pg');
        const pg = (pgModule as any).default || pgModule;
        _scalaPool = new pg.Pool({ connectionString: dbUrl, max: 3 });
        _scalaPool.on('error', (err: any) => console.error('[pool] idle client error', err));
        return _scalaPool;
    } catch {
        return null;
    }
}

// ─── Config cache (TTL 2 min) ────────────────────────────────
interface SoloConfig {
    tone_of_voice: string;
    custom_tone_examples: string | null;
    faq_items: Array<{ question: string; answer: string }>;
    autonomy_level: number;
    conversations_used: number;
    conversations_limit: number;
}

const configCache = new Map<string, { value: SoloConfig; expires: number }>();
const CONFIG_TTL_MS = 2 * 60 * 1000; // 2 min

async function getSoloConfig(userId: string): Promise<SoloConfig | null> {
    const cached = configCache.get(userId);
    if (cached && cached.expires > Date.now()) return cached.value;

    const pool = await getScalaPool();
    if (!pool) return null;

    try {
        const { rows } = await pool.query(
            `SELECT tone_of_voice, custom_tone_examples, faq_items,
                    autonomy_level, conversations_used, conversations_limit
             FROM sara_solo_config WHERE user_id = $1`,
            [userId]
        );
        if (!rows[0]) return null;

        const config: SoloConfig = {
            tone_of_voice: rows[0].tone_of_voice || 'professional',
            custom_tone_examples: rows[0].custom_tone_examples || null,
            faq_items: (() => { try { return (typeof rows[0].faq_items === 'string'
                ? JSON.parse(rows[0].faq_items)
                : rows[0].faq_items) || []; } catch { return []; } })(),
            autonomy_level: rows[0].autonomy_level ?? 2,
            conversations_used: rows[0].conversations_used ?? 0,
            conversations_limit: rows[0].conversations_limit ?? 50,
        };

        configCache.set(userId, { value: config, expires: Date.now() + CONFIG_TTL_MS });
        return config;
    } catch (err: any) {
        console.error(`[SOLO-HANDLER] getSoloConfig failed for ${userId}:`, err?.message);
        return null;
    }
}

// ─── Conversation limit check + increment ────────────────────

async function checkAndIncrementConversation(userId: string): Promise<{ allowed: boolean; used: number; limit: number }> {
    const pool = await getScalaPool();
    if (!pool) return { allowed: false, used: 0, limit: 0 };

    try {
        const { rows } = await pool.query(
            `UPDATE sara_solo_config
             SET conversations_used = conversations_used + 1,
                 updated_at = NOW()
             WHERE user_id = $1
               AND conversations_used < conversations_limit
             RETURNING conversations_used, conversations_limit`,
            [userId]
        );

        if (rows[0]) {
            // Invalidate cache after increment
            configCache.delete(userId);
            return {
                allowed: true,
                used: rows[0].conversations_used,
                limit: rows[0].conversations_limit,
            };
        }

        // If no rows updated, user is at or over limit
        const currentRows = await pool.query(
            `SELECT conversations_used, conversations_limit FROM sara_solo_config WHERE user_id = $1`,
            [userId]
        );
        return {
            allowed: false,
            used: currentRows.rows[0]?.conversations_used || 0,
            limit: currentRows.rows[0]?.conversations_limit || 50,
        };
    } catch (err: any) {
        console.error(`[SOLO-HANDLER] checkAndIncrementConversation failed:`, err?.message);
        return { allowed: false, used: 0, limit: 0 };
    }
}

// ─── Conversation tracking (unique senders per billing period) ─
// We track unique sender phones so 10 messages from the same person
// counts as 1 conversation, not 10.
const activeConversations = new Map<string, Set<string>>();

function isNewConversation(userId: string, senderPhone: string): boolean {
    let userConvos = activeConversations.get(userId);
    if (!userConvos) {
        userConvos = new Set();
        activeConversations.set(userId, userConvos);
    }
    if (userConvos.has(senderPhone)) return false;
    userConvos.add(senderPhone);
    return true;
}

// Reset conversation tracking daily (checking if month changed)
let _lastResetMonth = new Date().getMonth();
setInterval(() => {
    const currentMonth = new Date().getMonth();
    if (currentMonth !== _lastResetMonth) {
        activeConversations.clear();
        _lastResetMonth = currentMonth;
        console.log('[SOLO-HANDLER] Monthly conversation tracking reset');
    }
}, 24 * 60 * 60 * 1000); // check daily

// ─── Build system prompt from customer config + L5/L6 context ──

function buildSystemPrompt(
    config: SoloConfig,
    profileContext: string,
    kbContext: string,
    historySummary: string,
): string {
    const toneMap: Record<string, string> = {
        professional: 'Rispondi in modo professionale, preciso e cortese.',
        friendly: 'Rispondi in modo amichevole, caloroso e disponibile. Usa un tono informale ma rispettoso.',
        formal: 'Rispondi in modo formale e istituzionale. Usa il "Lei" e un linguaggio elegante.',
        casual: 'Rispondi in modo casual e diretto. Sii conciso e alla mano.',
        empathetic: 'Rispondi con empatia e comprensione. Mostra che capisci le esigenze del cliente.',
    };

    let prompt = `Sei SARA, un\'assistente AI WhatsApp per un\'attivita commerciale.
${toneMap[config.tone_of_voice] || toneMap.professional}`;

    if (config.custom_tone_examples) {
        prompt += `\n\nEsempi di tono da seguire:\n${config.custom_tone_examples}`;
    }

    // L6: Inject business knowledge base (higher priority than FAQ)
    if (kbContext) {
        prompt += `\n\n${kbContext}`;
    }

    if (config.faq_items && config.faq_items.length > 0) {
        prompt += '\n\nFAQ - Usa queste informazioni per rispondere alle domande:';
        for (const faq of config.faq_items) {
            prompt += `\nD: ${faq.question}\nR: ${faq.answer}`;
        }
    }

    // L5: Inject contact profile context
    if (profileContext) {
        prompt += `\n\n${profileContext}`;
        prompt += '\nUsa queste informazioni sul contatto per personalizzare la risposta. Rivolgiti per nome se lo conosci.';
    }

    // L4: Inject conversation summary for very long histories
    if (historySummary) {
        prompt += `\n\n[CONVERSATION HISTORY SUMMARY]\n${historySummary}`;
    }

    prompt += `\n\nRegole importanti:
- Rispondi SOLO in base alle FAQ, alla Knowledge Base e alle informazioni fornite.
- Se non conosci la risposta, di\' gentilmente che non hai quell\'informazione e suggerisci di contattare direttamente l\'attivita.
- Non inventare MAI informazioni su prezzi, orari, servizi o prodotti.
- Mantieni le risposte brevi e adatte a WhatsApp (max 300 parole).
- Rispondi nella lingua del messaggio ricevuto.
- Non menzionare MAI di essere un\'intelligenza artificiale a meno che non venga chiesto direttamente.`;

    return prompt;
}

// ─── In-memory history kept as fast cache (still useful for ultra-fast access) ─
// Now serves as L1 cache on top of L4 DB persistence.
const messageHistory = new Map<string, Array<{ role: 'user' | 'assistant'; content: string }>>();
const MAX_HISTORY_RAM = 6;

function getHistoryKey(userId: string, senderPhone: string): string {
    return `${userId}:${senderPhone}`;
}

function addToHistory(key: string, role: 'user' | 'assistant', content: string): void {
    let history = messageHistory.get(key) || [];
    history.push({ role, content });
    if (history.length > MAX_HISTORY_RAM) {
        history = history.slice(-MAX_HISTORY_RAM);
    }
    messageHistory.set(key, history);
}

// Clean up old histories periodically (every 6 hours)
setInterval(() => {
    if (messageHistory.size > 10000) {
        messageHistory.clear();
        console.log('[SOLO-HANDLER] Cleared oversized message history cache');
    }
}, 6 * 60 * 60 * 1000);

// ─── Main handler ────────────────────────────────────────────

export async function handleSoloMessage(
    userId: string,
    client: any,        // whatsapp-web.js Client instance
    msg: any,
    senderJid: string,
): Promise<void> {
    // Extract text content (whatsapp-web.js uses msg.body)
    const text = msg.body
        || msg.message?.conversation
        || msg.message?.extendedTextMessage?.text
        || '';

    if (!text.trim()) {
        // Non-text messages: politely decline
        await client.sendMessage(senderJid, 'Al momento posso rispondere solo a messaggi di testo. Scrivimi la tua domanda!');
        return;
    }

    // Load customer's SOLO config
    const config = await getSoloConfig(userId);
    if (!config) {
        console.error(`[SOLO-HANDLER] No sara_solo_config found for user ${userId}`);
        await client.sendMessage(senderJid, 'Il servizio non e ancora configurato. Contatta l\'attivita per maggiori informazioni.');
        return;
    }

    // Check conversation limit (only count NEW unique senders)
    const senderPhone = senderJid.replace(/@s\.whatsapp\.net$/, '');
    if (isNewConversation(userId, senderPhone)) {
        const limitCheck = await checkAndIncrementConversation(userId);
        if (!limitCheck.allowed) {
            console.warn(`[SOLO-HANDLER] ${userId} hit conversation limit (${limitCheck.used}/${limitCheck.limit})`);
            await client.sendMessage(senderJid, 'Il servizio di assistenza automatica ha raggiunto il limite mensile. Contatta direttamente l\'attivita per assistenza.');
            return;
        }
        console.log(`[SOLO-HANDLER] ${userId} new conversation with ${senderPhone} (${limitCheck.used}/${limitCheck.limit})`);
    }

    // ── L4: Save inbound message to persistent store (fire-and-forget) ──
    saveMessage(userId, senderPhone, 'inbound', text, 'text').catch(() => {});

    // ── L4: Load conversation history from DB (last 20 messages) ──
    let dbHistory: Array<{ role: 'user' | 'assistant'; content: string }> = [];
    let historySummary = '';
    try {
        const fullHistory = await loadHistory(userId, senderPhone, 20);
        dbHistory = fullHistory.map(h => ({ role: h.role, content: h.content }));
        // Get summary of older conversations
        historySummary = await getConversationSummary(userId, senderPhone);
    } catch (err: any) {
        console.error('[SOLO-HANDLER] L4 history load failed (using RAM):', err?.message);
        // Fallback to in-memory history
        const historyKey = getHistoryKey(userId, senderPhone);
        dbHistory = messageHistory.get(historyKey) || [];
    }

    // ── L5: Load contact profile ──
    let profileContext = '';
    try {
        const profile = await getContactProfile(userId, senderPhone);
        profileContext = buildProfileContext(profile);
    } catch (err: any) {
        console.error('[SOLO-HANDLER] L5 profile load failed:', err?.message);
    }

    // ── L6: Search knowledge base for relevant items ──
    let kbContext = '';
    try {
        const kbItems = await searchKnowledgeBase(userId, text, 5);
        kbContext = buildKBContext(kbItems);
        if (kbItems.length > 0) {
            console.log(`[SOLO-HANDLER] L6: ${kbItems.length} KB items matched for "${text.substring(0, 40)}..."`);
        }
    } catch (err: any) {
        console.error('[SOLO-HANDLER] L6 KB search failed:', err?.message);
    }

    // Build AI messages with enriched context
    const systemPrompt = buildSystemPrompt(config, profileContext, kbContext, historySummary);

    const messages: ChatMsg[] = [
        { role: 'system', content: systemPrompt },
        // L4: Use DB-backed history (last 20 messages) instead of 6-msg RAM cache
        ...dbHistory.map(h => ({ role: h.role as 'user' | 'assistant', content: h.content })),
        { role: 'user', content: text },
    ];

    // Generate AI response
    try {
        const result = await chatChain(messages, 400);
        const response = result.text.trim();

        if (!response) {
            await client.sendMessage(senderJid, 'Mi scuso, non sono riuscita a elaborare una risposta. Riprova tra poco!');
            return;
        }

        // Add a small typing delay for realism (1-3 seconds)
        const typingDelay = 1000 + Math.random() * 2000;
        await new Promise(r => setTimeout(r, typingDelay));

        // Send response
        await client.sendMessage(senderJid, response);

        // ── L4: Save outbound message to persistent store (fire-and-forget) ──
        saveMessage(userId, senderPhone, 'outbound', response, 'text').catch(() => {});

        // Track in-memory history (L1 fast cache, still useful if DB is slow)
        const historyKey = getHistoryKey(userId, senderPhone);
        addToHistory(historyKey, 'user', text);
        addToHistory(historyKey, 'assistant', response);

        // ── L5: Update contact profile (fire-and-forget) ──
        upsertContactProfile(userId, senderPhone, text, response).catch(err =>
            console.error('[SOLO-HANDLER] L5 profile update failed:', err?.message)
        );

        console.log(`[SOLO-HANDLER] ${userId} replied to ${senderPhone} via ${result.provider} [L4:DB L5:profile L6:${kbContext ? 'kb' : 'none'}]`);
    } catch (err: any) {
        console.error(`[SOLO-HANDLER] AI call failed for ${userId}:`, err?.message);
        await client.sendMessage(senderJid, 'Mi scuso, si e verificato un problema tecnico. Contatta direttamente l\'attivita per assistenza.');
    }
}
