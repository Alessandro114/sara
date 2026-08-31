import { promptDiPacchetto } from './pack-loader.js';
// ═══════════════════════════════════════════════════
// S.A.R.A. — Vertical System Prompts (all 14 + general)
// Added: 2026-04-22 — zero-hallucination vertical specialization
// ═══════════════════════════════════════════════════
// Each prompt:
//  1. Defines persona (SARA + sector role)
//  2. Lists what SARA KNOWS (bounded sector knowledge)
//  3. Lists what SARA MUST NOT DO (anti-hallucination rules)
//  4. Defines response style
//  5. Defines escalation rule
//  6. Lists 5 most common questions with correct response patterns
// ═══════════════════════════════════════════════════


// ─── EN Vertical System Prompts ──────────────────────────────────────────

// ─── ES Vertical System Prompts ──────────────────────────────────────────

// ─── PT Vertical System Prompts ──────────────────────────────────────────

// ─── Helper: get vertical prompt by sector key ────────────────────────────
// Maps legacy sector ids used in wa_sessions to the new vertical prompt keys.
/**
 * Vertical prompts no longer live here.
 *
 * They used to be four constants — VERTICAL_SYSTEM_PROMPTS and the EN/ES/PT
 * versions — totaling 1,133 lines. Now they are JSON files in `packs/`,
 * loaded by `pack-loader.ts`. This file keeps the MECHANISM: the sector
 * synonym map, the language selection, the anti-hallucination footer.
 *
 * The repo includes `general` and `dine`. To add your own sector, just add
 * a JSON file: no code changes, no recompiling.
 */

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
 * Falls back to 'general' if the sector is unknown.
 * When lang starts with 'en', returns the English version if available.
 */
export function getVerticalPrompt(sector: string, lang: string = 'it'): string {
    // `SECTOR_TO_VERTICAL` translates the 29 sector synonyms (ristorante,
    // turismo, bellezza...) into pack keys. If the pack doesn't exist,
    // promptDiPacchetto falls back to `general`: a removed sector doesn't
    // break anything, it just responds generically.
    const key = SECTOR_TO_VERTICAL[sector] || 'general';
    return promptDiPacchetto('vertical', key, lang);
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
