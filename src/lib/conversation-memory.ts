// ═══════════════════════════════════════════════════
// SARA Conversation Memory — Multi-level RAG Memory System
// TalkMind-competitive: unlimited conversation history via RAG
// ═══════════════════════════════════════════════════

import { pool } from '../config.js';
import { chatChain, type ChatMsg } from './ai-providers.js';
import { redactPhone } from './phone-utils.js';

// ─── Types ───

export interface ClientProfile {
    phone: string;
    user_id?: string;
    name?: string;
    company?: string;
    sector?: string;
    role?: string;
    interests: string[];
    pain_points: string[];
    budget_range?: string;
    decision_timeline?: string;
    communication_style: 'formal' | 'informal' | 'technical' | 'simple';
    sentiment_history: Array<{ date: string; sentiment: 'positive' | 'neutral' | 'negative' }>;
    key_quotes: string[];
    total_interactions: number;
    last_interaction?: string;
}

export interface ConversationSummary {
    id: number;
    phone: string;
    summary: string;
    message_range: string;
    key_topics: string[];
    action_items: string[];
    created_at: string;
}

// ─── DB Init (called from initDB) ───

export async function initMemoryTables(): Promise<void> {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS wa_client_profiles (
            id SERIAL PRIMARY KEY,
            phone TEXT UNIQUE NOT NULL,
            user_id TEXT,
            name TEXT,
            company TEXT,
            sector TEXT,
            role TEXT,
            interests TEXT[] DEFAULT '{}',
            pain_points TEXT[] DEFAULT '{}',
            budget_range TEXT,
            decision_timeline TEXT,
            communication_style TEXT DEFAULT 'informal',
            sentiment_history JSONB DEFAULT '[]',
            key_quotes TEXT[] DEFAULT '{}',
            total_interactions INT DEFAULT 0,
            first_interaction TIMESTAMPTZ DEFAULT NOW(),
            last_interaction TIMESTAMPTZ DEFAULT NOW(),
            profile_version INT DEFAULT 1,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS wa_conversation_summaries (
            id SERIAL PRIMARY KEY,
            phone TEXT NOT NULL,
            summary TEXT NOT NULL,
            message_range TEXT,
            key_topics TEXT[] DEFAULT '{}',
            action_items TEXT[] DEFAULT '{}',
            created_at TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE INDEX IF NOT EXISTS idx_wa_client_profiles_phone ON wa_client_profiles(phone);
        CREATE INDEX IF NOT EXISTS idx_wa_conv_summaries_phone ON wa_conversation_summaries(phone, created_at DESC);
    `);
    console.log('[MEMORY] Tables ready');
}

// ─── Get Client Profile ───

export async function getClientProfile(phone: string): Promise<ClientProfile | null> {
    try {
        const r = await pool.query(
            'SELECT * FROM wa_client_profiles WHERE phone = $1',
            [phone]
        );
        if (r.rows.length === 0) return null;
        const row = r.rows[0];
        return {
            phone: row.phone,
            user_id: row.user_id,
            name: row.name,
            company: row.company,
            sector: row.sector,
            role: row.role,
            interests: row.interests || [],
            pain_points: row.pain_points || [],
            budget_range: row.budget_range,
            decision_timeline: row.decision_timeline,
            communication_style: row.communication_style || 'informal',
            sentiment_history: row.sentiment_history || [],
            key_quotes: row.key_quotes || [],
            total_interactions: row.total_interactions || 0,
            last_interaction: row.last_interaction,
        };
    } catch (err: any) {
        console.error('[MEMORY] getClientProfile error:', err.message);
        return null;
    }
}

// ─── Update Client Profile (after each exchange) ───

export async function updateClientProfile(
    phone: string,
    message: string,
    aiResponse: string,
    session?: any
): Promise<void> {
    try {
        // 1. Extract new info via lightweight AI call (fallback to empty on failure)
        let extractedInfo: ExtractedInfo;
        try {
            extractedInfo = await extractProfileInfo(message, aiResponse);
        } catch (extractErr: any) {
            console.error('[MEMORY] extractProfileInfo failed, using bare profile:', extractErr.message);
            extractedInfo = { interests: [], pain_points: [], sentiment: 'neutral' };
        }

        // 2. Upsert profile — ALWAYS create for every new phone number
        const existing = await getClientProfile(phone);

        if (!existing) {
            // Create new profile
            await pool.query(
                `INSERT INTO wa_client_profiles (phone, name, company, sector, role, interests, pain_points,
                 budget_range, communication_style, total_interactions, user_id)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 1, $10)
                 ON CONFLICT (phone) DO UPDATE SET
                    total_interactions = wa_client_profiles.total_interactions + 1,
                    last_interaction = NOW(),
                    updated_at = NOW()`,
                [
                    phone,
                    extractedInfo.name || session?.user_name || null,
                    extractedInfo.company || session?.company_name || null,
                    extractedInfo.sector || session?.sector || null,
                    extractedInfo.role || null,
                    extractedInfo.interests.length > 0 ? extractedInfo.interests : [],
                    extractedInfo.pain_points.length > 0 ? extractedInfo.pain_points : [],
                    extractedInfo.budget_range || null,
                    extractedInfo.communication_style || 'informal',
                    session?.scala_user_id || null,
                ]
            );
        } else {
            // Merge new data into existing profile
            const mergedInterests = [...new Set([...existing.interests, ...extractedInfo.interests])].slice(0, 20);
            const mergedPainPoints = [...new Set([...existing.pain_points, ...extractedInfo.pain_points])].slice(0, 20);
            const mergedQuotes = [...(existing.key_quotes || [])];
            if (extractedInfo.key_quote) {
                mergedQuotes.push(extractedInfo.key_quote);
                // Keep last 10 quotes
                while (mergedQuotes.length > 10) mergedQuotes.shift();
            }

            // Add sentiment
            const sentiment = extractedInfo.sentiment || 'neutral';
            const sentimentHistory = [...(existing.sentiment_history || [])];
            sentimentHistory.push({ date: new Date().toISOString(), sentiment });
            // Keep last 50 sentiment entries
            while (sentimentHistory.length > 50) sentimentHistory.shift();

            const sets: string[] = [
                'total_interactions = total_interactions + 1',
                'last_interaction = NOW()',
                'updated_at = NOW()',
            ];
            const params: any[] = [];
            let i = 1;

            // Only update fields if we have new info (AI extraction OR session fallback)
            const newName = extractedInfo.name || (session?.user_name && !existing.name ? session.user_name : null);
            if (newName && !existing.name) {
                sets.push(`name = $${i++}`);
                params.push(newName);
            }
            const newCompany = extractedInfo.company || (session?.company_name && !existing.company ? session.company_name : null);
            if (newCompany && !existing.company) {
                sets.push(`company = $${i++}`);
                params.push(newCompany);
            }
            const newSector = extractedInfo.sector || (session?.sector && session.sector !== 'general' && !existing.sector ? session.sector : null);
            if (newSector && (!existing.sector || existing.sector === 'general')) {
                sets.push(`sector = $${i++}`);
                params.push(newSector);
            }
            if (extractedInfo.role && !existing.role) {
                sets.push(`role = $${i++}`);
                params.push(extractedInfo.role);
            }
            if (extractedInfo.budget_range && !existing.budget_range) {
                sets.push(`budget_range = $${i++}`);
                params.push(extractedInfo.budget_range);
            }
            if (extractedInfo.decision_timeline && !existing.decision_timeline) {
                sets.push(`decision_timeline = $${i++}`);
                params.push(extractedInfo.decision_timeline);
            }
            if (extractedInfo.communication_style && extractedInfo.communication_style !== 'informal') {
                sets.push(`communication_style = $${i++}`);
                params.push(extractedInfo.communication_style);
            }

            sets.push(`interests = $${i++}`);
            params.push(mergedInterests);
            sets.push(`pain_points = $${i++}`);
            params.push(mergedPainPoints);
            sets.push(`key_quotes = $${i++}`);
            params.push(mergedQuotes);
            sets.push(`sentiment_history = $${i++}`);
            params.push(JSON.stringify(sentimentHistory));

            params.push(phone);
            await pool.query(
                `UPDATE wa_client_profiles SET ${sets.join(', ')} WHERE phone = $${i}`,
                params
            );
        }
    } catch (err: any) {
        // Non-blocking — memory update failures should never break the main flow
        console.error('[MEMORY] updateClientProfile error:', err.message);
    }
}

// ─── Generate Session Summary (every N messages) ───

export async function generateSessionSummary(
    phone: string,
    messages: Array<{ role: string; content: string }>,
    messageRange: string
): Promise<string | null> {
    try {
        const conversationText = messages
            .map(m => `${m.role === 'user' ? 'Cliente' : 'SARA'}: ${m.content}`)
            .join('\n');

        const aiMessages: ChatMsg[] = [
            {
                role: 'system',
                content: `Sei un analista di conversazioni. Riassumi la conversazione in modo strutturato.
Formato JSON:
{
  "summary": "riassunto in 2-3 frasi",
  "key_topics": ["topic1", "topic2"],
  "action_items": ["action1", "action2"],
  "sentiment": "positive|neutral|negative"
}
Rispondi SOLO con il JSON, niente altro.`,
            },
            {
                role: 'user',
                content: `Riassumi questa conversazione:\n${conversationText}`,
            },
        ];

        const result = await chatChain(aiMessages, 300);
        let parsed: any;
        try {
            // Extract JSON from response (handle markdown code blocks)
            const jsonMatch = result.text.match(/\{[\s\S]*\}/);
            parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
        } catch {
            parsed = { summary: result.text.substring(0, 500), key_topics: [], action_items: [] };
        }

        if (parsed?.summary) {
            await pool.query(
                `INSERT INTO wa_conversation_summaries (phone, summary, message_range, key_topics, action_items)
                 VALUES ($1, $2, $3, $4, $5)`,
                [
                    phone,
                    parsed.summary,
                    messageRange,
                    parsed.key_topics || [],
                    parsed.action_items || [],
                ]
            );
            console.log(`[MEMORY] Session summary stored for ${redactPhone(phone)}: ${messageRange}`);
            return parsed.summary;
        }
        return null;
    } catch (err: any) {
        console.error('[MEMORY] generateSessionSummary error:', err.message);
        return null;
    }
}

// ─── Get Memory Context for RAG injection ───

export async function getMemoryContext(phone: string, currentQuestion: string, session?: any): Promise<string> {
    const parts: string[] = [];

    try {
        // Level 3: Client profile
        const profile = await getClientProfile(phone);
        if (profile) {
            const profileParts: string[] = [];
            if (profile.name) profileParts.push(`Nome: ${profile.name}`);
            if (profile.company) profileParts.push(`Azienda: ${profile.company}`);
            if (profile.sector) profileParts.push(`Settore: ${profile.sector}`);
            if (profile.role) profileParts.push(`Ruolo: ${profile.role}`);
            if (profile.interests.length > 0) profileParts.push(`Interessi: ${profile.interests.join(', ')}`);
            if (profile.pain_points.length > 0) profileParts.push(`Pain points: ${profile.pain_points.join(', ')}`);
            if (profile.budget_range) profileParts.push(`Budget: ${profile.budget_range}`);
            if (profile.decision_timeline) profileParts.push(`Timeline decisione: ${profile.decision_timeline}`);
            if (profile.communication_style !== 'informal') profileParts.push(`Stile comunicazione: ${profile.communication_style}`);
            if (profile.total_interactions > 0) profileParts.push(`Interazioni totali: ${profile.total_interactions}`);

            if (profileParts.length > 0) {
                parts.push(`[PROFILO CLIENTE]\n${profileParts.join('\n')}`);
            }

            // Add last sentiment trend
            if (profile.sentiment_history.length >= 3) {
                const lastN = profile.sentiment_history.slice(-5);
                const sentiments = lastN.map(s => s.sentiment).join(', ');
                parts.push(`[TREND SENTIMENT] Ultime interazioni: ${sentiments}`);
            }

            // Add key quotes (relevant ones)
            if (profile.key_quotes.length > 0) {
                const relevantQuotes = profile.key_quotes.slice(-3);
                parts.push(`[CITAZIONI IMPORTANTI]\n${relevantQuotes.map(q => `- "${q}"`).join('\n')}`);
            }
        }

        // Level 2: Recent conversation summaries
        const summaries = await pool.query(
            `SELECT summary, key_topics, action_items, message_range, created_at
             FROM wa_conversation_summaries
             WHERE phone = $1
             ORDER BY created_at DESC
             LIMIT 5`,
            [phone]
        );

        if (summaries.rows.length > 0) {
            const summaryTexts = summaries.rows.map((s: any) => {
                let text = `[${s.message_range || 'precedente'}] ${s.summary}`;
                if (s.action_items?.length > 0) {
                    text += ` | Azioni pendenti: ${s.action_items.join(', ')}`;
                }
                return text;
            });
            parts.push(`[RIASSUNTI CONVERSAZIONI PRECEDENTI]\n${summaryTexts.join('\n')}`);
        }

        // ─── L6: Knowledge Base (FAQ + uploaded docs) ───
        const userId = session?.scala_user_id || 'd256eee6-3dab-4525-9421-a1b9f5d3c8fa';
        if (userId) {
            try {
                const { searchKnowledgeBase, buildKBContext } = await import('./persistent-memory.js');
                const kbItems = await searchKnowledgeBase(userId, currentQuestion);
                const kbCtx = buildKBContext(kbItems);
                if (kbCtx) parts.push(kbCtx);
            } catch { /* L6 is non-blocking */ }
        }

        // ─── L7: Business Insights (cross-contact learning) ───
        if (userId) {
            try {
                const { getBusinessInsightsContext } = await import('./business-insights.js');
                const insightsCtx = await getBusinessInsightsContext(userId);
                if (insightsCtx) parts.push(insightsCtx);
            } catch { /* L7 is non-blocking */ }
        }

        // ─── L8: Sentiment context ───
        try {
            const { getSentimentContext } = await import('./sentiment-tracker.js');
            const sentimentCtx = await getSentimentContext(phone);
            if (sentimentCtx) parts.push(sentimentCtx);
        } catch { /* L8 is non-blocking */ }

        // ─── L9: Action memory ───
        try {
            const { getActionContext } = await import('./action-memory.js');
            const actionCtx = await getActionContext(phone);
            if (actionCtx) parts.push(actionCtx);
        } catch { /* L9 is non-blocking */ }

        // ─── L10: Global insights (vertical-level knowledge) ───
        const sector = session?.sector;
        if (sector && sector !== 'general') {
            try {
                const verticalMap: Record<string, string> = {
                    restaurant: 'dineos', real_estate: 'propertyos', beauty: 'beautyos',
                    automotive: 'motoros', agency: 'agencyos', cleaning: 'cleanos',
                    travel: 'travelos', medical: 'dermalyos', legal: 'praxisos',
                    network: 'networkos', studio: 'studioos',
                };
                const vertical = verticalMap[sector] || sector;
                const globalR = await pool.query(
                    `SELECT insight FROM sara_global_insights
                     WHERE vertical = $1
                     ORDER BY generated_at DESC LIMIT 5`,
                    [vertical]
                );
                if (globalR.rows.length > 0) {
                    const insights = globalR.rows.map((r: any) => `- ${r.insight}`).join('\n');
                    parts.push(`[INDUSTRY KNOWLEDGE]\n${insights}`);
                }
            } catch { /* L10 is non-blocking */ }
        }

    } catch (err: any) {
        console.error('[MEMORY] getMemoryContext error:', err.message);
    }

    return parts.length > 0 ? parts.join('\n\n') : '';
}

// ─── Check if session summary is needed ───

export async function checkAndGenerateSummary(
    phone: string,
    messageCount: number
): Promise<void> {
    // Generate summary every 5 messages (lowered from 10 for better coverage)
    if (messageCount > 0 && messageCount % 5 === 0) {
        try {
            const r = await pool.query(
                `SELECT direction, content FROM wa_messages
                 WHERE phone = $1 AND media_type = 'text'
                 ORDER BY created_at DESC LIMIT 5`,
                [phone]
            );
            if (r.rows.length >= 3) {
                const messages = r.rows.reverse().map((row: any) => ({
                    role: row.direction === 'in' ? 'user' : 'assistant',
                    content: row.content,
                }));
                const startMsg = messageCount - 4;
                const endMsg = messageCount;
                await generateSessionSummary(phone, messages, `msg ${startMsg}-${endMsg}`);
            }
        } catch (err: any) {
            console.error('[MEMORY] checkAndGenerateSummary error:', err.message);
        }
    }
}

// ─── Private: Extract profile info from conversation ───

interface ExtractedInfo {
    name?: string;
    company?: string;
    role?: string;
    sector?: string;
    interests: string[];
    pain_points: string[];
    budget_range?: string;
    decision_timeline?: string;
    communication_style?: string;
    sentiment?: 'positive' | 'neutral' | 'negative';
    key_quote?: string;
}

// ─── Agent Profile (Feature 2: Personality Cloning) ───

export interface AgentProfile {
    id: number;
    user_id: string;
    agent_name: string;
    greeting_style?: string;
    communication_tone: string;
    typical_phrases: string[];
    expertise_areas: string[];
    languages: string[];
    response_length: string;
    emoji_usage: string;
    signature?: string;
    active: boolean;
}

export async function getAgentProfile(userId: string): Promise<AgentProfile | null> {
    try {
        const r = await pool.query(
            'SELECT * FROM sara_agent_profiles WHERE user_id = $1 AND active = true LIMIT 1',
            [userId]
        );
        return r.rows[0] || null;
    } catch (err: any) {
        console.error('[MEMORY] getAgentProfile error:', err.message);
        return null;
    }
}

// ─── AI Mode (Feature 4: AI/Human Toggle) ───

export async function getAiMode(phone: string): Promise<{ mode: string; operator: string | null }> {
    try {
        const r = await pool.query(
            'SELECT ai_mode, assigned_operator FROM wa_sessions WHERE phone = $1',
            [phone]
        );
        if (r.rows.length === 0) return { mode: 'auto', operator: null };
        return {
            mode: r.rows[0].ai_mode || 'auto',
            operator: r.rows[0].assigned_operator || null,
        };
    } catch {
        return { mode: 'auto', operator: null };
    }
}

export async function setAiMode(phone: string, mode: string, operatorId?: string): Promise<void> {
    try {
        const validModes = ['auto', 'ai_only', 'human_only', 'hybrid'];
        if (!validModes.includes(mode)) return;
        if (operatorId) {
            await pool.query(
                'UPDATE wa_sessions SET ai_mode = $1, assigned_operator = $2 WHERE phone = $3',
                [mode, operatorId, phone]
            );
        } else {
            await pool.query(
                'UPDATE wa_sessions SET ai_mode = $1 WHERE phone = $2',
                [mode, phone]
            );
        }
    } catch (err: any) {
        console.error('[MEMORY] setAiMode error:', err.message);
    }
}

// ─── Get Recent Summaries (for RAG injection) ───

export async function getRecentSummaries(phone: string, limit: number = 3): Promise<string> {
    try {
        const r = await pool.query(
            `SELECT summary, key_topics, action_items, message_range, created_at
             FROM wa_conversation_summaries
             WHERE phone = $1
             ORDER BY created_at DESC
             LIMIT $2`,
            [phone, limit]
        );
        if (r.rows.length === 0) return '';
        return r.rows.map((s: any) => {
            let text = `[${s.message_range || 'precedente'}] ${s.summary}`;
            if (s.action_items?.length > 0) {
                text += ` | Azioni: ${s.action_items.join(', ')}`;
            }
            return text;
        }).join('\n');
    } catch (err: any) {
        console.error('[MEMORY] getRecentSummaries error:', err.message);
        return '';
    }
}

// Two-phase: fast regex extraction ALWAYS runs, then async AI extraction
// enriches when the message has enough substance.

async function extractProfileInfo(message: string, aiResponse: string): Promise<ExtractedInfo> {
    // Phase 1: Quick regex extraction (no AI cost, always runs)
    const result: ExtractedInfo = {
        interests: [],
        pain_points: [],
    };

    const lower = message.toLowerCase();

    // Sentiment detection (simple)
    if (/\b(grazie|perfetto|ottimo|fantastico|great|thanks|excellent|amazing|bene|bravo|stupendo|wow)\b/i.test(lower)) {
        result.sentiment = 'positive';
    } else if (/\b(problema|difficolt|non funzion|frustrat|deluso|bad|terrible|issue|bug|lento|costoso|troppo caro|delusione|schifo)\b/i.test(lower)) {
        result.sentiment = 'negative';
    } else {
        result.sentiment = 'neutral';
    }

    // Communication style detection
    if (/\b(kpi|roi|cac|ltv|api|sdk|saas|b2b|crm|erp|funnel|churn|retention)\b/i.test(lower)) {
        result.communication_style = 'technical';
    } else if (/\b(egregio|gentile|cordiali saluti|distinti saluti|pregiat|spettabile)\b/i.test(lower)) {
        result.communication_style = 'formal';
    }

    // Budget detection
    if (/\b(\d+)\s*(k|mila|thousand|euro|eur|\$|usd)\b/i.test(lower)) {
        const match = lower.match(/\b(\d+)\s*(k|mila|thousand|euro|eur|\$|usd)\b/i);
        if (match) {
            const num = parseInt(match[1]);
            if (['k', 'mila', 'thousand'].includes(match[2]?.toLowerCase())) {
                result.budget_range = `${num}K`;
            } else {
                result.budget_range = `${num} EUR`;
            }
        }
    }

    // Timeline detection
    const timelineMatch = lower.match(/\b(entro|within|por|antes de|fra|tra|in)\s+([\w\s]+?)(mesi?|months?|settimane?|weeks?|giorni?|days?|anno|year)\b/i);
    if (timelineMatch) {
        result.decision_timeline = `${timelineMatch[2].trim()} ${timelineMatch[3]}`;
    }

    // Role detection
    if (/\b(ceo|founder|titolare|proprietario|owner|direttore|manager|responsabile|partner|socio|cto|cfo|coo|amministratore delegato|libero professionista|freelance)\b/i.test(lower)) {
        const roleMatch = lower.match(/\b(ceo|founder|titolare|proprietario|owner|direttore|manager|responsabile|partner|socio|cto|cfo|coo|amministratore delegato|libero professionista|freelance)\b/i);
        if (roleMatch) result.role = roleMatch[1];
    }

    // Name detection (regex - "mi chiamo X", "sono X", "I'm X")
    const namePatterns = [
        /(?:mi chiamo|sono|i'?m|my name is|me llamo|meu nome)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i,
        /(?:^|\s)([A-Z][a-z]+)\s+(?:qui|here|aqui)/i,
    ];
    for (const pat of namePatterns) {
        const nameMatch = message.match(pat);
        if (nameMatch && nameMatch[1] && nameMatch[1].length > 2 && nameMatch[1].length < 30) {
            result.name = nameMatch[1].trim();
            break;
        }
    }

    // Company detection (regex - "azienda X", "company X", "lavoro per/in X")
    const companyPatterns = [
        /(?:azienda|company|impresa|ditta|studio|negozio|ristorante|hotel|agenzia|lavoro (?:per|in|da|a))\s+([A-Z][\w\s&'.,-]+)/i,
        /(?:la mia|my)\s+(?:azienda|company|ditta|attivit[aà])\s+(?:[eè]|is|si chiama)\s+([A-Z][\w\s&'.,-]+)/i,
    ];
    for (const pat of companyPatterns) {
        const compMatch = message.match(pat);
        if (compMatch && compMatch[1] && compMatch[1].length > 2 && compMatch[1].length < 60) {
            result.company = compMatch[1].trim().replace(/[.,]+$/, '');
            break;
        }
    }

    // Key quote (interesting statements about business needs)
    if (message.length > 30 && /\b(bisogno|necessit|problem|vorrei|need|want|looking for|cerco|devo|serve|mi interessa|voglio)\b/i.test(lower)) {
        result.key_quote = message.substring(0, 200);
    }

    // Interest/pain point extraction from keywords
    const interestKeywords = [
        'crm', 'automazione', 'marketing', 'vendite', 'fatturazione', 'analytics',
        'whatsapp', 'social', 'seo', 'ai', 'chatbot', 'email', 'website',
        'prenotazioni', 'booking', 'inventario', 'magazzino', 'contabilita',
        'newsletter', 'lead generation', 'advertising', 'ecommerce',
    ];
    for (const kw of interestKeywords) {
        if (lower.includes(kw)) result.interests.push(kw);
    }

    const painKeywords = [
        'troppo tempo', 'costo', 'manuale', 'errori', 'clienti persi', 'disorganizzazione',
        'no automation', 'spreadsheet', 'excel', 'carta', 'lento', 'complicato',
        'perdo tempo', 'non riesco', 'difficile', 'confuso', 'troppo complicato',
        'non so come', 'non capisco', 'frustrante',
    ];
    for (const kw of painKeywords) {
        if (lower.includes(kw)) result.pain_points.push(kw);
    }

    // Phase 2: AI-powered extraction for richer messages (non-blocking, cheap)
    // Only invoke AI if the message has enough substance to extract from
    if (message.length >= 20) {
        try {
            const aiExtracted = await extractProfileInfoAI(message, aiResponse);
            // Merge AI results into regex results (AI wins on null fields)
            if (aiExtracted.name && !result.name) result.name = aiExtracted.name;
            if (aiExtracted.company && !result.company) result.company = aiExtracted.company;
            if (aiExtracted.role && !result.role) result.role = aiExtracted.role;
            if (aiExtracted.sector) result.sector = aiExtracted.sector;
            if (aiExtracted.budget_range && !result.budget_range) result.budget_range = aiExtracted.budget_range;
            if (aiExtracted.decision_timeline && !result.decision_timeline) result.decision_timeline = aiExtracted.decision_timeline;
            if (aiExtracted.key_quote && !result.key_quote) result.key_quote = aiExtracted.key_quote;
            if (aiExtracted.sentiment && aiExtracted.sentiment !== 'neutral') result.sentiment = aiExtracted.sentiment;
            if (aiExtracted.interests.length > 0) {
                result.interests = [...new Set([...result.interests, ...aiExtracted.interests])];
            }
            if (aiExtracted.pain_points.length > 0) {
                result.pain_points = [...new Set([...result.pain_points, ...aiExtracted.pain_points])];
            }
        } catch (err: any) {
            // AI extraction failed — regex results are still valid
            console.error('[MEMORY] AI extraction failed (using regex only):', err.message);
        }
    }

    return result;
}

// ─── AI-powered profile extraction (lightweight, cheap call) ───

async function extractProfileInfoAI(message: string, aiResponse: string): Promise<ExtractedInfo> {
    const empty: ExtractedInfo = { interests: [], pain_points: [] };

    try {
        const extractionPrompt = `Extract client info from this WhatsApp exchange. Return ONLY valid JSON, nothing else.
Client said: "${message.substring(0, 300)}"
SARA responded: "${aiResponse.substring(0, 200)}"

Return JSON with these fields (use null for unknown, [] for empty arrays):
{"name":null,"company":null,"role":null,"sector":null,"interests":[],"pain_points":[],"sentiment":"neutral","key_quote":null,"budget_range":null,"decision_timeline":null}

Rules:
- Only include fields where you found CLEAR information in the text
- name: only if user explicitly says their name
- company: only if user mentions company name
- sector: one of: restaurant, real_estate, beauty, automotive, agency, cleaning, travel, medical, legal, network, studio, general
- sentiment: positive/neutral/negative based on client tone
- key_quote: notable client statement about needs/problems (max 150 chars)
- interests: business topics the client is interested in
- pain_points: problems/frustrations the client mentioned`;

        const aiMessages: ChatMsg[] = [
            { role: 'system', content: 'You are a data extraction engine. Return ONLY valid JSON. No explanations.' },
            { role: 'user', content: extractionPrompt },
        ];

        const result = await chatChain(aiMessages, 200);
        const jsonMatch = result.text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) return empty;

        const parsed = JSON.parse(jsonMatch[0]);
        return {
            name: parsed.name || undefined,
            company: parsed.company || undefined,
            role: parsed.role || undefined,
            sector: parsed.sector || undefined,
            interests: Array.isArray(parsed.interests) ? parsed.interests.filter((i: any) => typeof i === 'string') : [],
            pain_points: Array.isArray(parsed.pain_points) ? parsed.pain_points.filter((p: any) => typeof p === 'string') : [],
            sentiment: ['positive', 'neutral', 'negative'].includes(parsed.sentiment) ? parsed.sentiment : undefined,
            key_quote: typeof parsed.key_quote === 'string' ? parsed.key_quote.substring(0, 200) : undefined,
            budget_range: parsed.budget_range || undefined,
            decision_timeline: parsed.decision_timeline || undefined,
        };
    } catch (err: any) {
        console.error('[MEMORY] extractProfileInfoAI error:', err.message);
        return empty;
    }
}
