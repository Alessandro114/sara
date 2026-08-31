// ═══════════════════════════════════════════════════
// The numbers in the README must match the code — vanilla node:assert
// Run: npx tsx src/__tests__/readme-numeri.test.ts
//
// The README said 87 tools when the engine defines 83, and in the table at
// the bottom it attributed those 87 to scala-agent-definitions, which
// actually has 80. Three wrong numbers in three places, all written in good
// faith and grown stale alongside the code.
//
// An inflated number in an open source README isn't a cosmetic detail:
// people evaluating the project count it, and when it doesn't add up they
// stop trusting the rest too. With few stars, honesty is the only lever
// that works.
//
// Written with node:assert and deliberately NOT with vitest: this repo
// doesn't have vitest among its dependencies, and the runner is
// scripts/run-tests.sh, which runs every file with tsx. A test that imports
// vitest here doesn't fail — it doesn't even start, and the runner counts
// it as an error. I fell into this trap myself writing it the first time
// and checking it with `npx vitest`, which picked it up from the cache: it
// passed with a tool that doesn't exist in the project.
// ═══════════════════════════════════════════════════

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SARA_TOOLS } from '../sara-tools.js';

const RADICE = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const readme = readFileSync(join(RADICE, 'README.md'), 'utf8');

const VERTICALI = Object.keys(SARA_TOOLS);
const STRUMENTI = Object.values(SARA_TOOLS).reduce((n, v) => n + v.length, 0);

function testStrumentiEsistono() {
    assert.ok(VERTICALI.length > 10, `solo ${VERTICALI.length} verticali`);
    assert.ok(STRUMENTI > 50, `solo ${STRUMENTI} strumenti`);
    console.log(`✅ testStrumentiEsistono: ${VERTICALI.length} verticali, ${STRUMENTI} strumenti`);
}

function testNomiValidi() {
    for (const [vert, strumenti] of Object.entries(SARA_TOOLS)) {
        for (const t of strumenti) {
            assert.equal(typeof t.name, 'string', `${vert}: strumento senza nome`);
            assert.notEqual(t.name.trim(), '', `${vert}: nome vuoto`);
        }
    }
    console.log('✅ testNomiValidi: ogni strumento ha un nome non vuoto');
}

function testNomiUnici() {
    for (const [vert, strumenti] of Object.entries(SARA_TOOLS)) {
        const nomi = strumenti.map(t => t.name);
        assert.equal(nomi.length, new Set(nomi).size, `${vert}: nomi di strumento duplicati`);
    }
    console.log('✅ testNomiUnici: nessun duplicato dentro lo stesso verticale');
}

function testReadmeConcorda() {
    // The line in the repos table talks about a DIFFERENT project and must
    // be excluded: it's "N AI tool definitions", with AI in the middle.
    const citazioni = [...readme.matchAll(/(\d+)\s+tool definitions/gi)]
        .filter(m => !/AI tool definitions/i.test(m[0]))
        .map(m => Number(m[1]));

    assert.ok(citazioni.length > 0, 'nessuna citazione trovata: il README e cambiato forma');
    for (const n of citazioni) {
        assert.equal(n, STRUMENTI, `il README dice ${n} strumenti, il motore ne definisce ${STRUMENTI}`);
    }
    console.log(`✅ testReadmeConcorda: ${citazioni.length} citazioni, tutte a ${STRUMENTI}`);
}

function testNessunNumeroVecchio() {
    assert.ok(!/\b87\s+(?:AI\s+)?tool/i.test(readme), 'il README cita ancora 87 strumenti');
    console.log('✅ testNessunNumeroVecchio: nessuna traccia del vecchio 87');
}

(async () => {
    try {
        testStrumentiEsistono();
        testNomiValidi();
        testNomiUnici();
        testReadmeConcorda();
        testNessunNumeroVecchio();
        console.log('\n🎉 readme-numeri tests passed');
        process.exit(0);
    } catch (err: any) {
        console.error('\n❌ readme-numeri test failed:', err?.message || err);
        process.exit(1);
    }
})();
