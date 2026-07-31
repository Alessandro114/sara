// ═══════════════════════════════════════════════════════════
// ai-providers.ts — Unified AI provider chain for SARA
// ═══════════════════════════════════════════════════════════
// Chain order:
//   1. Groq (key rotation 1→2) — Llama 3.3 70B + Whisper Turbo + Vision 90B
//   2. Cerebras — OpenAI-compatible chat (chat only)
//   3. SambaNova — OpenAI-compatible chat (Llama 3.3 70B, DeepSeek V3.2)
//   4. Mistral — large + voxtral + pixtral (if MISTRAL_API_KEY set)
//
// Gemini REMOVED 2026-07-17 (product decision). There is no emergency provider
// after Mistral: each *Chain() throws when every provider failed, and callers
// degrade to an explicit, logged fallback.
//
// PII anonymization: all user messages are stripped of personal data before
// being sent to external AI providers (enterprise GDPR compliance).
//
// Providers that don't have a capability (e.g. Groq has no native audio
// "understanding" — it transcribes only) are skipped for that call type.
// Each function returns { text, provider } so callers can log which
// provider served the request.

import { anonymizePII, deanonymize, type PIIMap } from './pii-anonymizer.js';

const GROQ_KEYS: string[] = [
    process.env.GROQ_API_KEY,
    process.env.GROQ_API_KEY_2,
    process.env.GROQ_API_KEY_3,
].filter((k): k is string => !!k && k.length > 10);

let groqKeyIdx = 0;
function nextGroqKey(): string | null {
    if (GROQ_KEYS.length === 0) return null;
    const k = GROQ_KEYS[groqKeyIdx % GROQ_KEYS.length];
    groqKeyIdx = (groqKeyIdx + 1) % GROQ_KEYS.length;
    return k;
}

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
const OLLAMA_CHAT_MODEL = process.env.OLLAMA_CHAT_MODEL || 'llama3.2:3b';
const OLLAMA_VISION_MODEL = process.env.OLLAMA_VISION_MODEL || 'llava:7b';
const OLLAMA_EMBED_MODEL = process.env.OLLAMA_EMBED_MODEL || 'mxbai-embed-large';

const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY || '';
const MISTRAL_API_KEY_2 = process.env.MISTRAL_API_KEY_2 || '';
const MISTRAL_API_KEY_3 = process.env.MISTRAL_API_KEY_3 || '';
const MISTRAL_EMBED_MODEL = process.env.MISTRAL_EMBED_MODEL || 'mistral-embed';
// Mistral voxtral — audio transcription (STT) fallback after Groq Whisper.
// Endpoint is OpenAI-compatible multipart, same shape as Groq's Whisper.
const MISTRAL_STT_MODEL = process.env.MISTRAL_STT_MODEL || 'voxtral-mini-latest';

// Cerebras — wafer-scale inference, ~2000 tok/s, OpenAI-compatible, generous
// free tier. Same key already used by scala-backend. Slots into the chain right
// after Groq for max speed/uptime before falling back to Mistral.
// Cerebras key pool — rotate across multiple free accounts (each account has its
// own rate limit, so N accounts ≈ N× throughput). Same trick as GROQ_KEYS.
const CEREBRAS_KEYS = [
    process.env.CEREBRAS_API_KEY,
    process.env.CEREBRAS_API_KEY_2,
    process.env.CEREBRAS_API_KEY_3,
    process.env.CEREBRAS_API_KEY_4,
    process.env.CEREBRAS_API_KEY_5,
    ...(process.env.CEREBRAS_API_KEYS || '').split(','),
].map(k => (k || '').trim()).filter(k => k.length > 10);
let cerebrasKeyIdx = 0;
// This account exposes gpt-oss-120b + zai-glm-4.7. gpt-oss-120b is the best
// quality/speed pick and returns final content (no reasoning leakage) over the
// OpenAI-compatible endpoint. Override via CEREBRAS_MODEL.
const CEREBRAS_MODEL = process.env.CEREBRAS_MODEL || 'gpt-oss-120b';

// ═══════════════════════════════════════════════════════════
// SAMBANOVA — OpenAI-compatible, Llama 3.3 70B on RDU hardware
// Added 2026-07-25 as 3rd fallback (Groq→Cerebras→SambaNova→Mistral)
const SAMBANOVA_KEYS = [
    process.env.SAMBANOVA_API_KEY,
    process.env.SAMBANOVA_API_KEY_2,
    process.env.SAMBANOVA_API_KEY_3,
].map(k => (k || '').trim()).filter(k => k.length > 10);
let sambanovaKeyIdx = 0;
const SAMBANOVA_MODEL = process.env.SAMBANOVA_MODEL || 'Meta-Llama-3.3-70B-Instruct';

