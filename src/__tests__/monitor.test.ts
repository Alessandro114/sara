// monitor.ts (issue #9). Run: npx tsx src/__tests__/monitor.test.ts
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { logToolCall, registerMonitorRoutes, TOOL_CALLS_DDL } from '../lib/monitor.js';

assert.match(TOOL_CALLS_DDL, /CREATE TABLE IF NOT EXISTS wa_tool_calls/);

const calls: Array<[string, unknown[]]> = [];
const pool: any = {
    query: async (sql: string, vals: unknown[]) => {
        calls.push([sql, vals]);
        if (sql.includes('FROM wa_tool_calls')) return { rows: [{ tool: 'book_table', risk: 'medium', success: true, created_at: 'x' }] };
        if (sql.includes('FROM wa_sessions')) return { rows: [{ phone: '39333', takeover_mode: 'human', takeover_by: 'admin', takeover_at: 't' }] };
        return { rows: [] };
    },
};

await logToolCall(pool, '39333', 'book_table', 'medium', true);
assert.deepEqual(calls[0][1], ['39333', 'book_table', 'medium', true]);
await logToolCall({ query: async () => { throw new Error('db down'); } }, 'p', 't', 'low', false); // must not throw

const api = Fastify();
registerMonitorRoutes(api, pool);
const r1 = await api.inject({ method: 'GET', url: '/api/sara/conversations/39333/tools?limit=999' });
assert.equal(r1.statusCode, 200);
assert.equal(r1.json().tool_calls[0].tool, 'book_table');
assert.equal(calls.at(-1)![1][1], 200, 'limit is capped at 200');
const r2 = await api.inject({ method: 'GET', url: '/api/sara/takeovers' });
assert.deepEqual(r2.json().takeovers[0], { phone: '39333', mode: 'human', taken_by: 'admin', since: 't' });
console.log('monitor tests passed');
process.exit(0);
