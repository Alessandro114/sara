// ═══════════════════════════════════════════════════
// SCALA WhatsApp Bot — Database Layer (v2)
// ═══════════════════════════════════════════════════
import { pool } from './config.js';
export { pool };
import { syncLeadToSCALA } from './crm-sync.js';
import { initMemoryTables } from './lib/conversation-memory.js';

export async function initDB() {
    try {
        // The knowledge table stores embeddings as vector(1024), so the
        // extension has to exist before any of the DDL below runs. Without it
        // the whole batch fails on a fresh database — which is exactly what
        // happens to anyone who clones this repo and runs docker compose up.
        await pool.query('CREATE EXTENSION IF NOT EXISTS vector');

        await pool.query(`
        CREATE TABLE IF NOT EXISTS wa_sessions (
          phone TEXT PRIMARY KEY, sector TEXT DEFAULT 'general',
          messages_count INTEGER DEFAULT 0,
          context JSONB DEFAULT '{}', cta_shown BOOLEAN DEFAULT false,
          first_seen TIMESTAMPTZ DEFAULT now(), last_message TIMESTAMPTZ DEFAULT now(),
          -- Lead info
          user_name TEXT,
          company_name TEXT,
          company_size TEXT, -- 'solo','micro','small','medium','large'
          estimated_revenue TEXT, -- '<100k','100k-500k','500k-1M','1M-5M','5M+'
          email TEXT,
          lead_score INTEGER DEFAULT 0,
          lead_stage TEXT DEFAULT 'new', -- new, engaged, qualified, converted, lost
          profiling_complete BOOLEAN DEFAULT false,
          user_language TEXT DEFAULT 'it', -- it, en, es, pt
          scala_user_id TEXT -- linked SCALA account (set via admin API)
        );
        CREATE TABLE IF NOT EXISTS wa_messages (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(), phone TEXT NOT NULL,
          direction TEXT NOT NULL CHECK (direction IN ('in','out')),
          content TEXT NOT NULL,
          media_type TEXT DEFAULT 'text',
          transcription TEXT,
          media_description TEXT,
          created_at TIMESTAMPTZ DEFAULT now()
        );
        CREATE TABLE IF NOT EXISTS wa_rag_documents (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(), sector TEXT NOT NULL,
          title TEXT NOT NULL, content TEXT NOT NULL, embedding vector(1024),
          created_at TIMESTAMPTZ DEFAULT now()
        );
        CREATE TABLE IF NOT EXISTS wa_lead_followups (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          phone TEXT NOT NULL,
          scheduled_at TIMESTAMPTZ NOT NULL,
          followup_type TEXT NOT NULL,
          message_template TEXT NOT NULL,
          sent BOOLEAN DEFAULT false,
          cancelled BOOLEAN DEFAULT false,
          created_at TIMESTAMPTZ DEFAULT now()
        );
        CREATE TABLE IF NOT EXISTS ai_response_cache (
          id SERIAL PRIMARY KEY,
          cache_key TEXT UNIQUE NOT NULL,
          question_normalized TEXT NOT NULL,
          response TEXT NOT NULL,
          sector TEXT DEFAULT 'general',
          lang TEXT DEFAULT 'it',
          provider TEXT DEFAULT 'unknown',
          hit_count INT DEFAULT 0,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '30 days'
        );
        CREATE INDEX IF NOT EXISTS idx_cache_key ON ai_response_cache(cache_key);
        CREATE INDEX IF NOT EXISTS idx_cache_expires ON ai_response_cache(expires_at);

        CREATE INDEX IF NOT EXISTS idx_wa_rag_sector ON wa_rag_documents (sector);
        CREATE INDEX IF NOT EXISTS idx_wa_messages_phone ON wa_messages (phone, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_wa_followups_pending ON wa_lead_followups (scheduled_at) WHERE sent = false AND cancelled = false;

        -- Migrate existing sessions: add new columns if missing
        DO $$ BEGIN
          ALTER TABLE wa_sessions ADD COLUMN IF NOT EXISTS user_name TEXT;
          ALTER TABLE wa_sessions ADD COLUMN IF NOT EXISTS company_name TEXT;
          ALTER TABLE wa_sessions ADD COLUMN IF NOT EXISTS company_size TEXT;
          ALTER TABLE wa_sessions ADD COLUMN IF NOT EXISTS estimated_revenue TEXT;
          ALTER TABLE wa_sessions ADD COLUMN IF NOT EXISTS email TEXT;
          ALTER TABLE wa_sessions ADD COLUMN IF NOT EXISTS lead_score INTEGER DEFAULT 0;
          ALTER TABLE wa_sessions ADD COLUMN IF NOT EXISTS lead_stage TEXT DEFAULT 'new';
          ALTER TABLE wa_sessions ADD COLUMN IF NOT EXISTS profiling_complete BOOLEAN DEFAULT false;
          ALTER TABLE wa_sessions ADD COLUMN IF NOT EXISTS user_language TEXT DEFAULT 'it';
          ALTER TABLE wa_sessions ADD COLUMN IF NOT EXISTS scala_user_id TEXT;
          ALTER TABLE wa_sessions ADD COLUMN IF NOT EXISTS plan_tier TEXT DEFAULT 'starter';
          ALTER TABLE wa_sessions ADD COLUMN IF NOT EXISTS name_verified BOOLEAN DEFAULT false;
          ALTER TABLE wa_sessions ADD COLUMN IF NOT EXISTS name_source TEXT DEFAULT 'unknown';
          ALTER TABLE wa_sessions ADD COLUMN IF NOT EXISTS opted_out BOOLEAN DEFAULT false;
          ALTER TABLE wa_sessions ADD COLUMN IF NOT EXISTS opted_out_at TIMESTAMPTZ;
          -- Feature 4: AI/Human Toggle
          ALTER TABLE wa_sessions ADD COLUMN IF NOT EXISTS ai_mode TEXT DEFAULT 'auto';
          ALTER TABLE wa_sessions ADD COLUMN IF NOT EXISTS assigned_operator TEXT;
        EXCEPTION WHEN duplicate_column THEN NULL;
        END $$;
      `);

        // Feature 2: Agent Personality Cloning
        await pool.query(`
            CREATE TABLE IF NOT EXISTS sara_agent_profiles (
                id SERIAL PRIMARY KEY,
                user_id TEXT NOT NULL,
                agent_name TEXT NOT NULL,
                greeting_style TEXT,
                communication_tone TEXT DEFAULT 'professionale',
                typical_phrases TEXT[] DEFAULT '{}',
                expertise_areas TEXT[] DEFAULT '{}',
                languages TEXT[] DEFAULT ARRAY['it'],
                response_length TEXT DEFAULT 'medium',
                emoji_usage TEXT DEFAULT 'minimal',
                signature TEXT,
                active BOOLEAN DEFAULT true,
                created_at TIMESTAMPTZ DEFAULT NOW()
            );
            CREATE INDEX IF NOT EXISTS idx_sara_agent_profiles_user ON sara_agent_profiles(user_id);
        `);

        // Feature 3: Proactive Client Alerts
        await pool.query(`
            CREATE TABLE IF NOT EXISTS sara_alerts (
                id SERIAL PRIMARY KEY,
                user_id TEXT NOT NULL,
                alert_type TEXT NOT NULL,
                client_phone TEXT,
                client_name TEXT,
                message TEXT NOT NULL,
                suggestion TEXT,
                priority TEXT DEFAULT 'medium',
                read BOOLEAN DEFAULT false,
                dismissed BOOLEAN DEFAULT false,
                created_at TIMESTAMPTZ DEFAULT NOW()
            );
            CREATE INDEX IF NOT EXISTS idx_sara_alerts_user ON sara_alerts(user_id, read, dismissed);
            CREATE INDEX IF NOT EXISTS idx_sara_alerts_created ON sara_alerts(created_at DESC);
        `);

        // Feature 5: Safe Outreach Campaigns
        await pool.query(`
            CREATE TABLE IF NOT EXISTS sara_outreach_campaigns (
                id SERIAL PRIMARY KEY,
                user_id TEXT NOT NULL,
                name TEXT NOT NULL,
                template TEXT NOT NULL,
                status TEXT DEFAULT 'draft',
                total_contacts INT DEFAULT 0,
                sent_count INT DEFAULT 0,
                delivered_count INT DEFAULT 0,
                read_count INT DEFAULT 0,
                replied_count INT DEFAULT 0,
                failed_count INT DEFAULT 0,
                scheduled_at TIMESTAMPTZ,
                started_at TIMESTAMPTZ,
                completed_at TIMESTAMPTZ,
                rules JSONB DEFAULT '{}',
                created_at TIMESTAMPTZ DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS sara_outreach_messages (
                id SERIAL PRIMARY KEY,
                campaign_id INT REFERENCES sara_outreach_campaigns(id),
                phone TEXT NOT NULL,
                contact_name TEXT,
                message TEXT NOT NULL,
                status TEXT DEFAULT 'pending',
                scheduled_at TIMESTAMPTZ,
                sent_at TIMESTAMPTZ,
                delivered_at TIMESTAMPTZ,
                read_at TIMESTAMPTZ,
                replied_at TIMESTAMPTZ,
                error TEXT,
                created_at TIMESTAMPTZ DEFAULT NOW()
            );
            CREATE INDEX IF NOT EXISTS idx_outreach_campaign ON sara_outreach_messages(campaign_id, status);
            CREATE INDEX IF NOT EXISTS idx_outreach_scheduled ON sara_outreach_messages(scheduled_at) WHERE status = 'pending';
        `);

        // Init memory tables (Feature 1)
        await initMemoryTables();

        // Also the persistent-memory tables (sara_contact_profiles and
        // friends). These used to be created only by index.ts at boot, so
        // anything reaching the database through initDB() alone — scripts,
        // tests, the API on its own — came up with a partial schema.
        const { ensureMemorySchema } = await import('./lib/persistent-memory.js');
        await ensureMemorySchema();

        // L7-L10: Advanced memory tables
        await pool.query(`
            -- L7: Business Insights
            CREATE TABLE IF NOT EXISTS sara_business_insights (
                id SERIAL PRIMARY KEY,
                user_id TEXT NOT NULL,
                insight_type TEXT NOT NULL,
                insight_data JSONB NOT NULL,
                confidence NUMERIC DEFAULT 0.5,
                sample_size INTEGER DEFAULT 0,
                generated_at TIMESTAMPTZ DEFAULT NOW(),
                expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '30 days',
                UNIQUE(user_id, insight_type)
            );
            -- L8: Sentiment Log
            CREATE TABLE IF NOT EXISTS sara_sentiment_log (
                id SERIAL PRIMARY KEY,
                user_id TEXT,
                phone TEXT NOT NULL,
                sentiment NUMERIC NOT NULL,
                intent TEXT,
                timestamp TIMESTAMPTZ DEFAULT NOW()
            );
            CREATE INDEX IF NOT EXISTS idx_ssl_phone ON sara_sentiment_log(phone, timestamp);
            -- L9: Action Memory
            CREATE TABLE IF NOT EXISTS sara_actions (
                id SERIAL PRIMARY KEY,
                user_id TEXT,
                phone TEXT NOT NULL,
                action_type TEXT NOT NULL,
                action_data JSONB,
                timestamp TIMESTAMPTZ DEFAULT NOW()
            );
            CREATE INDEX IF NOT EXISTS idx_sa_phone ON sara_actions(phone);
            -- L10: Global Insights
            CREATE TABLE IF NOT EXISTS sara_global_insights (
                id SERIAL PRIMARY KEY,
                vertical TEXT NOT NULL,
                insight TEXT NOT NULL,
                data JSONB,
                sample_size INTEGER,
                generated_at TIMESTAMPTZ DEFAULT NOW()
            );
            -- Add sentiment_avg to wa_client_profiles
            DO $$ BEGIN
                ALTER TABLE wa_client_profiles ADD COLUMN IF NOT EXISTS sentiment_avg NUMERIC DEFAULT 0.5;
            EXCEPTION WHEN undefined_table THEN NULL;
            END $$;
        `);

        console.log('[DB] Tables ready (including SARA TalkMind features + L7-L10)');
    } catch (err: any) {
        // Do not swallow this. Every statement above is CREATE ... IF NOT
        // EXISTS, so an existing schema is never the cause — the old message
        // claimed it was, and turned a hard failure into a bot that starts up
        // with no tables behind it and misbehaves later.
        console.error('[DB] Schema initialization FAILED:', err?.message);
        if (/type "vector" does not exist/.test(err?.message ?? '')) {
            console.error('[DB] The pgvector extension is missing. Use the pgvector/pgvector image, or install it as a superuser.');
        }
        throw err;
        // (qui sotto c'era un console.log rimasto dopo il throw: irraggiungibile,
        //  e diceva "Bot will continue with existing schema" — cioe' esattamente
        //  il contrario di quello che il throw fa. Rimosso.)
    }
}