// Model IDs — Groq lineup as of 2026-04-12. Override via env to pick
// alternatives (qwen/qwen3-32b, openai/gpt-oss-120b, etc).
const GROQ_CHAT_MODEL = process.env.GROQ_CHAT_MODEL || 'llama-3.3-70b-versatile';
// Llama 4 Scout is Groq's multimodal-capable model (text+vision in one).
const GROQ_VISION_MODEL = process.env.GROQ_VISION_MODEL || 'meta-llama/llama-4-scout-17b-16e-instruct';
const GROQ_STT_MODEL = process.env.GROQ_STT_MODEL || 'whisper-large-v3-turbo';

export type ProviderName = 'groq' | 'cerebras' | 'sambanova' | 'ollama' | 'mistral' | 'none';

export interface ChatMsg {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string;
    tool_call_id?: string;
    tool_calls?: ToolCallResult[];
}

export interface ToolCallResult {
    id: string;
    type?: string;
    function: { name: string; arguments: string };
}

export interface ChatResult { text: string; provider: ProviderName; keyIdx?: number; tool_calls?: ToolCallResult[] }

/** OpenAI-compatible tool definition for function calling */
export interface ToolDef {
    type: 'function';
    function: {
        name: string;
        description: string;
        parameters: {
            type: 'object';
            properties: Record<string, { type: string; description?: string }>;
            required?: string[];
        };
    };
}
export interface TranscribeResult { text: string; provider: ProviderName }

// Capability gates
export function hasGroq(): boolean { return GROQ_KEYS.length > 0 }
export function hasCerebras(): boolean { return CEREBRAS_KEYS.length > 0 }
export function hasSambaNova(): boolean { return SAMBANOVA_KEYS.length > 0 }
export function hasOllama(): boolean { return !!OLLAMA_URL }
export function hasMistral(): boolean { return !!MISTRAL_API_KEY }

// ═══════════════════════════════════════════════════════════
// GROQ
// ═══════════════════════════════════════════════════════════

async function groqChat(messages: ChatMsg[], maxTokens = 600): Promise<ChatResult> {
    // Try each key in rotation; on 429/401/403, rotate once.
    const tried = new Set<number>();
    const startIdx = groqKeyIdx;
    let lastErr: Error | null = null;
    for (let attempt = 0; attempt < GROQ_KEYS.length; attempt++) {
        const idx = (startIdx + attempt) % GROQ_KEYS.length;
        if (tried.has(idx)) continue;
        tried.add(idx);
        const key = GROQ_KEYS[idx];
        try {
            const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
                body: JSON.stringify({
                    model: GROQ_CHAT_MODEL,
                    messages,
                    max_tokens: maxTokens,
                    temperature: 0.65,
                    top_p: 0.9,
                }),
                signal: AbortSignal.timeout(20000),
            });
            if (res.status === 429 || res.status === 401 || res.status === 403) {
                lastErr = new Error(`Groq key ${idx} HTTP ${res.status}`);
                continue;
            }
            if (!res.ok) {
                const body = await res.text().catch(() => '');
                throw new Error(`Groq HTTP ${res.status}: ${body.slice(0, 200)}`);
            }
            const data = await res.json() as any;
            const text = data?.choices?.[0]?.message?.content || '';
            if (!text) throw new Error('Groq empty');
            // Bump rotation pointer so next call starts on a fresh key
            groqKeyIdx = (idx + 1) % GROQ_KEYS.length;
            return { text, provider: 'groq', keyIdx: idx };
        } catch (err) {
            lastErr = err as Error;
            continue;
        }
    }
    throw lastErr || new Error('Groq: all keys exhausted');
}

