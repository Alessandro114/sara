/**
 * Caricamento dei pacchetti verticali.
 *
 * ── Cos'e un pacchetto ─────────────────────────────────────────────
 * Un file JSON. Niente altro:
 *
 *   {
 *     "vertical": "dine",
 *     "prompts": { "it": "...", "en": "...", "es": "...", "pt": "..." }
 *   }
 *
 * Scriverne uno per il proprio settore e mettere il file in una cartella. Non
 * serve toccare il motore, non serve ricompilare, non serve un plugin.
 *
 * ── Dove li cerca ──────────────────────────────────────────────────
 *   1. `packs/` accanto al codice — i pacchetti inclusi in questo repo
 *   2. la cartella indicata da SARA_VERTICAL_PACKS, se impostata
 *
 * Chi arriva dopo vince, cosi un pacchetto proprio puo sostituire uno incluso
 * senza modificare il repo.
 *
 * ── Perche i verticali non stanno piu nel codice ───────────────────
 * Stavano in otto costanti dentro due file, 2.349 righe in quattro lingue.
 * Erano il lavoro di dominio — la parte difficile — mentre il motore intorno
 * (adattatore WhatsApp, function calling, failover) e la parte che chiunque
 * puo riscrivere. Tenerli dentro significava regalare la parte difficile e
 * proteggere la commodity: esattamente al contrario.
 *
 * Ora il motore e aperto e ne include due, `general` e `dine`. Gli altri sono
 * pacchetti a parte. Chi vuole il proprio settore lo scrive; chi li vuole
 * pronti li trova su get-scala.com.
 *
 * ── Se un pacchetto manca ──────────────────────────────────────────
 * Non e un errore: si ricade su `general`, che e sempre presente. Un motore
 * che smette di rispondere perche manca un file di prompt sarebbe peggio di
 * uno che risponde in modo generico.
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

/** Le cartelle in cui cercare, nell'ordine in cui vincono. */
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
                // Un pacchetto scritto male non deve impedire il caricamento degli
                // altri: si segnala e si prosegue. Chi lo sta scrivendo vede l'errore.
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

/** Ricarica dal disco. Serve ai test e a chi aggiunge pacchetti a caldo. */
export function ricaricaPacchetti(): void {
    cacheVerticali = null;
    cacheSettori = null;
}

/**
 * Il prompt per una chiave, nella lingua richiesta.
 * Ripiega sulla lingua italiana, poi su `general`. Non lancia mai.
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

/** Quali pacchetti sono caricati. Usato dal comando di diagnosi e dai test. */
export function elencoPacchetti(): { verticali: string[]; settori: string[]; cartelle: string[] } {
    return {
        verticali: Object.keys(pacchettiVerticali()).sort(),
        settori: Object.keys(pacchettiSettori()).sort(),
        cartelle: cartelle(),
    };
}