export async function getSession(phone: string): Promise<any> {
    const r = await pool.query('SELECT * FROM wa_sessions WHERE phone=$1', [phone]);
    return r.rows[0] || null;
}

export async function upsertSession(phone: string, data: Partial<{
    sector: string; messages_count: number; context: any;
    cta_shown: boolean; user_name: string; company_name: string;
    company_size: string; estimated_revenue: string; email: string;
    lead_score: number; lead_stage: string; profiling_complete: boolean;
    phone_display: string; opted_out: boolean;
}>) {
    const session = await getSession(phone);
    if (!session) {
        await pool.query(
            'INSERT INTO wa_sessions (phone, sector, messages_count) VALUES ($1, $2, 1)',
            [phone, data.sector || 'general']
        );
    } else {
        const sets: string[] = ['last_message=now()', 'messages_count=messages_count+1'];
        const params: any[] = [];
        let i = 1;
        const fields = ['sector', 'user_name', 'company_name', 'company_size',
            'estimated_revenue', 'email', 'lead_stage', 'profiling_complete', 'user_language'] as const;
        for (const field of fields) {
            if ((data as any)[field] !== undefined) {
                sets.push(`${field}=$${i++}`);
                params.push((data as any)[field]);
            }
        }
        if (data.cta_shown !== undefined) { sets.push(`cta_shown=$${i++}`); params.push(data.cta_shown); }
        if (data.lead_score !== undefined) { sets.push(`lead_score=$${i++}`); params.push(data.lead_score); }
        if (data.opted_out !== undefined) {
            sets.push(`opted_out=$${i++}`);
            params.push(data.opted_out);
            if (data.opted_out) { sets.push(`opted_out_at=now()`); }
        }
        params.push(phone);
        await pool.query(`UPDATE wa_sessions SET ${sets.join(',')} WHERE phone=$${i}`, params);
    }
}

