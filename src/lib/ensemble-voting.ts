// ═══════════════════════════════════════════════════════════
// ensemble-voting.ts — 3×7B Voting Engine for SARA
// ═══════════════════════════════════════════════════════════
// Queries Ollama with 3 parallel requests using different temperatures,
// then picks the best answer via majority voting.
// 3×7B gives 70B-equivalent quality at zero marginal cost.
// VRAM: 3 concurrent 7B Q4 = ~13.5GB (fits in 20GB RTX 4000 Ada)
//
// When to use: for factual questions where accuracy > speed.
// The caller decides whether to use ensemble or single-shot.

import type { ChatMsg, ChatResult } from './ai-providers.js';

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
const ENSEMBLE_MODELS = (process.env.ENSEMBLE_MODELS || '').split(',').filter(Boolean);
const DEFAULT_MODEL = process.env.OLLAMA_CHAT_MODEL || 'llama3.2:3b';

// Different temperature profiles for diversity
const TEMPERATURE_PROFILES = [0.1, 0.3, 0.5];

interface EnsembleCandidate {
    text: string;
    model: string;
    temperature: number;
    latencyMs: number;
}

interface EnsembleResult {
    text: string;
    provider: 'ensemble';
    candidates: number;
    agreement: number;
    method: 'majority' | 'longest' | 'single';
    latencyMs: number;
}

async function queryOllama(
    messages: ChatMsg[],
    model: string,
    temperature: number,
    maxTokens: number
): Promise<EnsembleCandidate> {
    const start = Date.now();
    const res = await fetch(`${OLLAMA_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model,
            messages,
            stream: false,
            options: { temperature, num_predict: maxTokens },
        }),
        signal: AbortSignal.timeout(60000),
    });

    if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`Ollama ensemble HTTP ${res.status}: ${body.slice(0, 200)}`);
    }

    const data = await res.json() as any;
    const text = data?.message?.content || '';
    if (!text) throw new Error('Ollama ensemble empty');

    return { text, model, temperature, latencyMs: Date.now() - start };
}

// Extract key facts (numbers, names, prices) from a response for comparison
function extractFacts(text: string): string[] {
    const facts: string[] = [];

    // Numbers with currency
    const prices = text.match(/[\d.,]+\s*(?:EUR|€|USD|\$|CHF)/gi);
    if (prices) facts.push(...prices.map(p => p.replace(/\s+/g, '').toLowerCase()));

    // Standalone numbers
    const numbers = text.match(/\b\d[\d.,]*\b/g);
    if (numbers) facts.push(...numbers);

    // Yes/no/sì answers
    const yesNo = text.match(/\b(sì|si|no|yes|oui|ja|nein)\b/i);
    if (yesNo) facts.push(yesNo[1].toLowerCase());

    return facts;
}

// Compare two responses for factual agreement
function factualAgreement(a: string, b: string): number {
    const factsA = extractFacts(a);
    const factsB = extractFacts(b);

    if (factsA.length === 0 && factsB.length === 0) return 1.0; // both conversational, agree by default
    if (factsA.length === 0 || factsB.length === 0) return 0.5; // one has facts, other doesn't

    let matches = 0;
    for (const f of factsA) {
        if (factsB.some(fb => fb === f || fb.includes(f) || f.includes(fb))) matches++;
    }

    return matches / Math.max(factsA.length, factsB.length);
}

export async function ensembleChat(
    messages: ChatMsg[],
    maxTokens = 300
): Promise<EnsembleResult> {
    const start = Date.now();
    const models = ENSEMBLE_MODELS.length >= 3
        ? ENSEMBLE_MODELS.slice(0, 3)
        : [DEFAULT_MODEL, DEFAULT_MODEL, DEFAULT_MODEL];

    // Query 3 models in parallel with different temperatures
    const promises = models.map((model, i) =>
        queryOllama(messages, model, TEMPERATURE_PROFILES[i], maxTokens)
            .catch((): null => null)
    );

    const results = await Promise.all(promises);
    const candidates = results.filter((r): r is EnsembleCandidate => r !== null);

    if (candidates.length === 0) {
        throw new Error('Ensemble: all 3 models failed');
    }

    if (candidates.length === 1) {
        return {
            text: candidates[0].text,
            provider: 'ensemble',
            candidates: 1,
            agreement: 1.0,
            method: 'single',
            latencyMs: Date.now() - start,
        };
    }

    // Pairwise factual agreement
    let bestIdx = 0;
    let bestScore = 0;

    for (let i = 0; i < candidates.length; i++) {
        let totalAgreement = 0;
        for (let j = 0; j < candidates.length; j++) {
            if (i !== j) {
                totalAgreement += factualAgreement(candidates[i].text, candidates[j].text);
            }
        }
        if (totalAgreement > bestScore) {
            bestScore = totalAgreement;
            bestIdx = i;
        }
    }

    const agreement = bestScore / (candidates.length - 1);

    // If no clear majority (all disagree), pick longest (most detailed)
    if (agreement < 0.3) {
        const longest = candidates.reduce((a, b) => a.text.length > b.text.length ? a : b);
        console.log(`[ENSEMBLE] No majority (agreement=${agreement.toFixed(2)}), using longest response (${longest.model}, ${longest.text.length} chars)`);
        return {
            text: longest.text,
            provider: 'ensemble',
            candidates: candidates.length,
            agreement,
            method: 'longest',
            latencyMs: Date.now() - start,
        };
    }

    console.log(`[ENSEMBLE] Majority vote: model=${candidates[bestIdx].model}, agreement=${agreement.toFixed(2)}, candidates=${candidates.length}`);

    return {
        text: candidates[bestIdx].text,
        provider: 'ensemble',
        candidates: candidates.length,
        agreement,
        method: 'majority',
        latencyMs: Date.now() - start,
    };
}

// Quick check: should we use ensemble for this question?
// Ensemble is slower (~3x latency), so only use for factual queries.
export function shouldUseEnsemble(question: string, sector: string): boolean {
    if (!process.env.ENSEMBLE_ENABLED || process.env.ENSEMBLE_ENABLED !== 'true') return false;

    // Use ensemble for questions that need factual accuracy
    const factualPatterns = /quanto\s*cost|prezzo|prezz|tariff|price|cost|cuánto|cuanto|how\s*much|combien|wieviel|preventiv|listino|abbonament|fee|rate|membership/i;
    return factualPatterns.test(question);
}
