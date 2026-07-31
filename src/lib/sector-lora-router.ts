// ═══════════════════════════════════════════════════════════
// sector-lora-router.ts — Route sectors to specialized LoRA models
// ═══════════════════════════════════════════════════════════
// Each sector can have its own LoRA adapter on a base 7B model.
// This router maps sector → Ollama model name.
// When SARA is fine-tuned per-vertical, each adapter specializes
// in its domain (immobiliare talks real estate, legale talks law).
//
// LoRA adapters are loaded by Ollama as separate model names:
//   - sara-7b-immobiliare (base + immobiliare adapter)
//   - sara-7b-legale (base + legale adapter)
//   - sara-7b-general (base, no adapter)
//
// Until fine-tuning is done, all sectors fall back to the default model.

const DEFAULT_MODEL = process.env.OLLAMA_CHAT_MODEL || 'llama3.2:3b';

// Sector → Ollama model name mapping
// Update this as LoRA adapters are trained and loaded into Ollama
const SECTOR_MODEL_MAP: Record<string, string> = {
    // When a sector-specific model exists, map it here:
    // immobiliare: 'sara-7b-immobiliare',
    // legale: 'sara-7b-legale',
    // commercialista: 'sara-7b-commercialista',
    // ristorante: 'sara-7b-ristorante',
    // automotive: 'sara-7b-automotive',
    // dermatologia: 'sara-7b-dermatologia',
    // beauty: 'sara-7b-beauty',
    // turismo: 'sara-7b-turismo',
    // cleaning: 'sara-7b-cleaning',
    // waste: 'sara-7b-waste',
};

export function getModelForSector(sector: string): string {
    // Check env override first (e.g., SECTOR_MODEL_IMMOBILIARE=sara-7b-immobiliare)
    const envKey = `SECTOR_MODEL_${sector.toUpperCase()}`;
    const envModel = process.env[envKey];
    if (envModel) return envModel;

    return SECTOR_MODEL_MAP[sector] || DEFAULT_MODEL;
}

// Get ensemble models for a sector (3 different configs for voting)
export function getEnsembleModels(sector: string): string[] {
    const primary = getModelForSector(sector);

    // If we have the sector-specific model, use 3 instances of it
    // with different temperatures (handled by ensemble-voting.ts)
    if (SECTOR_MODEL_MAP[sector]) {
        return [primary, primary, primary];
    }

    // If ENSEMBLE_MODELS is set, use those
    const envModels = (process.env.ENSEMBLE_MODELS || '').split(',').filter(Boolean);
    if (envModels.length >= 3) return envModels.slice(0, 3);

    // Default: 3 instances of the same model
    return [primary, primary, primary];
}

// Check which sectors have specialized models loaded
export async function getAvailableModels(): Promise<Record<string, string>> {
    const OLLAMA_URL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
    const result: Record<string, string> = {};

    try {
        const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(3000) });
        if (!res.ok) return result;

        const data = await res.json() as any;
        const models = (data?.models || []).map((m: any) => m.name as string);

        for (const [sector, model] of Object.entries(SECTOR_MODEL_MAP)) {
            if (models.some((m: string) => m.startsWith(model))) {
                result[sector] = model;
            }
        }

        // Also check env overrides
        for (const sector of Object.keys(SECTOR_MODEL_MAP)) {
            const envKey = `SECTOR_MODEL_${sector.toUpperCase()}`;
            if (process.env[envKey] && models.some((m: string) => m.startsWith(process.env[envKey]!))) {
                result[sector] = process.env[envKey]!;
            }
        }
    } catch { /* Ollama not available */ }

    return result;
}

// Info for logging/debugging
export function getRoutingInfo(sector: string): { model: string; isSpecialized: boolean; source: string } {
    const envKey = `SECTOR_MODEL_${sector.toUpperCase()}`;
    if (process.env[envKey]) {
        return { model: process.env[envKey]!, isSpecialized: true, source: 'env' };
    }
    if (SECTOR_MODEL_MAP[sector]) {
        return { model: SECTOR_MODEL_MAP[sector], isSpecialized: true, source: 'map' };
    }
    return { model: DEFAULT_MODEL, isSpecialized: false, source: 'default' };
}