export async function updateLeadInfo(phone: string, info: {
    user_name?: string; company_name?: string; company_size?: string;
    estimated_revenue?: string; email?: string;
}) {
    const sets: string[] = [];
    const params: any[] = [];
    let i = 1;
    for (const [key, val] of Object.entries(info)) {
        if (val) { sets.push(`${key}=$${i++}`); params.push(val); }
    }
    if (sets.length === 0) return;
    params.push(phone);
    await pool.query(`UPDATE wa_sessions SET ${sets.join(',')} WHERE phone=$${i}`, params);
}

export async function getConversationHistory(phone: string, limit: number = 30): Promise<Array<{ role: string; content: string; created_at: Date }>> {
    const r = await pool.query(
        `SELECT direction, content, created_at FROM wa_messages
         WHERE phone=$1 AND media_type='text'
         ORDER BY created_at DESC LIMIT $2`,
        [phone, limit]
    );
    return r.rows.reverse().map((row: any) => ({
        role: row.direction === 'in' ? 'user' : 'model',
        content: row.content,
        created_at: row.created_at,
    }));
}

// ─── Get last topics discussed (for follow-up context) ───
export async function getLastTopics(phone: string): Promise<string> {
    const r = await pool.query(
        `SELECT content FROM wa_messages
         WHERE phone=$1 AND direction='in' AND media_type='text'
         ORDER BY created_at DESC LIMIT 5`,
        [phone]
    );
    if (r.rows.length === 0) return '';
    // Truncate each message and join
    return r.rows.map((row: any) => row.content.substring(0, 100)).join(' | ');
}