async function groqVision(
    imageBase64: string,
    mimeType: string,
    prompt: string,
    maxTokens = 600
): Promise<ChatResult> {
    const tried = new Set<number>();
    const startIdx = groqKeyIdx;
    let lastErr: Error | null = null;
    const dataUrl = `data:${mimeType};base64,${imageBase64}`;
    for (let attempt = 0; attempt < GROQ_KEYS.length; attempt++) {
        const idx = (startIdx + attempt) % GROQ_KEYS.length;
        if (tried.has(idx)) continue;
        tried.add(idx);
        const key = GROQ_KEYS[idx];
        try {
            const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
                body: JSON.stringify({
                    model: GROQ_VISION_MODEL,
                    messages: [{
                        role: 'user',
                        content: [
                            { type: 'text', text: prompt },
                            { type: 'image_url', image_url: { url: dataUrl } },
                        ],
                    }],
                    max_tokens: maxTokens,
                    temperature: 0.65,
                }),
                signal: AbortSignal.timeout(30000),
            });
            if (res.status === 429 || res.status === 401 || res.status === 403) {
                lastErr = new Error(`Groq vision key ${idx} HTTP ${res.status}`);
                continue;
            }
            if (!res.ok) {
                const body = await res.text().catch(() => '');
                throw new Error(`Groq vision HTTP ${res.status}: ${body.slice(0, 200)}`);
            }
            const data = await res.json() as any;
            const text = data?.choices?.[0]?.message?.content || '';
            if (!text) throw new Error('Groq vision empty');
            groqKeyIdx = (idx + 1) % GROQ_KEYS.length;
            return { text, provider: 'groq', keyIdx: idx };
        } catch (err) {
            lastErr = err as Error;
            continue;
        }
    }
    throw lastErr || new Error('Groq vision: all keys exhausted');
}

// Map SARA language codes to Whisper BCP-47 codes
const WHISPER_LANG: Record<string, string> = { it: 'it', en: 'en', es: 'es', pt: 'pt' };

async function groqWhisper(audioBuffer: Buffer, mime: string, lang?: string): Promise<TranscribeResult> {
    if (GROQ_KEYS.length === 0) throw new Error('No Groq key');
    const key = nextGroqKey()!;
    const form = new FormData();
    const ext = mime.includes('ogg') ? 'ogg' : mime.includes('mp4') ? 'mp4' : mime.includes('wav') ? 'wav' : 'm4a';
    form.append('file', new Blob([audioBuffer as any], { type: mime }), `audio.${ext}`);
    form.append('model', GROQ_STT_MODEL);
    form.append('response_format', 'json');
    form.append('temperature', '0');
    // Pass language hint to prevent wrong-language detection (e.g. Italian → Romanian)
    const whisperLang = lang ? WHISPER_LANG[lang] : undefined;
    if (whisperLang) form.append('language', whisperLang);
    const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}` },
        body: form as any,
        signal: AbortSignal.timeout(25000),
    });
    if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`Groq STT HTTP ${res.status}: ${body.slice(0, 200)}`);
    }
    const data = await res.json() as any;
    const text = (data?.text || '').toString();
    if (!text) throw new Error('Groq STT empty');
    return { text, provider: 'groq' };
}

// Mistral voxtral — STT fallback after Groq Whisper. Contract verified 2026-07-17
// against docs.mistral.ai: POST /v1/audio/transcriptions, multipart form
// (file, model, optional language), response JSON with a top-level `text` field
// — i.e. the same I/O shape as Groq's Whisper above, so we replicate that pattern.
// Rotates MISTRAL_API_KEY → _2 → _3 on 401/403/429, like mistralEmbed().
async function mistralVoxtral(audioBuffer: Buffer, mime: string, lang?: string): Promise<TranscribeResult> {
    const keys = [MISTRAL_API_KEY, MISTRAL_API_KEY_2, MISTRAL_API_KEY_3].filter(k => !!k && k.length > 10);
    if (keys.length === 0) throw new Error('No Mistral key');
    const ext = mime.includes('ogg') ? 'ogg' : mime.includes('mp4') ? 'mp4' : mime.includes('wav') ? 'wav' : 'm4a';
    const voxtralLang = lang ? WHISPER_LANG[lang] : undefined;
    let lastErr: Error | null = null;
    for (let i = 0; i < keys.length; i++) {
        try {
            const form = new FormData();
            form.append('file', new Blob([audioBuffer as any], { type: mime }), `audio.${ext}`);
            form.append('model', MISTRAL_STT_MODEL);
            // Pass language hint to prevent wrong-language detection, like Groq Whisper
            if (voxtralLang) form.append('language', voxtralLang);
            const res = await fetch('https://api.mistral.ai/v1/audio/transcriptions', {
                method: 'POST',
                headers: { Authorization: `Bearer ${keys[i]}` },
                body: form as any,
                signal: AbortSignal.timeout(25000),
            });
            if (res.status === 429 || res.status === 401 || res.status === 403) {
                lastErr = new Error(`Mistral STT key ${i} HTTP ${res.status}`);
                continue;
            }
            if (!res.ok) {
                const body = await res.text().catch(() => '');
                throw new Error(`Mistral STT HTTP ${res.status}: ${body.slice(0, 200)}`);
            }
            const data = await res.json() as any;
            const text = (data?.text || '').toString();
            if (!text) throw new Error('Mistral STT empty');
            return { text, provider: 'mistral' };
        } catch (err) {
            lastErr = err as Error;
            // Only rotate keys on auth/rate-limit; other errors are not per-key
            if (!/HTTP (401|403|429)/.test(lastErr.message)) throw lastErr;
        }
    }
    throw lastErr || new Error('Mistral STT: all keys failed');
}

// ═══════════════════════════════════════════════════════════
// OLLAMA (local)
// ═══════════════════════════════════════════════════════════

let ollamaAvailable: boolean | null = null;
let ollamaCheckedAt = 0;
async function checkOllama(): Promise<boolean> {
    // Re-check every 30s to pick up service restart
    if (ollamaAvailable !== null && Date.now() - ollamaCheckedAt < 30000) return ollamaAvailable;
    try {
        const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(1500) });
        ollamaAvailable = res.ok;
    } catch {
        ollamaAvailable = false;
    }
    ollamaCheckedAt = Date.now();
    return ollamaAvailable;
}

async function ollamaChat(messages: ChatMsg[], maxTokens = 600): Promise<ChatResult> {
    if (!(await checkOllama())) throw new Error('Ollama unavailable');
    const res = await fetch(`${OLLAMA_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: OLLAMA_CHAT_MODEL,
            messages,
            stream: false,
            options: { temperature: 0.65, num_predict: maxTokens },
        }),
        signal: AbortSignal.timeout(45000),
    });
    if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`Ollama HTTP ${res.status}: ${body.slice(0, 200)}`);
    }
    const data = await res.json() as any;
    const text = data?.message?.content || '';
    if (!text) throw new Error('Ollama empty');
    return { text, provider: 'ollama' };
}

