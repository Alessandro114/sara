// telegram-adapter.ts (issue #1). Run: npx tsx src/__tests__/telegram-adapter.test.ts
import assert from 'node:assert/strict';
import { _setFetch, isAllowed, sendTelegram, telegramEnabled, toBaileysMessage, wrapSockWithTelegram } from '../telegram-adapter.js';

process.env.TELEGRAM_BOT_TOKEN = 'TKN';
assert.equal(telegramEnabled(), true);

const calls: Array<{ url: string; body: any }> = [];
const ok = (result: unknown) => ({ ok: true, status: 200, json: async () => ({ ok: true, result }), arrayBuffer: async () => new TextEncoder().encode('BIN').buffer });
_setFetch((async (url: string, init?: any) => {
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body;
    calls.push({ url, body });
    if (url.endsWith('/getFile')) return ok({ file_path: 'voice/a.oga' });
    if (url.includes('/file/bot')) return ok(null);
    return ok(true);
}) as any);

const base = { message_id: 7, date: 1700000000, chat: { id: 42, type: 'private' }, from: { first_name: 'Anna', last_name: 'Rossi', is_bot: false } };

// text
const t = await toBaileysMessage({ ...base, text: 'ciao' });
assert.equal(t.key.remoteJid, 'tg:42');
assert.equal(t.message.conversation, 'ciao');
assert.equal(t.pushName, 'Anna Rossi');
// voice -> audioMessage with downloaded buffer
const v = await toBaileysMessage({ ...base, voice: { file_id: 'F1', mime_type: 'audio/ogg' } });
assert.equal(v.message.audioMessage.mimetype, 'audio/ogg');
assert.equal(v.message.audioMessage._buffer.toString(), 'BIN');
assert.ok(calls.some(c => c.url.includes('/file/botTKN/voice/a.oga')));
// photo takes the largest size, keeps caption
const p = await toBaileysMessage({ ...base, photo: [{ file_id: 'S' }, { file_id: 'L' }], caption: 'guarda' });
assert.equal(p.message.imageMessage.caption, 'guarda');
assert.equal(calls.filter(c => c.url.endsWith('/getFile')).at(-1)!.body.file_id, 'L');
// document + location
assert.equal((await toBaileysMessage({ ...base, document: { file_id: 'D', file_name: 'a.pdf', mime_type: 'application/pdf' } })).message.documentMessage.fileName, 'a.pdf');
assert.match((await toBaileysMessage({ ...base, location: { latitude: 1.5, longitude: 2.5 } })).message.conversation, /1\.5,2\.5/);
// ignored: bots, groups, empty
assert.equal(await toBaileysMessage({ ...base, from: { is_bot: true }, text: 'x' }), null);
assert.equal(await toBaileysMessage({ ...base, chat: { id: 1, type: 'group' }, text: 'x' }), null);
assert.equal(await toBaileysMessage({ ...base }), null);

// allowlist
delete process.env.TELEGRAM_ALLOWED_CHATS;
assert.equal(isAllowed(42), true);
process.env.TELEGRAM_ALLOWED_CHATS = '1, 42';
assert.equal(isAllowed(42), true);
assert.equal(isAllowed(99), false);
delete process.env.TELEGRAM_ALLOWED_CHATS;

// outbound: long text is split at 4096
calls.length = 0;
await sendTelegram('tg:42', { text: 'a'.repeat(5000) });
assert.deepEqual(calls.map(c => c.body.text.length), [4096, 904]);
assert.equal(calls[0].body.chat_id, '42');

// routing: tg: -> Telegram, others -> WhatsApp sock
const sent: any[] = [];
const wa: any = { isReady: true, ev: { on() {} }, sendMessage: async (j: string, c: any) => { sent.push([j, c]); }, sendPresenceUpdate: async () => {} };
const sock = wrapSockWithTelegram(wa);
calls.length = 0;
await sock.sendMessage('393331112222@c.us', { text: 'wa' });
assert.equal(sent.length, 1);
assert.equal(calls.length, 0);
await sock.sendMessage('tg:42', { text: 'tg' });
assert.equal(sent.length, 1);
assert.ok(calls[0].url.endsWith('/sendMessage'));
await sock.sendPresenceUpdate('composing', 'tg:42');
assert.equal(calls.at(-1)!.body.action, 'typing');
// polling: one update is delivered to handlers registered via ev.on, offset advances
let polls = 0;
_setFetch((async (url: string, init?: any) => {
    const body = JSON.parse(init.body);
    if (!url.endsWith('/getUpdates')) return ok(true);
    polls++;
    if (polls === 1) return ok([{ update_id: 10, message: { ...base, text: 'dal polling' } }]);
    assert.equal(body.offset, 11, 'offset moves past the delivered update');
    await new Promise(r => setTimeout(r, 30));
    return ok([]);
}) as any);
const got: any[] = [];
const pollSock = wrapSockWithTelegram(wa);
pollSock.ev.on('messages.upsert', (e: any) => got.push(e));
pollSock.startPolling();
await new Promise(r => setTimeout(r, 120));
pollSock.stopPolling();
assert.equal(got.length, 1);
assert.equal(got[0].messages[0].message.conversation, 'dal polling');
console.log('telegram-adapter tests passed');
process.exit(0);
