// tts.ts (issue #8). Run: npx tsx src/__tests__/tts.test.ts
import assert from 'node:assert/strict';
import { chmodSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cleanForSpeech, shouldSpeak, synthesize, ttsMode, voiceFor } from '../lib/tts.js';

delete process.env.SARA_TTS_REPLY;
assert.equal(ttsMode(), 'off');
assert.equal(shouldSpeak(true, 'ciao a tutti'), false, 'off by default');
process.env.SARA_TTS_REPLY = 'voice_only';
assert.equal(shouldSpeak(true, 'ciao a tutti'), true);
assert.equal(shouldSpeak(false, 'ciao a tutti'), false, 'text in -> text out');
process.env.SARA_TTS_REPLY = 'always';
assert.equal(shouldSpeak(false, 'ciao a tutti'), true);
assert.equal(shouldSpeak(false, 'x'.repeat(601)), false, 'long replies stay text');
process.env.SARA_TTS_REPLY = 'bogus';
assert.equal(ttsMode(), 'off');

assert.equal(voiceFor('es'), 'es-ES-ElviraNeural');
assert.equal(voiceFor('xx'), 'it-IT-ElsaNeural');
process.env.SARA_TTS_VOICE_IT = 'it-IT-IsabellaNeural';
assert.equal(voiceFor('it-IT'), 'it-IT-IsabellaNeural');
assert.equal(cleanForSpeech('**Ciao** 😀 vai su https://x.io/a ok'), 'Ciao vai su ok');

// fake edge-tts binary: writes "MP3DATA" to the --write-media path
const dir = mkdtempSync(join(tmpdir(), 'fake-tts-'));
const bin = join(dir, 'edge-tts');
writeFileSync(bin, '#!/bin/sh\nwhile [ $# -gt 0 ]; do [ "$1" = "--write-media" ] && out="$2"; shift; done\nprintf MP3DATA > "$out"\n');
chmodSync(bin, 0o755);
process.env.SARA_TTS_BIN = bin;
assert.equal((await synthesize('Ciao mondo', 'it'))?.toString(), 'MP3DATA');
assert.equal(await synthesize('😀 https://x.io', 'it'), null, 'nothing speakable');
process.env.SARA_TTS_BIN = join(dir, 'missing');
assert.equal(await synthesize('Ciao', 'it'), null, 'missing binary -> null -> text fallback');
console.log('tts tests passed');
process.exit(0);
