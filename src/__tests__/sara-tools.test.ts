// ═══════════════════════════════════════════════════
// sara-tools.ts tests (issue #3)
// Run: npx tsx src/__tests__/sara-tools.test.ts
// ═══════════════════════════════════════════════════
import assert from 'node:assert/strict';
import { SARA_TOOLS, activeVerticals, getSectorTools, buildToolContextSnippet, formatToolResult } from '../sara-tools.js';

function testEveryToolIsWellFormed(): void {
    const seen = new Set<string>();
    for (const [key, tools] of Object.entries(SARA_TOOLS)) {
        assert.ok(tools.length > 0, `${key}: empty tool list`);
        for (const t of tools) {
            assert.match(t.name, /^[a-z][a-z0-9_]*$/, `${key}.${t.name}: name must be snake_case`);
            assert.ok(t.description.length > 5, `${key}.${t.name}: description missing`);
            assert.ok(Array.isArray(t.params), `${key}.${t.name}: params must be an array`);
            assert.equal(new Set(t.params).size, t.params.length, `${key}.${t.name}: duplicate params`);
            seen.add(t.name);
        }
    }
    assert.ok(seen.size >= 30, `expected 30+ distinct tools, got ${seen.size}`);
}

function testUnknownSectorFallsBackToGeneral(): void {
    assert.deepEqual(getSectorTools('settore-inesistente'), SARA_TOOLS.general);
    assert.deepEqual(getSectorTools(''), SARA_TOOLS.general);
}

function testSnippetListsEveryToolOfTheSector(): void {
    const tools = getSectorTools('travel');
    const snippet = buildToolContextSnippet('travel');
    for (const t of tools) assert.ok(snippet.includes(`- ${t.name}(${t.params.join(', ')})`), `snippet misses ${t.name}`);
    assert.match(snippet, /NON inventare dati/);
}

function testFormatToolResult(): void {
    assert.equal(formatToolResult('get_rate', null), null);
    assert.equal(formatToolResult('get_rate', {}), null);
    assert.equal(formatToolResult('get_rate', { eur: 90 }), '[Risultato get_rate]: {"eur":90}');
}

function testVerticalFilter(): void {
    delete process.env.SARA_VERTICALS;
    assert.equal(activeVerticals(), null);
    assert.deepEqual(getSectorTools('ristorante'), SARA_TOOLS.dine);
    process.env.SARA_VERTICALS = ' Dine , beauty ';
    assert.deepEqual([...activeVerticals()!], ['dine', 'beauty']);
    assert.deepEqual(getSectorTools('ristorante'), SARA_TOOLS.dine, 'allowed vertical keeps its tools');
    assert.deepEqual(getSectorTools('bellezza'), SARA_TOOLS.beauty, 'aliases resolve before filtering');
    assert.deepEqual(getSectorTools('turismo'), SARA_TOOLS.general, 'disabled vertical falls back to general');
    assert.deepEqual(getSectorTools('general'), SARA_TOOLS.general);
    delete process.env.SARA_VERTICALS;
}

testEveryToolIsWellFormed();
testVerticalFilter();
testUnknownSectorFallsBackToGeneral();
testSnippetListsEveryToolOfTheSector();
testFormatToolResult();
console.log('sara-tools tests passed');