export async function updateLeadScore(phone: string, delta: number) {
    await pool.query(
        'UPDATE wa_sessions SET lead_score = GREATEST(0, lead_score + $1) WHERE phone=$2',
        [delta, phone]
    );
    // Auto-update lead stage based on score
    const session = await getSession(phone);
    if (!session) return;
    // NIENTE "+ delta" qui: getSession gira DOPO l'UPDATE qui sopra, quindi
    // session.lead_score contiene gia il delta. Sommarlo di nuovo faceva
    // calcolare lo stadio sul DOPPIO del punteggio vero, e le due soglie
    // scattavano a meta: 'engaged' a 10 punti invece di 20, 'qualified' a 25
    // invece di 50 — con la sincronizzazione al CRM che partiva di
    // conseguenza. Il punteggio salvato in tabella era giusto: sbagliato era
    // solo lo stadio, che e proprio il campo su cui si decide chi contattare.
    const score = session.lead_score || 0;
    let stage = 'new';
    if (score >= 50) stage = 'qualified';
    else if (score >= 20) stage = 'engaged';
    if (session.lead_stage !== 'converted') {
        await pool.query('UPDATE wa_sessions SET lead_stage=$1 WHERE phone=$2', [stage, phone]);
        // Sync to SCALA CRM when lead first reaches 'qualified'
        if (stage === 'qualified' && session.lead_stage !== 'qualified') {
            const fresh = await getSession(phone);
            await syncLeadToSCALA({
                phone,
                user_name: fresh?.user_name,
                company_name: fresh?.company_name,
                company_size: fresh?.company_size,
                estimated_revenue: fresh?.estimated_revenue,
                email: fresh?.email,
                lead_score: score,
                lead_stage: 'qualified',
                sector: fresh?.sector,
            });
        }
    }
}