async function ollamaVision(
    imageBase64: string,
    _mimeType: string,
    prompt: string,
    maxTokens = 600
): Promise<ChatResult> {
    if (!(await checkOllama())) throw new Error('Ollama unavailable');
    const res = await fetch(`${OLLAMA_URL}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: OLLAMA_VISION_MODEL,
            prompt,
            images: [imageBase64],
            stream: false,
            options: { temperature: 0.65, num_predict: maxTokens },
        }),
        signal: AbortSignal.timeout(90000),
    });
    if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`Ollama vision HTTP ${res.status}: ${body.slice(0, 200)}`);
    }
    const data = await res.json() as any;
    const text = data?.response || '';
    if (!text) throw new Error('Ollama vision empty');
    return { text, provider: 'ollama' };
}

async function ollamaEmbed(text: string): Promise<number[]> {
    if (!(await checkOllama())) throw new Error('Ollama unavailable');
    const res = await fetch(`${OLLAMA_URL}/api/embed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: OLLAMA_EMBED_MODEL, input: text }),
        signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`Ollama embed HTTP ${res.status}`);
    const data = await res.json() as any;
    const vec = data?.embeddings?.[0] || data?.embedding;
    if (!Array.isArray(vec) || vec.length === 0) throw new Error('Ollama embed empty');
    return vec as number[];
}

// ═══════════════════════════════════════════════════════════
// MISTRAL
// ═══════════════════════════════════════════════════════════

