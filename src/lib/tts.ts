// ═══════════════════════════════════════════════════════════
// Text-to-speech replies (issue #8) — edge-tts (free, no API key), pip install edge-tts
//
//   SARA_TTS_REPLY   off (default) | voice_only (answer voice notes with a voice note) | always
//   SARA_TTS_VOICE_<LANG>  override voice, e.g. SARA_TTS_VOICE_IT=it-IT-IsabellaNeural
//   SARA_TTS_BIN     edge-tts binary (default "edge-tts")
//   SARA_TTS_MAX_CHARS  longer replies stay text (default 600)
//
// Disabled or failing TTS always falls back to the normal text reply.
// ═══════════════════════════════════════════════════════════
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export type TtsMode = 'off' | 'voice_only' | 'always';

const DEFAULT_VOICES: Record<string, string> = {
    it: 'it-IT-ElsaNeural', en: 'en-GB-SoniaNeural', es: 'es-ES-ElviraNeural', pt: 'pt-BR-FranciscaNeural',
};

export function ttsMode(): TtsMode {
    const v = (process.env.SARA_TTS_REPLY || 'off').trim().toLowerCase();
    return v === 'voice_only' || v === 'always' ? v : 'off';
}

/** Should this reply go out as a voice note? */
export function shouldSpeak(incomingWasVoice: boolean, text: string): boolean {
    const mode = ttsMode();
    if (mode === 'off') return false;
    if (mode === 'voice_only' && !incomingWasVoice) return false;
    const max = Number.parseInt(process.env.SARA_TTS_MAX_CHARS ?? '600', 10) || 600;
    const t = text.trim();
    return t.length >= 2 && t.length <= max;
}

export function voiceFor(lang: string): string {
    const l = (lang || 'it').toLowerCase().slice(0, 2);
    return process.env[`SARA_TTS_VOICE_${l.toUpperCase()}`] || DEFAULT_VOICES[l] || DEFAULT_VOICES.it;
}

/** Strip what sounds wrong when read aloud: URLs, emoji, markdown marks. */
export function cleanForSpeech(text: string): string {
    return text
        .replace(/https?:\/\/\S+/g, '')
        .replace(/[*_`#>~]/g, '')
        .replace(/\p{Extended_Pictographic}/gu, '')
        .replace(/\s+/g, ' ')
        .trim();
}

/** Returns an mp3 buffer, or null on any failure. No shell: args are passed as an array. */
export async function synthesize(text: string, lang: string): Promise<Buffer | null> {
    const clean = cleanForSpeech(text);
    if (!clean) return null;
    let dir: string | null = null;
    try {
        dir = await mkdtemp(join(tmpdir(), 'sara-tts-'));
        const out = join(dir, 'reply.mp3');
        await new Promise<void>((resolve, reject) => {
            execFile(process.env.SARA_TTS_BIN || 'edge-tts', ['--voice', voiceFor(lang), '--text', clean, '--write-media', out],
                { timeout: 20000 }, (err) => (err ? reject(err) : resolve()));
        });
        return await readFile(out);
    } catch (err: any) {
        console.warn(`[TTS] synthesis failed: ${err?.message}`);
        return null;
    } finally {
        if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
}
