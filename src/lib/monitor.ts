// ═══════════════════════════════════════════════════════════
// Conversation monitoring (issue #9): tool-call log + dashboard endpoints.
// The dashboard (src/dashboard.html) polls these; auth is the global API-key hook in sara-api.ts.
// ═══════════════════════════════════════════════════════════
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';

export const TOOL_CALLS_DDL = `
CREATE TABLE IF NOT EXISTS wa_tool_calls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone TEXT NOT NULL,
  tool TEXT NOT NULL,
  risk TEXT NOT NULL,
  success BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_wa_tool_calls_phone ON wa_tool_calls (phone, created_at DESC);`;

/** Record one executed tool call. Never throws: monitoring must not break the chat. */
export async function logToolCall(pool: Pick<pg.Pool, 'query'>, phone: string, tool: string, risk: string, success: boolean): Promise<void> {
    try {
        await pool.query('INSERT INTO wa_tool_calls (phone, tool, risk, success) VALUES ($1, $2, $3, $4)', [phone, tool, risk, success]);
    } catch (err: any) {
        console.warn(`[MONITOR] tool call log failed: ${err?.message}`);
    }
}

export function registerMonitorRoutes(api: FastifyInstance, pool: Pick<pg.Pool, 'query'>): void {
    // Tool calls executed in a conversation, newest first
    api.get('/api/sara/conversations/:phone/tools', async (request, reply) => {
        const { phone } = request.params as { phone: string };
        const limit = Math.min(200, Math.max(1, parseInt(String((request.query as any)?.limit ?? '50'), 10) || 50));
        const r = await pool.query(
            'SELECT tool, risk, success, created_at FROM wa_tool_calls WHERE phone = $1 ORDER BY created_at DESC LIMIT $2',
            [phone, limit],
        );
        return reply.send({ phone, tool_calls: r.rows });
    });

    // Conversations currently handled by a human (mode != ai)
    api.get('/api/sara/takeovers', async (_request, reply) => {
        const { listTakeovers } = await import('./human-takeover.js');
        return reply.send({ takeovers: await listTakeovers(pool as pg.Pool) });
    });
}
