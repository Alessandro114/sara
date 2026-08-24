// I numeri che il README dichiara devono corrispondere al codice.
//
// Il README diceva 87 strumenti quando il motore ne definisce 83, e nella
// tabella in fondo attribuiva quegli 87 a scala-agent-definitions, che ne ha
// 80. Tre numeri sbagliati in tre punti diversi, tutti scritti in buona fede
// e invecchiati insieme al codice.
//
// Un numero gonfiato in un README open source non e un dettaglio estetico: chi
// valuta il progetto lo conta, e quando non torna smette di fidarsi anche del
// resto. Con poche stelle la sincerita e l'unica leva che funziona.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SARA_TOOLS } from '../sara-tools.js';

const RADICE = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const readme = readFileSync(join(RADICE, 'README.md'), 'utf8');

const VERTICALI = Object.keys(SARA_TOOLS);
const STRUMENTI = Object.values(SARA_TOOLS).reduce((n, v) => n + v.length, 0);

describe('gli strumenti del motore', () => {
    it('ce ne sono, e sono distribuiti su piu verticali', () => {
        expect(VERTICALI.length).toBeGreaterThan(10);
        expect(STRUMENTI).toBeGreaterThan(50);
    });

    it('ogni strumento ha un nome non vuoto', () => {
        for (const [vert, strumenti] of Object.entries(SARA_TOOLS)) {
            for (const t of strumenti) {
                expect(typeof t.name, vert).toBe('string');
                expect(String(t.name).trim(), vert).not.toBe('');
            }
        }
    });

    it('nessun nome duplicato dentro lo stesso verticale', () => {
        for (const [vert, strumenti] of Object.entries(SARA_TOOLS)) {
            const nomi = strumenti.map(t => t.name);
            expect(nomi.length, vert).toBe(new Set(nomi).size);
        }
    });
});

describe('il README dichiara i numeri veri', () => {
    it(`"N tool definitions" corrisponde ai ${STRUMENTI} definiti nel motore`, () => {
        // La riga della tabella dei repo parla di un ALTRO progetto e va
        // esclusa: e "N AI tool definitions", con AI in mezzo.
        const citazioni = [...readme.matchAll(/(\d+)\s+tool definitions/gi)]
            .filter(m => !/AI tool definitions/i.test(m[0]))
            .map(m => Number(m[1]));
        expect(citazioni.length, 'nessuna citazione trovata: il README e cambiato forma').toBeGreaterThan(0);
        for (const n of citazioni) expect(n).toBe(STRUMENTI);
    });

    it('non resta traccia del vecchio 87', () => {
        expect(readme).not.toMatch(/\b87\s+(?:AI\s+)?tool/i);
    });
});