async function mistralChat(messages: ChatMsg[], maxTokens = 600): Promise<ChatResult> {
    if (!MISTRAL_API_KEY) throw new Error('No Mistral key');
    const res = await fetch('https://api.mistral.ai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${MISTRAL_API_KEY}` },
        body: JSON.stringify({
            model: 'mistral-large-latest',
            messages,
            max_tokens: maxTokens,
            temperature: 0.65,
            top_p: 0.9,
        }),
        signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new Error(`Mistral HTTP ${res.status}`);
    const data = await res.json() as any;
    const text = data?.choices?.[0]?.message?.content || '';
    if (!text) throw new Error('Mistral empty');
    return { text, provider: 'mistral' };
}

async function mistralVision(
    imageBase64: string,
    mimeType: string,
    prompt: string,
    maxTokens = 600
): Promise<ChatResult> {
    if (!MISTRAL_API_KEY) throw new Error('No Mistral key');
    const dataUrl = `data:${mimeType};base64,${imageBase64}`;
    const res = await fetch('https://api.mistral.ai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${MISTRAL_API_KEY}` },
        body: JSON.stringify({
            model: 'pixtral-large-latest',
            messages: [{
                role: 'user',
                content: [
                    { type: 'text', text: prompt },
                    { type: 'image_url', image_url: dataUrl },
                ],
            }],
            max_tokens: maxTokens,
            temperature: 0.65,
        }),
        signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) throw new Error(`Mistral vision HTTP ${res.status}`);
    const data = await res.json() as any;
    const text = data?.choices?.[0]?.message?.content || '';
    if (!text) throw new Error('Mistral vision empty');
    return { text, provider: 'mistral' };
}

async function mistralEmbedWithKey(text: string, key: string): Promise<number[]> {
    const res = await fetch('https://api.mistral.ai/v1/embeddings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({ model: MISTRAL_EMBED_MODEL, input: [text] }),
        signal: AbortSignal.timeout(15000),
    });
    if (res.status === 429 || res.status === 401 || res.status === 403) {
        throw new Error(`Mistral embed HTTP ${res.status}`);
    }
    if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`Mistral embed HTTP ${res.status}: ${body.slice(0, 200)}`);
    }
    const data = await res.json() as any;
    const vec = data?.data?.[0]?.embedding;
    if (!Array.isArray(vec) || vec.length === 0) throw new Error('Mistral embed empty');
    return vec as number[];
}

// Rotate through MISTRAL_API_KEY → MISTRAL_API_KEY_2 on rate-limit/auth errors
async function mistralEmbed(text: string): Promise<number[]> {
    const keys = [MISTRAL_API_KEY, MISTRAL_API_KEY_2].filter(k => !!k && k.length > 10);
    if (keys.length === 0) throw new Error('No Mistral key');
    let lastErr: Error | null = null;
    for (let i = 0; i < keys.length; i++) {
        try {
            return await mistralEmbedWithKey(text, keys[i]);
        } catch (err) {
            lastErr = err as Error;
            const msg = lastErr.message;
            // Only rotate on auth/rate-limit errors; otherwise bail out
            if (!/HTTP (401|403|429)/.test(msg)) throw lastErr;
        }
    }
    throw lastErr || new Error('Mistral embed: all keys failed');
}

// ═══════════════════════════════════════════════════════════
// UNIFIED CHAIN
// ═══════════════════════════════════════════════════════════
// Chain order: groq → cerebras → sambanova → mistral [Ollama removed 2026-04-22,
// Gemini removed 2026-07-17, SambaNova added 2026-07-25]. Each function throws only when ALL providers
// failed; there is no further fallback for the caller to try.

// ═══════════════════════════════════════════════════════════
// CEREBRAS — OpenAI-compatible, single key, blazing fast
async function cerebrasChat(messages: ChatMsg[], maxTokens = 600): Promise<ChatResult> {
    // Rotate keys; on 429/401/403 try the next account, like groqChat.
    const startIdx = cerebrasKeyIdx;
    let lastErr: Error | null = null;
    for (let attempt = 0; attempt < CEREBRAS_KEYS.length; attempt++) {
        const idx = (startIdx + attempt) % CEREBRAS_KEYS.length;
        const key = CEREBRAS_KEYS[idx];
        try {
            const res = await fetch('https://api.cerebras.ai/v1/chat/completions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
                body: JSON.stringify({
                    model: CEREBRAS_MODEL,
                    messages,
                    max_tokens: maxTokens,
                    temperature: 0.65,
                    top_p: 0.9,
                }),
                signal: AbortSignal.timeout(20000),
            });
            if (res.status === 429 || res.status === 401 || res.status === 403) {
                lastErr = new Error(`Cerebras key ${idx} HTTP ${res.status}`);
                continue;
            }
            if (!res.ok) {
                const body = await res.text().catch(() => '');
                throw new Error(`Cerebras HTTP ${res.status}: ${body.slice(0, 200)}`);
            }
            const data = await res.json() as any;
            const text = data?.choices?.[0]?.message?.content || '';
            if (!text) throw new Error('Cerebras empty');
            cerebrasKeyIdx = (idx + 1) % CEREBRAS_KEYS.length;
            return { text, provider: 'cerebras', keyIdx: idx };
        } catch (err) {
            lastErr = err as Error;
            continue;
        }
    }
    throw lastErr || new Error('Cerebras: all keys exhausted');
}

