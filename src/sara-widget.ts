// ═══════════════════════════════════════════════════
// S.A.R.A. Web Widget — Chat + Analytics endpoints
// Extends sara-api.ts with web widget support
// ═══════════════════════════════════════════════════
import type { FastifyInstance } from 'fastify';
import { pool } from './config.js';
import { getAIResponse } from './ai.js';
import { guardPlanPrices } from './humanize.js';

/**
 * Registers web widget routes on the S.A.R.A. API Fastify instance.
 * The widget allows websites to embed a S.A.R.A. chat directly.
 */
export async function registerWidgetRoutes(api: FastifyInstance) {

  // ─── Web Widget: Send message ───────────────────────
  api.post('/api/sara/widget/chat', async (request, reply) => {
    const { message, sessionId, sector, metadata } = request.body as {
      message: string;
      sessionId?: string;
      sector?: string;
      metadata?: Record<string, any>; // extra context: page URL, utm, etc.
    };

    if (!message?.trim()) return reply.code(400).send({ error: 'Message is required' });

    // Create or reuse session (web sessions use 'web_' prefix)
    const sid = sessionId || `web_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const detectedSector = sector || 'general';

    // Log incoming message
    await pool.query(
      'INSERT INTO wa_messages (phone, direction, content, media_type) VALUES ($1, $2, $3, $4)',
      [sid, 'in', message, 'text']
    );

    // Upsert web session
    await pool.query(
      `INSERT INTO wa_sessions (phone, sector, messages_count, context)
       VALUES ($1, $2, 1, $3)
       ON CONFLICT (phone) DO UPDATE SET
         messages_count = wa_sessions.messages_count + 1,
         last_message = now(),
         sector = COALESCE(NULLIF($2, 'general'), wa_sessions.sector),
         context = wa_sessions.context || $3`,
      [sid, detectedSector, JSON.stringify(metadata || {})]
    );

    // Get conversation history for context
    const history = await pool.query(
      'SELECT direction, content FROM wa_messages WHERE phone = $1 ORDER BY created_at DESC LIMIT 10',
      [sid]
    );

    // Generate AI response
    const conversationHistory = history.rows.reverse().map((m: any) =>
      `${m.direction === 'in' ? 'User' : 'SARA'}: ${m.content}`
    ).join('\n');

    // Generate AI response using the existing AI layer
    const sessionForAI = { sector: detectedSector, messages_count: history.rowCount || 0 };
    const aiResponse = guardPlanPrices(await getAIResponse(message, sessionForAI));

    // Log response
    await pool.query(
      'INSERT INTO wa_messages (phone, direction, content, media_type) VALUES ($1, $2, $3, $4)',
      [sid, 'out', aiResponse, 'text']
    );

    // Check if CTA should be shown (after 6 messages)
    const session = await pool.query('SELECT messages_count, cta_shown FROM wa_sessions WHERE phone = $1', [sid]);
    const msgCount = session.rows[0]?.messages_count || 0;
    const shouldShowCta = msgCount >= 6 && !session.rows[0]?.cta_shown;

    if (shouldShowCta) {
      await pool.query('UPDATE wa_sessions SET cta_shown = true WHERE phone = $1', [sid]);
    }

    return reply.send({
      sessionId: sid,
      response: aiResponse,
      sector: detectedSector,
      messagesCount: msgCount,
      showCta: shouldShowCta,
      ctaUrl: shouldShowCta ? getCTAUrl(detectedSector) : undefined,
    });
  });

  // ─── Web Widget: Get session history ────────────────
  api.get('/api/sara/widget/history/:sessionId', async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    const limit = Math.min(200, Math.max(1, parseInt((request.query as any).limit, 10) || 50));

    const messages = await pool.query(
      'SELECT direction, content, media_type, created_at FROM wa_messages WHERE phone = $1 ORDER BY created_at ASC LIMIT $2',
      [sessionId, limit]
    );

    return reply.send({ sessionId, messages: messages.rows });
  });

  // ─── Dashboard: Enhanced analytics ──────────────────
  api.get('/api/sara/dashboard/summary', async (_req, reply) => {
    const [overview, hourly, topConversations, recentCtaConversions] = await Promise.all([
      // Overall metrics
      pool.query(`
        SELECT
          (SELECT COUNT(*) FROM wa_sessions) as total_sessions,
          (SELECT COUNT(*) FROM wa_sessions WHERE last_message > now() - interval '24h') as active_24h,
          (SELECT COUNT(*) FROM wa_sessions WHERE last_message > now() - interval '7d') as active_7d,
          (SELECT COUNT(*) FROM wa_messages) as total_messages,
          (SELECT COUNT(*) FROM wa_messages WHERE created_at > now() - interval '24h') as messages_24h,
          (SELECT COUNT(*) FROM wa_sessions WHERE cta_shown = true) as total_cta_shown,
          (SELECT AVG(messages_count) FROM wa_sessions) as avg_messages_per_session
      `),
      // Hourly distribution (last 24h)
      pool.query(`
        SELECT EXTRACT(HOUR FROM created_at)::int as hour, COUNT(*)::int as count
        FROM wa_messages WHERE created_at > now() - interval '24h'
        GROUP BY hour ORDER BY hour
      `),
      // Top conversations by message count
      pool.query(`
        SELECT phone, sector, messages_count, cta_shown, last_message,
               (SELECT content FROM wa_messages WHERE phone = s.phone ORDER BY created_at DESC LIMIT 1) as last_content
        FROM wa_sessions s ORDER BY messages_count DESC LIMIT 10
      `),
      // Recent CTA conversions
      pool.query(`
        SELECT phone, sector, messages_count, last_message
        FROM wa_sessions WHERE cta_shown = true ORDER BY last_message DESC LIMIT 5
      `),
    ]);

    return reply.send({
      overview: overview.rows[0],
      hourly_distribution: hourly.rows,
      top_conversations: topConversations.rows,
      recent_cta_conversions: recentCtaConversions.rows,
    });
  });

  // ─── Dashboard: Message volume chart data ───────────
  api.get('/api/sara/dashboard/volume', async (request, reply) => {
    const days = Math.min(365, Math.max(1, parseInt((request.query as any).days, 10) || 30));

    const volume = await pool.query(`
      SELECT DATE(created_at) as date,
             COUNT(*) FILTER (WHERE direction = 'in')::int as incoming,
             COUNT(*) FILTER (WHERE direction = 'out')::int as outgoing,
             COUNT(*)::int as total
      FROM wa_messages
      WHERE created_at > now() - make_interval(days => $1)
      GROUP BY DATE(created_at)
      ORDER BY date
    `, [days]);

    return reply.send({ days, volume: volume.rows });
  });

  // ─── Dashboard: Sector performance ──────────────────
  api.get('/api/sara/dashboard/sectors', async (_req, reply) => {
    const sectors = await pool.query(`
      SELECT
        s.sector,
        COUNT(DISTINCT s.phone)::int as users,
        SUM(s.messages_count)::int as total_messages,
        AVG(s.messages_count)::float as avg_messages,
        COUNT(CASE WHEN s.cta_shown THEN 1 END)::int as cta_conversions,
        ROUND(COUNT(CASE WHEN s.cta_shown THEN 1 END)::numeric / NULLIF(COUNT(CASE WHEN s.messages_count >= 6 THEN 1 END), 0) * 100, 1) as cta_rate
      FROM wa_sessions s
      GROUP BY s.sector
      ORDER BY users DESC
    `);

    return reply.send({ sectors: sectors.rows });
  });
}

// ─── Map sector to CTA URL ────────────────────────────
function getCTAUrl(sector: string): string {
  const urls: Record<string, string> = {
    immobiliare: 'https://propertyos.get-scala.com',
    viaggi: 'https://travelos.get-scala.com',
    auto: 'https://motoros.get-scala.com',
    legale: 'https://praxisos.get-scala.com',
    marketing: 'https://agencyos.get-scala.com',
    ristorazione: 'https://dineos.get-scala.com',
    estetica: 'https://dermalyos.get-scala.com',
    general: 'https://app.get-scala.com',
  };
  return urls[sector] || urls.general;
}
