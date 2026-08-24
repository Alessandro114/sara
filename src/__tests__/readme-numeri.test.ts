// ═══════════════════════════════════════════════════
// I numeri del README devono corrispondere al codice — vanilla node:assert
// Run: npx tsx src/__tests__/readme-numeri.test.ts
//
// Il README diceva 87 strumenti quando il motore ne definisce 83, e nella
// tabella in fondo attribuiva quegli 87 a scala-agent-definitions, che ne ha
// 80. Tre numeri sbagliati in tre punti, tutti scritti in buona fede e
// invecchiati insieme al codice.
//
// Un numero gonfiato in un README open source non e un dettaglio estetico: chi
// valuta il progetto lo conta, e quando non torna smette di fidarsi anche del
// resto. Con poche stelle la sincerita e l'unica leva che funziona.
//
// Scritto con node:assert e NON con vitest di proposito: questo repo non ha
// vitest fra le dipendenze e il runner e scripts/run-tests.sh, che esegue ogni
// file con tsx. Un test che importa vitest qui non fallisce — non parte
// proprio, e il runner lo conta come errore. Ci sono cascato scrivendolo la
// prima volta e verificandolo con `npx vitest`, che se lo prendeva dalla
// cache: passava con uno strumento che nel progetto non esiste.
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
    // La riga della tabella dei repo parla di un ALTRO progetto e va esclusa:
    // e "N AI tool definitions", con AI in mezzo.
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
