// ═══════════════════════════════════════════════════
// tool-dispatcher.ts tests (issue #3): risk levels, OpenAI tool schema, dispatch error paths.
// Run: npx tsx src/__tests__/tool-dispatcher.test.ts
// ═══════════════════════════════════════════════════
import assert from 'node:assert/strict';

process.env.DATABASE_URL ||= 'postgresql://x:x@127.0.0.1:1/x';
const { getToolRisk, saraToolsToOpenAI, dispatchToolCall } = await import('../lib/tool-dispatcher.js');
const { getSectorTools } = await import('../sara-tools.js');

const ctx = { phone: '393331112222', sector: 'ristorante', lang: 'it' };
const call = (name: string, args: string) => ({ id: 'c1', type: 'function' as const, function: { name, arguments: args } });

function testRisk(): void {
    assert.equal(getToolRisk('get_menu'), 'low');
    assert.equal(getToolRisk('book_table'), 'medium');
    assert.equal(getToolRisk('tool_mai_visto'), 'medium', 'unknown tools default to medium, never low');
}

function testOpenAiSchema(): void {
    const sector = 'ristorante';
    const defs = saraToolsToOpenAI(sector);
    const tools = getSectorTools(sector);
    assert.equal(defs.length, tools.length);
    for (const [i, d] of defs.entries()) {
        assert.equal(d.type, 'function');
        assert.equal(d.function.name, tools[i].name);
        assert.deepEqual(Object.keys(d.function.parameters.properties), tools[i].params);
        const req = d.function.parameters.required ?? [];
        for (const r of req) assert.ok(tools[i].params.includes(r));
        for (const optional of ['notes', 'category', 'area']) assert.ok(!req.includes(optional));
    }
}

async function testDispatchErrorPaths(): Promise<void> {
    const bad = await dispatchToolCall(call('book_table', '{not json'), ctx);
    assert.equal(bad.result.success, false);
    assert.equal(bad.result.error, 'Invalid tool arguments');

    const unknown = await dispatchToolCall(call('tool_mai_visto', '{}'), ctx);
    assert.equal(unknown.toolName, 'tool_mai_visto');
    assert.equal(unknown.result.success, false);
    assert.match(unknown.result.error!, /not yet implemented/);

    const noDate = await dispatchToolCall(call('check_availability', '{"guests":"2"}'), ctx);
    assert.equal(noDate.result.success, false);
    assert.equal(noDate.result.error, 'Missing date parameter');
}

testRisk();
testOpenAiSchema();
await testDispatchErrorPaths();
console.log('tool-dispatcher tests passed');
process.exit(0);
