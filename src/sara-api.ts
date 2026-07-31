// ═══════════════════════════════════════════════════
// S.A.R.A. — REST API Bridge for app.get-scala.com
// Cross-VM API: app.get-scala.com (VM1) ←→ S.A.R.A. (VM2)
// ═══════════════════════════════════════════════════
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { readFileSync, existsSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { pool } from './config.js';
import { registerWidgetRoutes } from './sara-widget.js';
import QRCode from 'qrcode';

// ─── Phone number sanitization ───
function sanitizePhone(jid: string): string {
    // Convert WhatsApp jid (393793658633@s.whatsapp.net) to readable format (+39 379 365 8633)
    const raw = jid.replace(/@s\.whatsapp\.net$/, '').replace(/@g\.us$/, '');
    if (/^\d{10,15}$/.test(raw)) {
        return '+' + raw;
    }
    return raw;
}

function addPhoneDisplay(row: any): any {
    if (row && row.phone) {
        const display = row.phone_display || sanitizePhone(row.phone);
        return { ...row, phone_display: display };
    }
    return row;
}

// SECURITY: require SARA_API_KEY from env. If missing, generate an
// ephemeral random key at boot so the API is unreachable without the
// correct key (rather than accepting a well-known default).
import crypto from 'crypto';
const { randomBytes } = crypto;
const SARA_API_KEY = process.env.SARA_API_KEY || (() => {
    const generated = randomBytes(32).toString('hex');
    console.warn('[SARA API] SARA_API_KEY not set — generated ephemeral key (this key will change on restart)');
    return generated;
})();
if (SARA_API_KEY === 'sara-dev-key-change-in-production') {
    console.error('[SARA API] ⚠️ SARA_API_KEY is still the default placeholder — REFUSING TO START');
    process.exit(1);
}

const api = Fastify({ logger: { level: 'info' } });

const CORS_ORIGINS = process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(',')
    : ['http://localhost:3000', 'http://localhost:5173'];

await api.register(cors, {
    origin: process.env.NODE_ENV === 'production'
        ? CORS_ORIGINS
        : true,
    credentials: true,
});

// ─── Auth middleware (API Key) — skip only for health + public widget ───
// SECURITY: /api/sara/qr was previously public and exposed a QR code that
// could hijack the WhatsApp account if scanned by an attacker. It now
// requires the admin API key, same pattern as all other admin endpoints.
api.addHook('preHandler', async (request, reply) => {
    if (request.url === '/api/sara/health') return;
    if (request.url.startsWith('/api/sara/widget/')) return;

    const apiKey = request.headers['x-sara-api-key'] || request.headers['authorization']?.replace('Bearer ', '');
    if (!apiKey || typeof apiKey !== 'string' || Buffer.byteLength(apiKey) !== Buffer.byteLength(SARA_API_KEY) ||
        !crypto.timingSafeEqual(Buffer.from(apiKey), Buffer.from(SARA_API_KEY))) {
        return reply.status(401).send({ error: 'Unauthorized', message: 'Invalid S.A.R.A. API key' });
    }
});

// ─── Health Check ───
api.get('/api/sara/health', async (_req, reply) => {
    try {
        await pool.query('SELECT 1');
        const checks: Record<string, string> = {};
        try {
            await pool.query('SELECT 1 FROM crm_contacts LIMIT 0');
            checks.crm_contacts = 'ok';
        } catch { checks.crm_contacts = 'missing_or_broken'; }
        try {
            await pool.query('SELECT 1 FROM wa_messages LIMIT 0');
            checks.wa_messages = 'ok';
        } catch { checks.wa_messages = 'missing_or_broken'; }
        try {
            await pool.query('SELECT 1 FROM sara_contact_profiles LIMIT 0');
            checks.sara_contact_profiles = 'ok';
        } catch { checks.sara_contact_profiles = 'missing_or_broken'; }
        const degraded = Object.values(checks).some(v => v !== 'ok');
        return reply.send({
            status: degraded ? 'degraded' : 'ok',
            bot: 'S.A.R.A.', version: '2.2.0',
            checks,
            timestamp: new Date().toISOString(),
        });
    } catch {
        return reply.status(503).send({ status: 'down', bot: 'S.A.R.A.' });
    }
});

// ─── QR Code Endpoint (for WhatsApp pairing) ───
api.get('/api/sara/qr', async (_req, reply) => {
    const qr = (globalThis as any).__SARA_LAST_QR;
    if (!qr) {
        return reply.type('text/html').send(`
            <html><body style="background:#0A0F2C;color:#C9A84C;font-family:Inter,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;flex-direction:column">
            <h1>S.A.R.A. WhatsApp Bot</h1>
            <p style="color:#888">Nessun QR code disponibile. Il bot potrebbe essere già connesso o in fase di avvio.</p>
            <p style="color:#666;font-size:0.8em">Ricarica tra qualche secondo...</p>
            <script>setTimeout(() => location.reload(), 5000)</script>
            </body></html>`);
    }
    const qrDataUrl = await QRCode.toDataURL(qr, { width: 400, margin: 2, color: { dark: '#000000', light: '#FFFFFF' } });
    return reply.type('text/html; charset=utf-8').send(`<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>S.A.R.A. QR Code</title></head>
<body style="background:#0A0F2C;color:#C9A84C;font-family:Inter,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;flex-direction:column">
<h1>S.A.R.A. - Scan QR Code</h1>
<p style="color:#888">Scansiona con WhatsApp Business &gt; Dispositivi collegati &gt; Collega dispositivo</p>
<img src="${qrDataUrl}" style="margin:20px;border-radius:12px;width:400px;height:400px" alt="QR Code"/>
<p style="color:#666;font-size:0.8em">Auto-refresh ogni 30 secondi</p>
<script>setTimeout(function(){ location.reload(); }, 30000);</script>
</body></html>`);
});

// ─── Pairing Code Endpoint (admin UI polling) ───
// Returns the current pairing code status from the shared JSON file written
// by wa-hardened-adapter.ts. No sensitive data — code is only useful for
// ~90 seconds, and the endpoint is protected by SARA_API_KEY.
const PAIRING_CODE_FILE = resolve(process.cwd(), 'auth_store_baileys_hardened', '.pairing_code.json');
api.get('/api/sara/pairing-code', async (_req, reply) => {
    const PAIRING_TTL_MS = 90_000; // pairing codes are valid for ~90 seconds
    try {
        if (!existsSync(PAIRING_CODE_FILE)) {
            return reply.send({ connected: false, code: null, secondsRemaining: 0, phone: null });
        }
        const raw = readFileSync(PAIRING_CODE_FILE, 'utf8');
        const data = JSON.parse(raw) as {
            code: string | null;
            issuedAt: number | null;
            phone: string | null;
            connected: boolean;
        };
        if (data.connected) {
            return reply.send({ connected: true, code: null, secondsRemaining: 0, phone: data.phone });
        }
        const elapsed = data.issuedAt ? Date.now() - data.issuedAt : PAIRING_TTL_MS;
        const secondsRemaining = Math.max(0, Math.round((PAIRING_TTL_MS - elapsed) / 1000));
        return reply.send({
            connected: false,
            code: secondsRemaining > 0 ? data.code : null,
            secondsRemaining,
            phone: data.phone,
        });
    } catch {
        return reply.send({ connected: false, code: null, secondsRemaining: 0, phone: null });
    }
});

// ─── Dashboard Stats ───
api.get('/api/sara/stats', async (_req, reply) => {
    const [sessions, messages, sectors, today] = await Promise.all([
        pool.query('SELECT COUNT(*) as total, COUNT(CASE WHEN last_message > now()-interval \'24h\' THEN 1 END) as active_24h FROM wa_sessions'),
        pool.query('SELECT COUNT(*) as total, COUNT(CASE WHEN created_at > now()-interval \'24h\' THEN 1 END) as today FROM wa_messages'),
        pool.query('SELECT sector, COUNT(*) as count FROM wa_sessions GROUP BY sector ORDER BY count DESC'),
        pool.query(`SELECT media_type, COUNT(*) as count FROM wa_messages WHERE direction='in' AND created_at > now()-interval '24h' GROUP BY media_type`),
    ]);

    return reply.send({
        sessions: {
            total: parseInt(sessions.rows[0].total),
            active_24h: parseInt(sessions.rows[0].active_24h),
        },
        messages: {
            total: parseInt(messages.rows[0].total),
            today: parseInt(messages.rows[0].today),
        },
        sectors: sectors.rows,
        media_today: today.rows,
    });
});

// ─── Recent Conversations ───
api.get('/api/sara/conversations', async (request, reply) => {
    const { limit = '20', offset = '0' } = request.query as any;

    const result = await pool.query(
        `SELECT s.phone, s.sector, s.messages_count, s.cta_shown, s.first_seen, s.last_message,
                (SELECT content FROM wa_messages WHERE phone=s.phone ORDER BY created_at DESC LIMIT 1) as last_content
         FROM wa_sessions s ORDER BY s.last_message DESC LIMIT $1 OFFSET $2`,
        [parseInt(limit), parseInt(offset)]
    );

    return reply.send({ conversations: result.rows.map(addPhoneDisplay), total: result.rowCount });
});

// ─── Conversation Detail (messages) ───
api.get('/api/sara/conversations/:phone', async (request, reply) => {
    const { phone } = request.params as any;
    const { limit = '50' } = request.query as any;

    const [session, messages] = await Promise.all([
        pool.query('SELECT * FROM wa_sessions WHERE phone=$1', [phone]),
        pool.query('SELECT * FROM wa_messages WHERE phone=$1 ORDER BY created_at DESC LIMIT $2', [phone, parseInt(limit)]),
    ]);

    if (session.rows.length === 0) return reply.status(404).send({ error: 'Conversation not found' });

    return reply.send({ session: addPhoneDisplay(session.rows[0]), messages: messages.rows.reverse() });
});

// ─── Sector Analytics ───
api.get('/api/sara/analytics', async (request, reply) => {
    const { days = '30' } = request.query as any;

    const safeDays = Math.max(1, Math.min(365, parseInt(days) || 30));
    const [dailyMessages, sectorBreakdown, ctaRate, mediaBreakdown] = await Promise.all([
        pool.query(`SELECT DATE(created_at) as day, COUNT(*) as count FROM wa_messages WHERE created_at > now() - make_interval(days => $1) GROUP BY DATE(created_at) ORDER BY day`, [safeDays]),
        pool.query(`SELECT sector, COUNT(DISTINCT phone) as users, SUM(messages_count) as messages FROM wa_sessions GROUP BY sector`).catch(() => ({ rows: [] })),
        pool.query(`SELECT COUNT(CASE WHEN cta_shown THEN 1 END)::float / NULLIF(COUNT(*), 0) as rate FROM wa_sessions WHERE messages_count >= 6`).catch(() => ({ rows: [{ rate: 0 }] })),
        pool.query(`SELECT media_type, COUNT(*) as count FROM wa_messages WHERE direction='in' GROUP BY media_type ORDER BY count DESC`).catch(() => ({ rows: [] })),
    ]);

    return reply.send({
        daily_messages: dailyMessages.rows,
        sector_breakdown: sectorBreakdown.rows,
        cta_conversion_rate: ctaRate.rows[0]?.rate || 0,
        media_breakdown: mediaBreakdown.rows,
    });
});

// ─── Lead Management API ───

// List all leads with optional filters
api.get('/api/sara/leads', async (request, reply) => {
    const { sector, stage, min_score, limit = '50', offset = '0', sort = 'last_message' } = request.query as any;

    let where = 'WHERE 1=1';
    const params: any[] = [];
    let i = 1;
    if (sector) { where += ` AND sector=$${i++}`; params.push(sector); }
    if (stage) { where += ` AND lead_stage=$${i++}`; params.push(stage); }
    if (min_score) { where += ` AND lead_score>=$${i++}`; params.push(parseInt(min_score)); }

    const sortCol = ['last_message', 'lead_score', 'first_seen', 'messages_count'].includes(sort) ? sort : 'last_message';

    const [leads, total] = await Promise.all([
        pool.query(
            `SELECT phone, user_name, sector, company_name, company_size, estimated_revenue,
                    email, messages_count, lead_score, lead_stage, cta_shown, profiling_complete,
                    first_seen, last_message,
                    (SELECT content FROM wa_messages WHERE phone=s.phone ORDER BY created_at DESC LIMIT 1) as last_content
             FROM wa_sessions s ${where}
             ORDER BY ${sortCol} DESC LIMIT $${i++} OFFSET $${i++}`,
            [...params, parseInt(limit), parseInt(offset)]
        ),
        pool.query(`SELECT COUNT(*) as total FROM wa_sessions ${where}`, params),
    ]);

    return reply.send({
        leads: leads.rows.map(addPhoneDisplay),
        total: parseInt(total.rows[0].total),
        filters: { sector, stage, min_score },
    });
});

// Lead detail with full conversation + follow-ups
api.get('/api/sara/leads/:phone', async (request, reply) => {
    const { phone } = request.params as any;

    const [session, messages, followups] = await Promise.all([
        pool.query('SELECT * FROM wa_sessions WHERE phone=$1', [phone]),
        pool.query('SELECT * FROM wa_messages WHERE phone=$1 ORDER BY created_at DESC LIMIT 100', [phone]),
        pool.query('SELECT * FROM wa_lead_followups WHERE phone=$1 ORDER BY scheduled_at', [phone]),
    ]);

    if (session.rows.length === 0) return reply.status(404).send({ error: 'Lead not found' });

    return reply.send({
        lead: addPhoneDisplay(session.rows[0]),
        messages: messages.rows.reverse(),
        followups: followups.rows,
    });
});

// Link WhatsApp session to SCALA account
api.post('/api/sara/leads/:phone/link', async (request, reply) => {
    const { phone } = request.params as any;
    const { scala_user_id } = request.body as any;

    if (!scala_user_id) return reply.status(400).send({ error: 'scala_user_id required' });

    const session = await pool.query('SELECT * FROM wa_sessions WHERE phone=$1', [phone]);
    if (session.rows.length === 0) return reply.status(404).send({ error: 'Lead not found' });

    await pool.query('UPDATE wa_sessions SET scala_user_id=$1 WHERE phone=$2', [scala_user_id, phone]);

    return reply.send({ ok: true, phone, scala_user_id, note: 'WhatsApp session linked to SCALA account' });
});

// Update lead info (stage, name, company, etc.)
api.post('/api/sara/leads/:phone/update', async (request, reply) => {
    const { phone } = request.params as any;
    const { user_name, company_name, company_size, estimated_revenue, email, lead_stage, lead_score } = request.body as any;

    const sets: string[] = [];
    const params: any[] = [];
    let i = 1;
    if (user_name !== undefined) { sets.push(`user_name=$${i++}`); params.push(user_name); }
    if (company_name !== undefined) { sets.push(`company_name=$${i++}`); params.push(company_name); }
    if (company_size !== undefined) { sets.push(`company_size=$${i++}`); params.push(company_size); }
    if (estimated_revenue !== undefined) { sets.push(`estimated_revenue=$${i++}`); params.push(estimated_revenue); }
    if (email !== undefined) { sets.push(`email=$${i++}`); params.push(email); }
    if (lead_stage !== undefined) { sets.push(`lead_stage=$${i++}`); params.push(lead_stage); }
    if (lead_score !== undefined) { sets.push(`lead_score=$${i++}`); params.push(parseInt(lead_score)); }

    if (sets.length === 0) return reply.status(400).send({ error: 'No fields to update' });

    params.push(phone);
    await pool.query(`UPDATE wa_sessions SET ${sets.join(',')} WHERE phone=$${i}`, params);

    return reply.send({ ok: true, phone, updated: Object.keys(request.body as any) });
});

// Send promo code or custom message to a lead via SARA WhatsApp
api.post('/api/sara/leads/:phone/promo', async (request, reply) => {
    const { phone } = request.params as any;
    const { message, promo_code } = request.body as any;

    if (!message && !promo_code) {
        return reply.status(400).send({ error: 'Provide message or promo_code' });
    }

    // Build the promo message
    const session = await pool.query('SELECT * FROM wa_sessions WHERE phone=$1', [phone]);
    if (session.rows.length === 0) return reply.status(404).send({ error: 'Lead not found' });

    const lead = session.rows[0];
    const name = lead.user_name ? `${lead.user_name}, ` : '';

    let promoText = message || '';
    if (promo_code) {
        promoText = `${name}ho un regalo per te! 🎁\n\nUsa il codice *${promo_code}* per ottenere uno sconto esclusivo sulla piattaforma.\n\nÈ valido solo per te — non perderlo! 🚀`;
    }

    // Store as scheduled message (will be sent by the WhatsApp socket)
    // We store in wa_lead_followups for immediate pickup
    await pool.query(
        `INSERT INTO wa_lead_followups (phone, scheduled_at, followup_type, message_template)
         VALUES ($1, NOW(), 'promo_manual', $2)`,
        [phone, promoText]
    );

    // Log in messages
    await pool.query(
        "INSERT INTO wa_messages (phone, direction, content, media_type) VALUES ($1, 'out', $2, 'text')",
        [phone, promoText]
    );

    return reply.send({ ok: true, phone, message: promoText, note: 'Will be sent within 5 minutes by the scheduler' });
});

// Reset a lead session (for testing)
api.post('/api/sara/leads/:phone/reset', async (request, reply) => {
    const { phone } = request.params as any;

    await pool.query("DELETE FROM wa_lead_followups WHERE phone=$1", [phone]);
    await pool.query("DELETE FROM wa_messages WHERE phone=$1", [phone]);
    await pool.query("DELETE FROM wa_sessions WHERE phone=$1", [phone]);

    return reply.send({ ok: true, phone, note: 'Session fully reset — lead will start fresh' });
});

// ─── Takeover / Silent mode ───

// GET /api/sara/leads/:phone/takeover — current mode for a conversation
api.get('/api/sara/leads/:phone/takeover', async (request, reply) => {
    const { phone } = request.params as any;
    const { getTakeoverMode } = await import('./lib/human-takeover.js');
    const mode = getTakeoverMode(phone);
    return reply.send({ phone, mode });
});

// POST /api/sara/leads/:phone/takeover — set mode { mode: 'ai' | 'human' | 'hybrid' }
api.post('/api/sara/leads/:phone/takeover', async (request, reply) => {
    const { phone } = request.params as any;
    const { mode, reason, auto_resume_hours } = (request.body || {}) as any;
    if (!['ai', 'human', 'hybrid'].includes(mode)) {
        return reply.status(400).send({ error: 'mode must be ai | human | hybrid' });
    }
    const { setTakeoverMode } = await import('./lib/human-takeover.js');
    await setTakeoverMode(phone, mode, pool, { taken_by: 'admin', reason, auto_resume_hours });
    return reply.send({ ok: true, phone, mode });
});

// ─── Register Web Widget + Dashboard routes ───
await registerWidgetRoutes(api);

// ─── Dashboard HTML page ───
api.get('/api/sara/dashboard', async (_req, reply) => {
    try {
        const __dirname = dirname(fileURLToPath(import.meta.url));
        const html = readFileSync(join(__dirname, 'dashboard.html'), 'utf-8');
        return reply.type('text/html').send(html);
    } catch {
        return reply.type('text/html').send('<h1>Dashboard not found. Run: npm run build</h1>');
    }
});

// ─── Send WhatsApp message (used by backend cron reminders) ───────────────
// POST /api/send-message { phone: "393XXXXXXXXX", message: "..." }
// This is the P0 endpoint that all reminder crons depend on.
api.post('/api/send-message', async (request, reply) => {
    const { phone, message } = request.body as { phone?: string; message?: string };
    if (!phone || !message) {
        return reply.status(400).send({ error: 'phone and message are required' });
    }

    // Normalize phone to WA JID format
    const jid = phone.replace(/\D/g, '').replace(/^0+/, '') + '@s.whatsapp.net';

    const { getActiveSock } = await import('./lib/sock-registry.js');
    const sock = getActiveSock();
    if (!sock) {
        // Bot not connected — queue in DB for later delivery
        try {
            await pool.query(
                `INSERT INTO wa_messages (phone, direction, content, media_type, created_at)
                 VALUES ($1, 'out', $2, 'text', NOW())`,
                [phone.replace(/\D/g, ''), message]
            );
        } catch { /* non-fatal */ }
        return reply.status(503).send({ error: 'WA bot not connected — message queued in DB' });
    }

    try {
        await sock.sendMessage(jid, { text: message });
        // Log to wa_messages
        await pool.query(
            `INSERT INTO wa_messages (phone, direction, content, media_type, created_at)
             VALUES ($1, 'out', $2, 'text', NOW())`,
            [phone.replace(/\D/g, ''), message]
        );
        return reply.send({ ok: true, phone: jid });
    } catch (err: any) {
        return reply.status(500).send({ error: 'Invio messaggio fallito' });
    }
});

// ═══════════════════════════════════════════════════════════
// SOLO SARA — Multi-Session WhatsApp API
// These endpoints are called by the scala-backend proxy
// with x-sara-api-key auth. The user_id comes from the
// backend's JWT validation (passed in request body/query).
// ═══════════════════════════════════════════════════════════
import {
    createSession,
    getSessionStatus,
    getQRCode,
    getConnectedPhone,
    stopSession,
    handleWahaWebhook,
} from './lib/multi-session.js';

// POST /api/sara/solo-whatsapp/connect — start a session, return QR
api.post('/api/sara/solo-whatsapp/connect', async (request, reply) => {
    const { user_id } = (request.body as any) || {};
    if (!user_id) return reply.status(400).send({ error: 'user_id required' });
    try {
        const result = await createSession(user_id);
        return reply.send({ qr_base64: result.qr || null, status: result.status });
    } catch (err: any) {
        console.error(`[SOLO-API] connect failed for ${user_id}:`, err?.message);
        if (err?.code === 'MAX_SESSIONS') {
            return reply.status(429).send({ error: 'Too many active sessions. Try again later.' });
        }
        return reply.status(500).send({ error: 'Session creation failed' });
    }
});

// GET /api/sara/solo-whatsapp/status?user_id=xxx
api.get('/api/sara/solo-whatsapp/status', async (request, reply) => {
    const { user_id } = (request.query as any) || {};
    if (!user_id) return reply.status(400).send({ error: 'user_id required' });
    const status = await getSessionStatus(user_id);
    const phone = getConnectedPhone(user_id);
    return reply.send({ status, phone: phone || undefined });
});

// GET /api/sara/solo-whatsapp/qr?user_id=xxx
api.get('/api/sara/solo-whatsapp/qr', async (request, reply) => {
    const { user_id } = (request.query as any) || {};
    if (!user_id) return reply.status(400).send({ error: 'user_id required' });
    const status = await getSessionStatus(user_id);
    if (status === 'connected') return reply.send({ status: 'connected' });
    const qr = await getQRCode(user_id);
    if (!qr) return reply.send({ status, qr_base64: null });
    return reply.send({ qr_base64: qr, status });
});

// POST /api/sara/solo-whatsapp/disconnect — stop session, remove auth
api.post('/api/sara/solo-whatsapp/disconnect', async (request, reply) => {
    const { user_id } = (request.body as any) || {};
    if (!user_id) return reply.status(400).send({ error: 'user_id required' });
    try {
        await stopSession(user_id);
        return reply.send({ success: true, status: 'disconnected' });
    } catch (err: any) {
        console.error(`[SOLO-API] disconnect failed for ${user_id}:`, err?.message);
        return reply.status(500).send({ error: 'Disconnect failed' });
    }
});

// POST /api/waha-webhook — WAHA sends incoming messages + session status here
api.post('/api/waha-webhook', async (request, reply) => {
    reply.status(200).send('ok');
    try {
        await handleWahaWebhook(request.body);
    } catch (err: any) {
        console.error('[WAHA-WEBHOOK]', err?.message);
    }
});

// ─── Start API server on port 3006 (separate from bot on 3005) ───
const API_PORT = parseInt(process.env.SARA_API_PORT || '3006');

try {
    const API_HOST = process.env.SARA_API_HOST || '0.0.0.0';
    await api.listen({ port: API_PORT, host: API_HOST });
    console.log(`
╔════════════════════════════════════════════════════╗
║   📡 S.A.R.A. API Bridge v2.1.0 — ONLINE         ║
║════════════════════════════════════════════════════║
║   🏥 Health:    /api/sara/health                  ║
║   📊 Stats:     /api/sara/stats                   ║
║   💬 Convos:    /api/sara/conversations            ║
║   📈 Analytics: /api/sara/analytics                ║
║   🪟 Widget:    /api/sara/widget/chat              ║
║   📋 Dashboard: /api/sara/dashboard/summary        ║
╚════════════════════════════════════════════════════╝
`);
} catch (err) {
    console.error('[SARA API] Failed to start:', err);
}

export { api };

