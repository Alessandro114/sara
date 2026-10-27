// ═══════════════════════════════════════════════════════════
// Telegram channel (issue #1) — Bot API over long polling, no extra dependency.
//
//   TELEGRAM_BOT_TOKEN     enables the channel (from @BotFather)
//   TELEGRAM_ALLOWED_CHATS optional comma list of chat ids; empty = anyone who messages the bot
//
// Telegram chats become jid "tg:<chat_id>" and are mapped to the same Baileys-shaped message the
// WhatsApp adapters produce, so every handler (text, voice, image, document) works unchanged.
// Replies to "tg:" jids are routed here by wrapSockWithTelegram(); everything else goes to WhatsApp.
// ═══════════════════════════════════════════════════════════
import pino from 'pino';
import type { SockLike } from './wa-adapter.js';

const log = pino({ name: 'telegram' });
const API = 'https://api.telegram.org';
export const TG_PREFIX = 'tg:';
const MAX_TEXT = 4096;

export const telegramEnabled = () => !!process.env.TELEGRAM_BOT_TOKEN;

type Fetch = typeof fetch;
let fetchImpl: Fetch = (...a) => fetch(...a);
/** Test seam. */
export function _setFetch(f: Fetch): void { fetchImpl = f; }

async function tg(method: string, body?: Record<string, unknown>): Promise<any> {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const res = await fetchImpl(`${API}/bot${token}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body ?? {}),
    });
    const json: any = await res.json();
    if (!json.ok) throw new Error(`telegram ${method}: ${json.description || res.status}`);
    return json.result;
}

async function download(fileId: string): Promise<Buffer | null> {
    try {
        const f = await tg('getFile', { file_id: fileId });
        const res = await fetchImpl(`${API}/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${f.file_path}`);
        return res.ok ? Buffer.from(await res.arrayBuffer()) : null;
    } catch (err: any) {
        log.warn({ err: err?.message }, 'file download failed');
        return null;
    }
}

export function isAllowed(chatId: number | string): boolean {
    const list = (process.env.TELEGRAM_ALLOWED_CHATS || '').split(',').map(s => s.trim()).filter(Boolean);
    return list.length === 0 || list.includes(String(chatId));
}

/** Telegram message -> Baileys-shaped message (null if unsupported or from a bot/non-private chat). */
export async function toBaileysMessage(m: any): Promise<any | null> {
    if (!m?.chat || m.from?.is_bot || m.chat.type !== 'private') return null;
    const out: any = {
        key: { remoteJid: `${TG_PREFIX}${m.chat.id}`, fromMe: false, id: String(m.message_id) },
        pushName: [m.from?.first_name, m.from?.last_name].filter(Boolean).join(' ') || m.from?.username,
        message: {} as any,
        messageTimestamp: m.date,
    };
    const text: string | undefined = m.text ?? m.caption;
    if (m.voice || m.audio) {
        const a = m.voice || m.audio;
        const buf = await download(a.file_id);
        if (!buf) return null;
        out.message.audioMessage = { url: '', mimetype: a.mime_type || 'audio/ogg', _buffer: buf };
    } else if (m.photo?.length) {
        const buf = await download(m.photo[m.photo.length - 1].file_id);
        if (!buf) return null;
        out.message.imageMessage = { url: '', mimetype: 'image/jpeg', caption: text || '', _buffer: buf };
    } else if (m.document) {
        const buf = await download(m.document.file_id);
        if (!buf) return null;
        out.message.documentMessage = { url: '', mimetype: m.document.mime_type || 'application/octet-stream', fileName: m.document.file_name || 'doc', _buffer: buf };
    } else if (m.location) {
        const t = `[posizione] ${m.location.latitude},${m.location.longitude}`;
        out.message.conversation = t;
        out.message.extendedTextMessage = { text: t };
    } else if (text) {
        out.message.conversation = text;
        out.message.extendedTextMessage = { text };
    } else {
        return null;
    }
    return out;
}

function chunk(text: string): string[] {
    const parts: string[] = [];
    for (let i = 0; i < text.length; i += MAX_TEXT) parts.push(text.slice(i, i + MAX_TEXT));
    return parts.length ? parts : [''];
}

export async function sendTelegram(jid: string, content: any): Promise<void> {
    const chat_id = jid.slice(TG_PREFIX.length);
    if (content.text) {
        for (const part of chunk(String(content.text))) await tg('sendMessage', { chat_id, text: part });
    } else if (content.image?.url) {
        await tg('sendPhoto', { chat_id, photo: content.image.url, caption: content.caption || undefined });
    } else if (content.document?.path) {
        await tg('sendDocument', { chat_id, document: content.document.path, caption: content.document.caption || undefined });
    } else if (content.voice) {
        const form = new FormData();
        form.append('chat_id', chat_id);
        form.append('voice', new Blob([content.voice.data], { type: content.voice.mimetype || 'audio/mpeg' }), 'reply.mp3');
        const res = await fetchImpl(`${API}/bot${process.env.TELEGRAM_BOT_TOKEN}/sendVoice`, { method: 'POST', body: form });
        const json: any = await res.json();
        if (!json.ok) throw new Error(`telegram sendVoice: ${json.description}`);
    }
}

type Handler = (...args: any[]) => void;

/**
 * Returns a SockLike that behaves like `wa` for WhatsApp jids and talks to Telegram for "tg:" jids.
 * Handlers registered on `ev` receive messages from both channels. Polling starts with startPolling().
 */
export function wrapSockWithTelegram(wa: SockLike): SockLike & { startPolling(): void; stopPolling(): void } {
    const handlers: Handler[] = [];
    let running = false;
    let offset = 0;
    const emit = (msg: any) => {
        for (const h of handlers) {
            try { const r: any = h({ messages: [msg], type: 'notify' }); r?.catch?.((e: any) => log.error({ err: e?.message }, 'handler rejected')); }
            catch (e: any) { log.error({ err: e?.message }, 'handler threw'); }
        }
    };

    async function loop(): Promise<void> {
        while (running) {
            try {
                const updates: any[] = await tg('getUpdates', { offset, timeout: 25, allowed_updates: ['message'] });
                for (const u of updates) {
                    offset = u.update_id + 1;
                    if (!u.message || !isAllowed(u.message.chat?.id)) continue;
                    const msg = await toBaileysMessage(u.message);
                    if (msg) emit(msg);
                }
            } catch (err: any) {
                log.warn({ err: err?.message }, 'getUpdates failed, retrying in 5s');
                await new Promise(r => setTimeout(r, 5000));
            }
        }
    }

    return {
        get isReady() { return wa.isReady; },
        ev: {
            on(event, handler) {
                wa.ev.on(event, handler);
                if (event === 'messages.upsert') handlers.push(handler);
            },
        },
        async sendMessage(jid, content) {
            return jid.startsWith(TG_PREFIX) ? sendTelegram(jid, content) : wa.sendMessage(jid, content);
        },
        async sendPresenceUpdate(type, jid) {
            if (!jid.startsWith(TG_PREFIX)) return wa.sendPresenceUpdate(type, jid);
            if (type === 'composing') await tg('sendChatAction', { chat_id: jid.slice(TG_PREFIX.length), action: 'typing' }).catch(() => {});
        },
        startPolling() {
            if (running) return;
            running = true;
            log.info('Telegram polling started');
            void loop();
        },
        stopPolling() { running = false; },
    };
}