export async function logMessage(
    phone: string,
    direction: 'in' | 'out',
    content: string,
    mediaType: string = 'text',
    transcription?: string,
    mediaDescription?: string,
    sentiment?: string
) {
    await pool.query(
        'INSERT INTO wa_messages (phone, direction, content, media_type, transcription, media_description) VALUES ($1, $2, $3, $4, $5, $6)',
        [phone, direction, content, mediaType, transcription || null, mediaDescription || null]
    );
}

// ─── Follow-up scheduling ───
export async function cancelPendingFollowups(phone: string) {
    await pool.query(
        "UPDATE wa_lead_followups SET cancelled=true WHERE phone=$1 AND sent=false AND cancelled=false",
        [phone]
    );
}

export async function scheduleFollowups(phone: string, userName?: string, sector?: string) {
    // Cancel any existing pending follow-ups (reset on new interaction)
    await cancelPendingFollowups(phone);

    // Messages are now generated dynamically via the LLM chain at send time.
    // We store a simple placeholder — the actual message is generated in followup.ts
    const schedules = [
        { days: 7, type: 'reengagement_7d' },
        { days: 21, type: 'reengagement_21d' },
        { days: 35, type: 'reengagement_35d' },
        { days: 70, type: 'reengagement_70d' },
        { days: 150, type: 'reengagement_150d' },
        { days: 300, type: 'reengagement_300d' },
    ];

    for (const s of schedules) {
        await pool.query(
            `INSERT INTO wa_lead_followups (phone, scheduled_at, followup_type, message_template)
             VALUES ($1, NOW() + INTERVAL '${s.days} days', $2, $3)`,
            [phone, s.type, `[dynamic:${s.days}d]`]
        );
    }
}

export async function getPendingFollowups(): Promise<any[]> {
    const r = await pool.query(
        `SELECT f.*, s.user_name, s.sector, s.lead_stage, s.user_language FROM wa_lead_followups f
         JOIN wa_sessions s ON f.phone = s.phone
         WHERE f.sent = false AND f.cancelled = false AND f.scheduled_at <= NOW()
         ORDER BY f.scheduled_at LIMIT 20`
    );
    return r.rows;
}

export async function markFollowupSent(id: string) {
    await pool.query('UPDATE wa_lead_followups SET sent=true WHERE id=$1', [id]);
}

// ─── Lookup SCALA user by phone number ───
// Cached module-level pool — lookupScalaUser runs on every new user's first
// message, so we reuse a single Pool instead of creating/ending one per call.
let _scalaLookupPool: any = null;
async function getScalaLookupPool() {
    if (_scalaLookupPool) return _scalaLookupPool;
    const scalaDbUrl = process.env.SCALA_DB_URL;
    if (!scalaDbUrl) return null;
    const scalaPg = new (await import('pg')).default.Pool({
        connectionString: scalaDbUrl,
    });
    scalaPg.on('error', (err: any) => console.error('[DB] scala lookup pool idle client error', err));
    _scalaLookupPool = scalaPg;
    return _scalaLookupPool;
}

export async function lookupScalaUser(phone: string): Promise<{ id: string; email: string; full_name: string; plan_tier: string } | null> {
    // Connect to the SCALA main DB (scalacore) to look up the user.
    // Credentials MUST come from env — never hardcode DB passwords.
    const scalaPg = await getScalaLookupPool();
    if (!scalaPg) {
        console.warn('[DB] lookupScalaUser skipped — SCALA_DB_URL not configured');
        return null;
    }
    try {
        // Normalize phone: strip whatsapp suffixes, extract digits
        const cleanPhone = phone.replace(/@.*/, '').replace(/[^0-9+]/g, '');
        const r = await scalaPg.query(
            `SELECT id, email, full_name, plan_tier FROM users
             WHERE phone = $1 OR phone LIKE '%' || $1
             OR phone = $2 OR phone LIKE '%' || $2
             LIMIT 1`,
            [cleanPhone, cleanPhone.replace(/^\+/, '')]
        );
        return r.rows[0] || null;
    } catch (err) {
        console.error('[DB] lookupScalaUser error:', err);
        return null;
    }
}

// ─── Follow-up message templates removed ───
// Messages are now generated dynamically in ai.ts → generateFollowupMessage()
// The old getFollowupMessage() and getSectorTip() are superseded by the AI-generated messages
// with expanded static fallbacks covering all 9 sectors in ai.ts.