// ═══════════════════════════════════════════════════════════
// SAMBANOVA — OpenAI-compatible, RDU hardware, Llama 3.3 70B
// Added 2026-07-25 as 3rd fallback in the chat chain.
async function sambanovaChat(messages: ChatMsg[], maxTokens = 600): Promise<ChatResult> {
    const startIdx = sambanovaKeyIdx;
    let lastErr: Error | null = null;
    for (let attempt = 0; attempt < SAMBANOVA_KEYS.length; attempt++) {
        const idx = (startIdx + attempt) % SAMBANOVA_KEYS.length;
        const key = SAMBANOVA_KEYS[idx];
        try {
            const res = await fetch('https://api.sambanova.ai/v1/chat/completions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
                body: JSON.stringify({
                    model: SAMBANOVA_MODEL,
                    messages,
                    max_tokens: maxTokens,
                    temperature: 0.65,
                    top_p: 0.9,
                }),
                signal: AbortSignal.timeout(20000),
            });
            if (res.status === 429 || res.status === 401 || res.status === 403) {
                lastErr = new Error(`SambaNova key ${idx} HTTP ${res.status}`);
                continue;
            }
            if (!res.ok) {
                const body = await res.text().catch(() => '');
                throw new Error(`SambaNova HTTP ${res.status}: ${body.slice(0, 200)}`);
            }
            const data = await res.json() as any;
            const text = data?.choices?.[0]?.message?.content || '';
            if (!text) throw new Error('SambaNova empty');
            sambanovaKeyIdx = (idx + 1) % SAMBANOVA_KEYS.length;
            return { text, provider: 'sambanova' as ProviderName, keyIdx: idx };
        } catch (err) {
            lastErr = err as Error;
            continue;
        }
    }
    throw lastErr || new Error('SambaNova: all keys exhausted');
}

export async function chatChain(messages: ChatMsg[], maxTokens = 600): Promise<ChatResult> {
    // PII Anonymization — strip personal data from user messages before LLM calls
    const piiMaps: PIIMap[] = [];
    const safeMessages = messages.map(msg => {
        if (msg.role === 'user' || msg.role === 'system') {
            const pii = anonymizePII(msg.content);
            piiMaps.push(pii);
            return { ...msg, content: pii.anonymized };
        }
        return msg;
    });

    // Collect all PII mappings for deanonymization
    const allOriginals = new Map<string, string>();
    for (const p of piiMaps) {
        for (const [k, v] of p.originals) allOriginals.set(k, v);
    }

    const errors: string[] = [];

    if (hasGroq()) {
        try {
            const result = await groqChat(safeMessages, maxTokens);
            result.text = deanonymize(result.text, allOriginals);
            return result;
        }
        catch (err) { errors.push(`groq: ${(err as Error).message}`); }
    }

    if (hasCerebras()) {
        try {
            const result = await cerebrasChat(safeMessages, maxTokens);
            result.text = deanonymize(result.text, allOriginals);
            return result;
        }
        catch (err) { errors.push(`cerebras: ${(err as Error).message}`); }
    }

    if (hasSambaNova()) {
        try {
            const result = await sambanovaChat(safeMessages, maxTokens);
            result.text = deanonymize(result.text, allOriginals);
            return result;
        }
        catch (err) { errors.push(`sambanova: ${(err as Error).message}`); }
    }

    if (hasMistral()) {
        try {
            const result = await mistralChat(safeMessages, maxTokens);
            result.text = deanonymize(result.text, allOriginals);
            return result;
        }
        catch (err) { errors.push(`mistral: ${(err as Error).message}`); }
    }

    throw new Error(`chatChain: all providers failed [${errors.join(' | ')}]`);
}

// ═══════════════════════════════════════════════════════════
// AGENTIC — Function Calling Chain (Groq only, llama-3.3-70b)
// ═══════════════════════════════════════════════════════════

