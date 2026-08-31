/**
 * Loading of vertical packs.
 *
 * ── What a pack is ─────────────────────────────────────────────────
 * A JSON file. Nothing else:
 *
 *   {
 *     "vertical": "dine",
 *     "prompts": { "it": "...", "en": "...", "es": "...", "pt": "..." }
 *   }
 *
 * Write one for your own sector and drop the file in a folder. No need to
 * touch the engine, no need to recompile, no need for a plugin.
 *
 * ── Where it looks for them ──────────────────────────────────────────
 *   1. `packs/` next to the code — the packs bundled with this repo
 *   2. the folder pointed to by SARA_VERTICAL_PACKS, if set
 *
 * Whoever arrives last wins, so your own pack can override a bundled one
 * without modifying the repo.
 *
 * ── Why verticals no longer live in the code ─────────────────────────
 * They used to sit in eight constants across two files, 2,349 lines in four
 * languages. They were the domain work — the hard part — while the engine
 * around them (WhatsApp adapter, function calling, failover) is the part
 * anyone can rewrite. Keeping them inside meant giving away the hard part
 * and protecting the commodity: exactly backwards.
 *
 * Now the engine is open and bundles two of them, `general` and `dine`. The
 * others are separate packs. Whoever wants their own sector writes it;
 * whoever wants ready-made ones finds them on get-scala.com.
 *
 * ── If a pack is missing ──────────────────────────────────────────────
 * That's not an error: it falls back to `general`, which is always present.
 * An engine that stops responding because a prompt file is missing would be
 * worse than one that responds generically.
 */
import { readFileSync, readdirSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

export type Lingua = 'it' | 'en' | 'es' | 'pt';

interface Pacchetto {
    vertical?: string;
    sector?: string;
    prompts: Partial<Record<Lingua, string>>;
}

const qui = dirname(fileURLToPath(import.meta.url));

/** The folders to search, in the order in which they win. */
function cartelle(): string[] {
    const dentro = [join(qui, '..', 'packs'), join(qui, 'packs')];
    const fuori = process.env.SARA_VERTICAL_PACKS
        ? process.env.SARA_VERTICAL_PACKS.split(':').filter(Boolean)
        : [];
    return [...dentro, ...fuori].filter((d) => existsSync(d));
}

function carica(tipo: 'vertical' | 'sector'): Record<string, Partial<Record<Lingua, string>>> {
    const fuori: Record<string, Partial<Record<Lingua, string>>> = {};
    for (const dir of cartelle()) {
        let files: string[];
        try {
            files = readdirSync(dir);
        } catch {
            continue;
        }
        for (const f of files) {
            if (!f.startsWith(`${tipo}.`) || !f.endsWith('.json')) continue;
            try {
                const p = JSON.parse(readFileSync(join(dir, f), 'utf8')) as Pacchetto;
                const chiave = (tipo === 'vertical' ? p.vertical : p.sector) ?? f.slice(tipo.length + 1, -5);
                if (p.prompts && Object.keys(p.prompts).length > 0) fuori[chiave] = p.prompts;
            } catch (err) {
                // A badly written pack must not block the loading of the
                // others: it gets logged and we move on. Whoever is writing
                // it sees the error.
                console.error(`[packs] ${join(dir, f)} ignorato: ${(err as Error).message}`);
            }
        }
    }
    return fuori;
}

let cacheVerticali: Record<string, Partial<Record<Lingua, string>>> | null = null;
let cacheSettori: Record<string, Partial<Record<Lingua, string>>> | null = null;

export function pacchettiVerticali() {
    if (!cacheVerticali) cacheVerticali = carica('vertical');
    return cacheVerticali;
}
export function pacchettiSettori() {
    if (!cacheSettori) cacheSettori = carica('sector');
    return cacheSettori;
}

/** Reloads from disk. Used by tests and by anyone hot-adding packs. */
export function ricaricaPacchetti(): void {
    cacheVerticali = null;
    cacheSettori = null;
}

/**
 * The prompt for a key, in the requested language.
 * Falls back to Italian, then to `general`. Never throws.
 */
export function promptDiPacchetto(
    tipo: 'vertical' | 'sector',
    chiave: string,
    lingua: string = 'it'
): string {
    const tutti = tipo === 'vertical' ? pacchettiVerticali() : pacchettiSettori();
    const l = (['en', 'es', 'pt'] as const).find((x) => lingua.startsWith(x)) ?? 'it';
    const voce = tutti[chiave] ?? tutti.general ?? {};
    return voce[l] ?? voce.it ?? tutti.general?.[l] ?? tutti.general?.it ?? '';
}

/** Which packs are loaded. Used by the diagnostics command and by tests. */
export function elencoPacchetti(): { verticali: string[]; settori: string[]; cartelle: string[] } {
    return {
        verticali: Object.keys(pacchettiVerticali()).sort(),
        settori: Object.keys(pacchettiSettori()).sort(),
        cartelle: cartelle(),
    };
}
