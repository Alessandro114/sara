// ═══════════════════════════════════════════════════════════
// SARA Persistent Memory — L4/L5/L6 Implementation
// L4: Full conversation history per contact (DB-backed)
// L5: Auto-enriching contact profiles
// L6: Business knowledge base search
// ═══════════════════════════════════════════════════════════

import { chatChain, type ChatMsg } from './ai-providers.js';
import { redactPhone } from './phone-utils.js';

// ─── DB connection (SCALA backend DB — same pattern as solo-handler) ───
let _scalaPool: any = null;

async function getScalaPool() {
    if (_scalaPool) return _scalaPool;
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

// ═══════════════════════════════════════════════════════════
// L4 — Conversation History (persistent, DB-backed)
// ═══════════════════════════════════════════════════════════

/**
 * Save a message to the persistent store (sara_solo_messages).
 * Fire-and-forget — never blocks the main message flow.
 */
export async function saveMessage(
    userId: string,
    phone: string,
    direction: 'inbound' | 'outbound',
    body: string,
    messageType: string = 'text',
    metadata?: Record<string, any>
): Promise<void> {
    try {
        const pool = await getScalaPool();
        if (!pool) return;
        await pool.query(
            `INSERT INTO sara_solo_messages (user_id, phone, direction, body, message_type, metadata)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [userId, phone, direction, body, messageType, metadata ? JSON.stringify(metadata) : null]
        );
    } catch (err: any) {
        console.error('[L4] saveMessage error:', err?.message);
    }
}

/**
 * Load the last N messages for a contact from the persistent store.
 * Returns messages in chronological order (oldest first).
 */
export async function loadHistory(
    userId: string,
    phone: string,
    limit: number = 20
): Promise<Array<{ role: 'user' | 'assistant'; content: string; timestamp: Date }>> {
    try {
        const pool = await getScalaPool();
        if (!pool) return [];
        const { rows } = await pool.query(
            `SELECT direction, body, timestamp
             FROM sara_solo_messages
             WHERE user_id = $1 AND phone = $2 AND body IS NOT NULL
             ORDER BY timestamp DESC
             LIMIT $3`,
            [userId, phone, limit]
        );
        return rows.reverse().map((r: any) => ({
            role: r.direction === 'inbound' ? 'user' as const : 'assistant' as const,
            content: r.body,
            timestamp: r.timestamp,
        }));
    } catch (err: any) {
        console.error('[L4] loadHistory error:', err?.message);
        return [];
    }
}

/**
 * Build a conversation summary for older messages.
 * Returns a short string like "Previous interactions: 42 messages over 15 days. Last topic: pricing"
 */
export async function getConversationSummary(
    userId: string,
    phone: string
): Promise<string> {
    try {
        const pool = await getScalaPool();
        if (!pool) return '';
        const { rows } = await pool.query(
            `SELECT
                COUNT(*)::int as total_messages,
                MIN(timestamp) as first_message,
                MAX(timestamp) as last_message
             FROM sara_solo_messages
             WHERE user_id = $1 AND phone = $2`,
            [userId, phone]
        );
        if (!rows[0] || rows[0].total_messages <= 20) return '';

        const total = rows[0].total_messages;
        const firstMsg = new Date(rows[0].first_message);
        const lastMsg = new Date(rows[0].last_message);
        const days = Math.max(1, Math.ceil((lastMsg.getTime() - firstMsg.getTime()) / (1000 * 60 * 60 * 24)));

        // Get last topic from the most recent inbound message outside our history window
        const { rows: topicRows } = await pool.query(
            `SELECT body FROM sara_solo_messages
             WHERE user_id = $1 AND phone = $2 AND direction = 'inbound' AND body IS NOT NULL
             ORDER BY timestamp DESC
             OFFSET 20 LIMIT 1`,
            [userId, phone]
        );
        const lastTopic = topicRows[0]?.body?.substring(0, 80) || 'N/A';

        return `Previous interactions: ${total} messages over ${days} days. Last older topic: "${lastTopic}"`;
    } catch (err: any) {
        console.error('[L4] getConversationSummary error:', err?.message);
        return '';
    }
}

// ═══════════════════════════════════════════════════════════
// L5 — Contact Profile (auto-enriching)
// ═══════════════════════════════════════════════════════════

export interface ContactProfile {
    name: string | null;
    language: string | null;
    sentiment_avg: number | null;
    topics: string[];
    preferences: Record<string, any>;
    intent_history: Array<{ intent: string; date: string }>;
    interaction_count: number;
    first_contact: Date | null;
    last_contact: Date | null;
    profile_summary: string | null;
    tags: string[];
}

/**
 * Get or create the contact profile.
 */
export async function getContactProfile(
    userId: string,
    phone: string
): Promise<ContactProfile | null> {
    try {
        const pool = await getScalaPool();
        if (!pool) return null;
        const { rows } = await pool.query(
            `SELECT * FROM sara_contact_profiles WHERE user_id = $1 AND phone = $2`,
            [userId, phone]
        );
        if (!rows[0]) return null;
        const r = rows[0];
        return {
            name: r.name,
            language: r.language,
            sentiment_avg: r.sentiment_avg ? parseFloat(r.sentiment_avg) : null,
            topics: r.topics || [],
            preferences: r.preferences || {},
            intent_history: r.intent_history || [],
            interaction_count: r.interaction_count || 0,
            first_contact: r.first_contact,
            last_contact: r.last_contact,
            profile_summary: r.profile_summary,
            tags: r.tags || [],
        };
    } catch (err: any) {
        console.error('[L5] getContactProfile error:', err?.message);
        return null;
    }
}

/**
 * Simple bag-of-words language detector for short texts.
 */
function detectLanguageSimple(text: string): string {
    const lower = text.toLowerCase();
    const itWords = ['ciao', 'buongiorno', 'come', 'sono', 'vorrei', 'grazie', 'posso', 'per', 'che', 'non'];
    const enWords = ['hello', 'hi', 'how', 'the', 'and', 'want', 'need', 'can', 'please', 'thanks'];
    const esWords = ['hola', 'buenos', 'como', 'quiero', 'necesito', 'gracias', 'puedo', 'para', 'que'];
    const ptWords = ['ola', 'bom', 'como', 'quero', 'preciso', 'obrigado', 'posso', 'para', 'que', 'voce'];
    const frWords = ['bonjour', 'merci', 'comment', 'vous', 'nous', 'avec', 'pour', 'dans', 'les', 'des', 'salut', 'oui', 'très', 'bien'];
    const deWords = ['hallo', 'guten', 'danke', 'bitte', 'wie', 'ich', 'wir', 'und', 'nicht', 'haben', 'sein', 'mit', 'für', 'auf'];

    const words = lower.split(/\s+/);
    let itScore = 0, enScore = 0, esScore = 0, ptScore = 0, frScore = 0, deScore = 0;
    for (const w of words) {
        if (itWords.includes(w)) itScore++;
        if (enWords.includes(w)) enScore++;
        if (esWords.includes(w)) esScore++;
        if (ptWords.includes(w)) ptScore++;
        if (frWords.includes(w)) frScore++;
        if (deWords.includes(w)) deScore++;
    }
    const scores: [string, number][] = [['it', itScore], ['en', enScore], ['es', esScore], ['pt', ptScore], ['fr', frScore], ['de', deScore]];
    scores.sort((a, b) => b[1] - a[1]);
    return scores[0][1] > 0 ? scores[0][0] : 'it';
}

/**
 * Simple sentiment detection returns 0-1 (0=negative, 0.5=neutral, 1=positive).
 */
function detectSentiment(text: string): number {
    const lower = text.toLowerCase();
    if (/\b(grazie|perfetto|ottimo|fantastico|great|thanks|excellent|amazing|bene|bravo|stupendo|wow|wonderful|love)\b/.test(lower)) return 0.8;
    if (/\b(problema|difficolt|non funzion|frustrat|deluso|bad|terrible|issue|bug|lento|costoso|troppo caro|schifo|horrible)\b/.test(lower)) return 0.2;
    return 0.5;
}

/**
 * Extract simple topic keywords from text.
 */
function extractTopics(text: string): string[] {
    const lower = text.toLowerCase();
    const topicKeywords = [
        'prezzo', 'pricing', 'costo', 'orari', 'hours', 'orario', 'apertura',
        'prenotazione', 'booking', 'appuntamento', 'disponibilita',
        'servizio', 'service', 'prodotto', 'product', 'catalogo',
        'reclamo', 'complaint', 'problema', 'issue', 'reso', 'return',
        'consegna', 'delivery', 'spedizione', 'shipping',
        'pagamento', 'payment', 'fattura', 'invoice',
        'informazioni', 'info', 'dettagli', 'details',
        'promozione', 'sconto', 'offerta', 'sale', 'discount',
    ];
    return topicKeywords.filter(kw => lower.includes(kw));
}

/**
 * Upsert (update or create) the contact profile after each inbound message.
 * This is fire-and-forget — errors must not crash the bot.
 */
export async function upsertContactProfile(
    userId: string,
    phone: string,
    inboundText: string,
    aiResponse?: string
): Promise<void> {
    try {
        const pool = await getScalaPool();
        if (!pool) return;

        const language = detectLanguageSimple(inboundText);
        const sentiment = detectSentiment(inboundText);
        const newTopics = extractTopics(inboundText);

        // Try to extract name from message
        let detectedName: string | null = null;
        const nameMatch = inboundText.match(/(?:mi chiamo|sono|i'?m|my name is|me llamo)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i);
        if (nameMatch && nameMatch[1] && nameMatch[1].length > 2 && nameMatch[1].length < 30) {
            detectedName = nameMatch[1].trim();
        }

        const existing = await getContactProfile(userId, phone);

        if (!existing) {
            // Create new profile
            await pool.query(
                `INSERT INTO sara_contact_profiles
                    (user_id, phone, name, language, sentiment_avg, topics, interaction_count, tags, preferences, intent_history)
                 VALUES ($1, $2, $3, $4, $5, $6, 1, '{}', '{}', '[]')
                 ON CONFLICT (user_id, phone) DO UPDATE SET
                    interaction_count = sara_contact_profiles.interaction_count + 1,
                    last_contact = NOW(),
                    language = COALESCE(EXCLUDED.language, sara_contact_profiles.language)`,
                [userId, phone, detectedName, language, sentiment, newTopics.length > 0 ? newTopics : []]
            );
        } else {
            // Merge topics (keep unique, max 50)
            const mergedTopics = [...new Set([...(existing.topics || []), ...newTopics])].slice(0, 50);

            // Running average sentiment
            const oldAvg = existing.sentiment_avg ?? 0.5;
            const count = existing.interaction_count || 1;
            const newAvg = ((oldAvg * count) + sentiment) / (count + 1);

            const sets: string[] = [
                'interaction_count = interaction_count + 1',
                'last_contact = NOW()',
            ];
            const params: any[] = [];
            let i = 1;

            // Only update name if we detected one and none exists
            if (detectedName && !existing.name) {
                sets.push(`name = $${i++}`);
                params.push(detectedName);
            }
            // Update language
            sets.push(`language = $${i++}`);
            params.push(language);
            // Update sentiment average
            sets.push(`sentiment_avg = $${i++}`);
            params.push(Math.round(newAvg * 100) / 100);
            // Update topics
            sets.push(`topics = $${i++}`);
            params.push(mergedTopics);

            params.push(userId, phone);
            await pool.query(
                `UPDATE sara_contact_profiles SET ${sets.join(', ')} WHERE user_id = $${i++} AND phone = $${i}`,
                params
            );
        }

        // Every 10 interactions, generate a profile summary via AI
        const updatedProfile = await getContactProfile(userId, phone);
        if (updatedProfile && updatedProfile.interaction_count > 0 && updatedProfile.interaction_count % 10 === 0) {
            generateProfileSummary(userId, phone).catch(err =>
                console.error('[L5] generateProfileSummary non-blocking error:', err?.message)
            );
        }
    } catch (err: any) {
        console.error('[L5] upsertContactProfile error:', err?.message);
    }
}

/**
 * Generate an AI profile summary from conversation history.
 * Runs every 10 interactions. Non-blocking.
 */
async function generateProfileSummary(userId: string, phone: string): Promise<void> {
    try {
        const pool = await getScalaPool();
        if (!pool) return;

        // Load last 20 messages
        const history = await loadHistory(userId, phone, 20);
        if (history.length < 5) return; // Not enough data

        const conversationText = history
            .map(m => `${m.role === 'user' ? 'Client' : 'SARA'}: ${m.content.substring(0, 200)}`)
            .join('\n');

        const messages: ChatMsg[] = [
            {
                role: 'system',
                content: `You are a CRM data extraction engine. Analyze the conversation and create a contact profile.
Return ONLY valid JSON:
{
  "name": "string or null",
  "preferences": {"key": "value"},
  "summary": "2-3 sentence profile summary",
  "topics": ["topic1", "topic2"],
  "tags": ["tag1", "tag2"]
}
Rules:
- name: only if the client explicitly said their name
- preferences: extract budget, location, interests, preferred time, etc.
- summary: brief overview of who this contact is and what they want
- topics: main topics discussed
- tags: auto-generated labels (e.g. "hot_lead", "price_sensitive", "returning_customer")
Return ONLY JSON, nothing else.`,
            },
            {
                role: 'user',
                content: `Analyze this conversation:\n${conversationText}`,
            },
        ];

        const result = await chatChain(messages, 300);
        const jsonMatch = result.text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) return;

        const parsed = JSON.parse(jsonMatch[0]);

        const sets: string[] = [];
        const params: any[] = [];
        let i = 1;

        if (parsed.summary) {
            sets.push(`profile_summary = $${i++}`);
            params.push(parsed.summary.substring(0, 1000));
        }
        if (parsed.preferences && typeof parsed.preferences === 'object') {
            sets.push(`preferences = $${i++}`);
            params.push(JSON.stringify(parsed.preferences));
        }
        if (parsed.name) {
            // Only update if no name yet
            sets.push(`name = COALESCE(sara_contact_profiles.name, $${i++})`);
            params.push(parsed.name);
        }
        if (Array.isArray(parsed.tags) && parsed.tags.length > 0) {
            sets.push(`tags = $${i++}`);
            params.push(parsed.tags.slice(0, 20));
        }
        if (Array.isArray(parsed.topics) && parsed.topics.length > 0) {
            sets.push(`topics = $${i++}`);
            params.push(parsed.topics.slice(0, 50));
        }

        if (sets.length > 0) {
            params.push(userId, phone);
            await pool.query(
                `UPDATE sara_contact_profiles SET ${sets.join(', ')} WHERE user_id = $${i++} AND phone = $${i}`,
                params
            );
            console.log(`[L5] Profile summary generated for ${redactPhone(phone)}`);
        }
    } catch (err: any) {
        console.error('[L5] generateProfileSummary error:', err?.message);
    }
}

/**
 * Build the contact profile context string for injection into the AI prompt.
 */
export function buildProfileContext(profile: ContactProfile | null): string {
    if (!profile) return '';

    const parts: string[] = ['[CONTACT PROFILE]'];
    parts.push(`Name: ${profile.name || 'Unknown'}`);
    if (profile.language) parts.push(`Language: ${profile.language}`);
    parts.push(`Interactions: ${profile.interaction_count}`);

    if (profile.first_contact && profile.last_contact) {
        const days = Math.max(1, Math.ceil(
            (new Date(profile.last_contact).getTime() - new Date(profile.first_contact).getTime()) / (1000 * 60 * 60 * 24)
        ));
        parts.push(`History: ${days} days`);
    }

    if (profile.sentiment_avg !== null) {
        const sentLabel = profile.sentiment_avg >= 0.7 ? 'positive'
            : profile.sentiment_avg <= 0.3 ? 'negative'
            : 'neutral';
        parts.push(`Sentiment: ${sentLabel} (${profile.sentiment_avg.toFixed(2)})`);
    }

    if (profile.profile_summary) {
        parts.push(`Summary: ${profile.profile_summary}`);
    }

    if (profile.topics && profile.topics.length > 0) {
        parts.push(`Previous topics: ${profile.topics.slice(-10).join(', ')}`);
    }

    if (profile.preferences && Object.keys(profile.preferences).length > 0) {
        const prefStr = Object.entries(profile.preferences)
            .map(([k, v]) => `${k}: ${v}`)
            .join(', ');
        parts.push(`Preferences: ${prefStr}`);
    }

    if (profile.tags && profile.tags.length > 0) {
        parts.push(`Tags: ${profile.tags.join(', ')}`);
    }

    return parts.join('\n');
}


// ═══════════════════════════════════════════════════════════
// L6 — Business Knowledge Base
// ═══════════════════════════════════════════════════════════

export interface KBItem {
    id: number;
    category: string | null;
    question: string | null;
    answer: string;
    keywords: string[];
    priority: number;
}

/**
 * Search the knowledge base for items matching the user's message.
 * Uses keyword overlap: splits message into words and matches against `keywords[]`.
 * Returns top N items sorted by priority and relevance.
 */
export async function searchKnowledgeBase(
    userId: string,
    messageText: string,
    limit: number = 5
): Promise<KBItem[]> {
    try {
        const pool = await getScalaPool();
        if (!pool) return [];

        // Extract meaningful words from the message (3+ chars, lowercase)
        const words = messageText.toLowerCase()
            .split(/[\s,.!?;:()\[\]{}"']+/)
            .filter(w => w.length >= 3);

        if (words.length === 0) return [];

        // Use PostgreSQL array overlap operator (&&) for efficient keyword matching
        // Also search in question and answer text with ILIKE for broader coverage
        const { rows } = await pool.query(
            `SELECT id, category, question, answer, keywords, priority
             FROM sara_knowledge_base
             WHERE user_id = $1 AND active = true
               AND (
                 keywords && $2::text[]
                 OR question ILIKE ANY(SELECT '%' || unnest($2::text[]) || '%')
                 OR answer ILIKE ANY(SELECT '%' || unnest($2::text[]) || '%')
               )
             ORDER BY priority DESC, id ASC
             LIMIT $3`,
            [userId, words, limit]
        );

        return rows.map((r: any) => ({
            id: r.id,
            category: r.category,
            question: r.question,
            answer: r.answer,
            keywords: r.keywords || [],
            priority: r.priority || 5,
        }));
    } catch (err: any) {
        console.error('[L6] searchKnowledgeBase error:', err?.message);
        return [];
    }
}

/**
 * Build the KB context string for injection into the AI prompt.
 */
export function buildKBContext(items: KBItem[]): string {
    if (!items || items.length === 0) return '';

    const parts: string[] = ['[BUSINESS KNOWLEDGE BASE]'];
    for (const item of items) {
        if (item.question) {
            parts.push(`Q: ${item.question}\nA: ${item.answer}`);
        } else {
            parts.push(`[${item.category || 'info'}] ${item.answer}`);
        }
    }
    parts.push('[END KB] — Use the above information to answer. If the answer is not covered here, say so honestly.');
    return parts.join('\n');
}


// ═══════════════════════════════════════════════════════════
// DB Schema Bootstrap (called from initDB or bot startup)
// ═══════════════════════════════════════════════════════════

/**
 * Ensure all L4/L5/L6 tables exist. Safe to call multiple times.
 * Uses the SCALA backend DB (same as solo-handler).
 */
export async function ensureMemorySchema(): Promise<void> {
    try {
        const pool = await getScalaPool();
        if (!pool) {
            console.warn('[MEMORY-L456] No DB pool available, skipping schema bootstrap');
            return;
        }

        await pool.query(`
            CREATE TABLE IF NOT EXISTS sara_solo_messages (
                id SERIAL PRIMARY KEY,
                user_id UUID NOT NULL,
                phone TEXT NOT NULL,
                direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
                body TEXT,
                message_type TEXT DEFAULT 'text',
                timestamp TIMESTAMPTZ DEFAULT NOW(),
                metadata JSONB
            );
            CREATE INDEX IF NOT EXISTS idx_ssm_user_phone ON sara_solo_messages(user_id, phone, timestamp DESC);
            CREATE INDEX IF NOT EXISTS idx_ssm_phone ON sara_solo_messages(phone);

            CREATE TABLE IF NOT EXISTS sara_contact_profiles (
                id SERIAL PRIMARY KEY,
                user_id UUID NOT NULL,
                phone TEXT NOT NULL,
                name TEXT,
                language TEXT,
                sentiment_avg NUMERIC,
                topics TEXT[],
                preferences JSONB,
                intent_history JSONB,
                interaction_count INTEGER DEFAULT 0,
                first_contact TIMESTAMPTZ DEFAULT NOW(),
                last_contact TIMESTAMPTZ DEFAULT NOW(),
                profile_summary TEXT,
                tags TEXT[],
                UNIQUE(user_id, phone)
            );
            CREATE INDEX IF NOT EXISTS idx_scp_user_phone ON sara_contact_profiles(user_id, phone);

            CREATE TABLE IF NOT EXISTS sara_knowledge_base (
                id SERIAL PRIMARY KEY,
                user_id UUID NOT NULL,
                category TEXT,
                question TEXT,
                answer TEXT NOT NULL,
                keywords TEXT[],
                language TEXT DEFAULT 'it',
                priority INTEGER DEFAULT 5,
                active BOOLEAN DEFAULT true,
                created_at TIMESTAMPTZ DEFAULT NOW()
            );
            CREATE INDEX IF NOT EXISTS idx_skb_user ON sara_knowledge_base(user_id);
            CREATE INDEX IF NOT EXISTS idx_skb_user_active ON sara_knowledge_base(user_id, active) WHERE active = true;
        `);

        console.log('[MEMORY-L456] Schema ready');
    } catch (err: any) {
        console.warn('[MEMORY-L456] Schema bootstrap failed (non-fatal):', err?.message);
    }
}