async function groqChatWithTools(
    messages: ChatMsg[],
    tools: ToolDef[],
    maxTokens = 600,
): Promise<ChatResult> {
    const tried = new Set<number>();
    const startIdx = groqKeyIdx;
    let lastErr: Error | null = null;
    for (let attempt = 0; attempt < GROQ_KEYS.length; attempt++) {
        const idx = (startIdx + attempt) % GROQ_KEYS.length;
        if (tried.has(idx)) continue;
        tried.add(idx);
        const key = GROQ_KEYS[idx];
        try {
            const body: Record<string, unknown> = {
                model: GROQ_CHAT_MODEL,
                messages,
                max_tokens: maxTokens,
                temperature: 0.3, // lower temp for tool decisions
                top_p: 0.9,
                tools,
                tool_choice: 'auto',
            };
            const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
                body: JSON.stringify(body),
                signal: AbortSignal.timeout(25000),
            });
            if (res.status === 429 || res.status === 401 || res.status === 403) {
                lastErr = new Error(`Groq key ${idx} HTTP ${res.status}`);
                continue;
            }
            if (!res.ok) {
                const errBody = await res.text().catch(() => '');
                throw new Error(`Groq HTTP ${res.status}: ${errBody.slice(0, 200)}`);
            }
            const data = await res.json() as any;
            const choice = data?.choices?.[0];
            const msg = choice?.message;
            groqKeyIdx = (idx + 1) % GROQ_KEYS.length;

            // Tool call response
            if (msg?.tool_calls && msg.tool_calls.length > 0) {
                return {
                    text: msg.content || '',
                    provider: 'groq',
                    keyIdx: idx,
                    tool_calls: msg.tool_calls.map((tc: any) => ({
                        id: tc.id,
                        type: 'function',
                        function: { name: tc.function.name, arguments: tc.function.arguments },
                    })),
                };
            }

            // Normal text response (no tool call needed)
            const text = msg?.content || '';
            if (!text) throw new Error('Groq empty');
            return { text, provider: 'groq', keyIdx: idx };
        } catch (err) {
            lastErr = err as Error;
            continue;
        }
    }
    throw lastErr || new Error('Groq tool-call: all keys exhausted');
}

/**
 * chatChainWithTools — like chatChain but with function calling support.
 * Only Groq supports tool_calls; if Groq fails, falls back to regular
 * chatChain (text-only, no tool calls).
 */
export async function chatChainWithTools(
    messages: ChatMsg[],
    tools: ToolDef[],
    maxTokens = 600,
): Promise<ChatResult> {
    // PII Anonymization
    const piiMaps: PIIMap[] = [];
    const safeMessages = messages.map(msg => {
        if (msg.role === 'user' || msg.role === 'system') {
            const pii = anonymizePII(msg.content);
            piiMaps.push(pii);
            return { ...msg, content: pii.anonymized };
        }
        return msg;
    });
    const allOriginals = new Map<string, string>();
    for (const p of piiMaps) {
        for (const [k, v] of p.originals) allOriginals.set(k, v);
    }

    if (hasGroq()) {
        try {
            const result = await groqChatWithTools(safeMessages, tools, maxTokens);
            result.text = deanonymize(result.text, allOriginals);
            // Deanonymize tool call arguments so booked names/details are real, not masked
            if (result.tool_calls) {
                for (const tc of result.tool_calls) {
                    tc.function.arguments = deanonymize(tc.function.arguments, allOriginals);
                }
            }
            return result;
        } catch (err) {
            console.warn(`[AGENTIC] Groq tool-call failed: ${(err as Error).message}, falling back to text-only`);
        }
    }

    // Fallback: regular text-only chain (no tool calls)
    const textResult = await chatChain(messages, maxTokens);
    return textResult;
}

export async function visionChain(
    imageBase64: string,
    mimeType: string,
    prompt: string,
    maxTokens = 600
): Promise<ChatResult> {
    const errors: string[] = [];

    if (hasGroq()) {
        try { return await groqVision(imageBase64, mimeType, prompt, maxTokens); }
        catch (err) { errors.push(`groq: ${(err as Error).message}`); }
    }

    if (hasMistral()) {
        try { return await mistralVision(imageBase64, mimeType, prompt, maxTokens); }
        catch (err) { errors.push(`mistral: ${(err as Error).message}`); }
    }

    throw new Error(`visionChain: all providers failed [${errors.join(' | ')}]`);
}

