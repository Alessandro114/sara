// ═══════════════════════════════════════════════════
// S.A.R.A. — Vertical System Prompts
//
// The prompts themselves live in prompts/vertical.<lang>.json, one file per
// language, keyed by vertical. They used to sit in this file as four
// Record<string, string> literals totalling 1133 lines of data — 93% of the
// module — which meant every translation fix was a code change and adding a
// language meant editing TypeScript.
//
// Adding a language is now a data change: drop prompts/vertical.de.json next
// to the others and German works. No edit here, no redeploy of logic.
// A test asserts every language covers the same verticals, so a file that
// forgets one fails loudly instead of silently serving Italian.
//
// Each prompt still defines: persona, bounded sector knowledge, the
// anti-hallucination rules, response style, escalation rule, and the five
// most common questions with their response patterns.
// ═══════════════════════════════════════════════════

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PROMPTS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'prompts');
const FILE_PATTERN = /^vertical\.([a-z]{2})\.json$/;

/** vertical prompts by language code, then by vertical key. */
const PROMPTS: Record<string, Record<string, string>> = {};

for (const file of readdirSync(PROMPTS_DIR)) {
    const match = FILE_PATTERN.exec(file);
    if (!match) continue;
    PROMPTS[match[1]] = JSON.parse(readFileSync(join(PROMPTS_DIR, file), 'utf8'));
}

if (!PROMPTS.it) {
    throw new Error(
        `No Italian prompts found in ${PROMPTS_DIR}. Expected vertical.it.json — ` +
        `if this is a built artefact, the build must copy src/prompts into dist.`
    );
}

/** Language codes that have their own prompt file. */
export const AVAILABLE_LANGS = Object.keys(PROMPTS).sort();

/** Vertical keys, taken from Italian, which is the reference language. */
export const VERTICAL_KEYS = Object.keys(PROMPTS.it).sort();

// ─── Helper: get vertical prompt by sector key ────────────────────────────
// Maps legacy sector ids used in wa_sessions to the new vertical prompt keys.
const SECTOR_TO_VERTICAL: Record<string, string> = {
    turismo:        'travel',
    beauty:         'beauty',
    bellezza:       'beauty',
    pulizie:        'clean',
    clean:          'clean',
    dermatologia:   'dermaly',
    dermaly:        'dermaly',
    ristorante:     'dine',
    dine:           'dine',
    automotive:     'motor',
    motor:          'motor',
    network:        'network',
    legale:         'praxis',
    commercialista: 'praxis',
    praxis:         'praxis',
    immobiliare:    'property',
    property:       'property',
    studio:         'studio',
    studioos:       'studio',
    agenzia:        'agency',
    marketing:      'agency',
    agency:         'agency',
    general:        'general',
    scala_user:     'general',
    landiq:         'landiq',
    terreni:        'landiq',
    investimento:   'landiq',
    costruttore:    'landiq',
    builder:        'landiq',
};

/**
 * Get the vertical-specific system prompt for a given sector key.
 * Falls back to 'general' if the sector is unknown, and to Italian if the
 * requested language has no prompt for that vertical.
 */
export function getVerticalPrompt(sector: string, lang: string = 'it'): string {
    const key = SECTOR_TO_VERTICAL[sector] || 'general';
    const byLang = PROMPTS[lang.slice(0, 2).toLowerCase()];
    if (byLang && byLang[key]) return byLang[key];
    return PROMPTS.it[key] || PROMPTS.it.general;
}

/**
 * The mandatory anti-hallucination footer appended to EVERY system prompt,
 * regardless of vertical. Injected by the AI layer in getAIResponse().
 */
export const ANTI_HALLUCINATION_FOOTER = `

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
REGOLA FONDAMENTALE ANTI-ALLUCINAZIONE (non negoziabile):
Se non hai la risposta CERTA nella tua knowledge base, nel RAG o negli strumenti disponibili, NON inventare MAI.
Rispondi SEMPRE con: "Non ho questa informazione precisa al momento — ti metto in contatto con [nome_azienda] per una risposta accurata." e offri di raccogliere un contatto.
Non inventare: prezzi, disponibilità, certificazioni, tempi di consegna, risultati garantiti, nomi di persone, numeri di telefono, condizioni contrattuali.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;