export async function transcribeChain(audioBuffer: Buffer, mime: string, lang?: string): Promise<TranscribeResult> {
    const errors: string[] = [];

    // Primary: Groq Whisper (free, fast) — pass language hint to prevent wrong-language detection
    if (hasGroq()) {
        try { return await groqWhisper(audioBuffer, mime, lang); }
        catch (err) { errors.push(`groq: ${(err as Error).message}`); }
    }

    // Fallback: Mistral voxtral (voxtral-mini-latest) — second STT provider so a
    // Groq outage no longer breaks all customer voice notes. Added 2026-07-17 after
    // Gemini was removed left Groq as the sole provider. Cerebras has no audio.
    if (hasMistral()) {
        try { return await mistralVoxtral(audioBuffer, mime, lang); }
        catch (err) { errors.push(`mistral: ${(err as Error).message}`); }
    }

    // Chain: Groq Whisper → Mistral voxtral → hard failure. When BOTH are down
    // transcription fails loudly here — by design, never silently. Callers
    // (ai.ts → getMultimodalAIResponse) catch this and return a graceful
    // technical-issue message to the user.
    console.error(`[transcribeChain] all providers failed [${errors.join(' | ')}]`);
    throw new Error(`transcribeChain: all providers failed [${errors.join(' | ')}]`);
}

/**
 * Thrown when no embedding can be produced in the corpus's own vector space.
 * Callers MUST treat this as "no embedding available" and degrade to keyword search —
 * never as "embed with whatever else is around".
 */
export class EmbeddingUnavailableError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'EmbeddingUnavailableError';
    }
}

// ─── Embeddings chain: Mistral mistral-embed (1024d) — SOLE provider by design ───
//
// The wa_rag_documents corpus is embedded with mistral-embed. An embedding is only
// comparable to vectors produced by the SAME model: matching dimensionality is NOT
// sufficient, because different models learn different vector spaces.
//
// Measured 2026-07-16 — cosine similarity of a query against its own stored vector:
//     mistral-embed        → 1.0000
//     mxbai-embed-large    → 0.0601   (also 1024d!)
//
// So falling back to Ollama does not degrade the search, it silently randomises it:
// SARA would return unrelated documents with confidence and NOT ONE error in the logs.
// A wrong answer nobody can detect is worse than no answer. If Mistral is down we
// therefore refuse to embed, and the caller falls back to keyword search (a loud,
// honest failure).
//
// The fallback survives only behind an explicit opt-in, OFF by default, for the case
// where the corpus itself has been re-embedded with the Ollama model. Turning this on
// while the corpus is Mistral-embedded WILL produce silent garbage retrieval.
const ALLOW_OLLAMA_EMBED_FALLBACK = process.env.EMBED_ALLOW_OLLAMA_FALLBACK === 'true';

export async function embedChain(text: string): Promise<{ vector: number[]; provider: ProviderName }> {
    const errors: string[] = [];
    if (hasMistral()) {
        try {
            const vector = await mistralEmbed(text);
            return { vector, provider: 'mistral' };
        } catch (err) { errors.push(`mistral: ${(err as Error).message}`); }
    } else {
        errors.push('mistral: not configured (no API key)');
    }

    if (ALLOW_OLLAMA_EMBED_FALLBACK && hasOllama()) {
        console.warn(
            `[EMBED] Mistral unavailable — falling back to Ollama (${OLLAMA_EMBED_MODEL}). ` +
            'EMBED_ALLOW_OLLAMA_FALLBACK=true is set: this is only safe if wa_rag_documents ' +
            'was embedded with THIS model. Otherwise retrieval results are meaningless.'
        );
        try {
            const vector = await ollamaEmbed(text);
            return { vector, provider: 'ollama' };
        } catch (err) { errors.push(`ollama: ${(err as Error).message}`); }
    }

    // Loud: this is the difference between "SARA used keyword search" and
    // "SARA quietly answered from random documents".
    console.error(
        `[EMBED] embedding unavailable — corpus model (mistral-embed) cannot be reached. ` +
        `Caller must skip vector RAG and use keyword search. Errors: [${errors.join(' | ')}]`
    );
    throw new EmbeddingUnavailableError(
        `embedChain: no embedding in the corpus vector space [${errors.join(' | ')}]`
    );
}

export function getProviderStatus() {
    return {
        groq: { enabled: hasGroq(), keys: GROQ_KEYS.length, nextKey: groqKeyIdx },
        cerebras: { enabled: hasCerebras(), keys: CEREBRAS_KEYS.length },
        sambanova: { enabled: hasSambaNova(), keys: SAMBANOVA_KEYS.length },
        ollama: { enabled: hasOllama(), url: OLLAMA_URL, available: ollamaAvailable },
        mistral: { enabled: hasMistral() },
    };
}
