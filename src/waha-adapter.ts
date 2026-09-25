// waha-adapter.ts — WAHA (WhatsApp HTTP API) adapter for the single-tenant bot.
// Talks to a WAHA container over its REST API instead of driving a local
// Chromium instance directly (see wa-adapter.ts for that legacy engine).
// No browser lives in this process — WAHA owns the WhatsApp Web session.
import http from 'http';
import https from 'https';
import { writeFileSync } from 'fs';
import pino from 'pino';
import type { SockLike } from './wa-adapter.js';

export type { SockLike };

const log = pino({ name: 'wa-waha' });

const WAHA_URL = process.env.WAHA_API_URL || 'http://127.0.0.1:3004';
const WAHA_KEY = process.env.WAHA_API_KEY || '';
const WAHA_ENGINE = process.env.WAHA_ENGINE || 'GOWS';
const WEBHOOK_URL = process.env.WAHA_WEBHOOK_URL || 'http://127.0.0.1:3006/api/waha-webhook';
export const WAHA_SESSION_NAME = process.env.WAHA_SESSION_NAME || 'default';

async function wahaFetch(path: string, method = 'GET', body?: any): Promise<any> {
  const url = new URL(path, WAHA_URL);
  return new Promise((resolvePromise, reject) => {
    const mod = url.protocol === 'https:' ? https : http;
    const opts: http.RequestOptions = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: {
        'X-Api-Key': WAHA_KEY,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      timeout: 30000,
    };
    const req = mod.request(opts, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try { resolvePromise(JSON.parse(data)); }
        catch { resolvePromise(data); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('WAHA timeout')); });
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function wahaFetchBinary(fullUrl: string): Promise<Buffer | null> {
  return new Promise((resolvePromise) => {
    const url = new URL(fullUrl);
    const mod = url.protocol === 'https:' ? https : http;
    const req = mod.request({
      method: 'GET',
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: { 'X-Api-Key': WAHA_KEY },
      timeout: 20000,
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolvePromise(Buffer.concat(chunks)));
    });
    req.on('error', () => resolvePromise(null));
    req.on('timeout', () => { req.destroy(); resolvePromise(null); });
    req.end();
  });
}

async function wahaScreenshot(sessionName: string): Promise<Buffer | null> {
  const url = new URL(`/api/screenshot?session=${sessionName}`, WAHA_URL);
  return new Promise((resolvePromise) => {
    const mod = url.protocol === 'https:' ? https : http;
    const req = mod.request({
      method: 'GET', hostname: url.hostname, port: url.port,
      path: url.pathname + url.search,
      headers: { 'X-Api-Key': WAHA_KEY },
      timeout: 15000,
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolvePromise(Buffer.concat(chunks)));
    });
    req.on('error', () => resolvePromise(null));
    req.end();
  });
}

function mapStatus(wahaStatus: string): boolean {
  return wahaStatus === 'WORKING';
}

type Handler = (...args: any[]) => void;

// Module-level singleton: index.ts creates one bot via createWAHABot(), and
// the incoming /api/waha-webhook HTTP route (registered in a different file,
// sara-api.ts) calls handleWahaWebhookDefault() for this session. They share
// state through this module, the same pattern wa-adapter.ts uses for QR data
// on globalThis.
let connected = false;
const listeners: Record<string, Handler[]> = {};
const ev = {
  on(event: string, handler: Handler) {
    if (!listeners[event]) listeners[event] = [];
    listeners[event].push(handler);
  },
};

function emit(event: string, ...args: any[]) {
  for (const h of listeners[event] || []) {
    const jid = args?.[0]?.messages?.[0]?.key?.remoteJid;
    try {
      const r: any = h(...args);
      if (r && typeof r.then === 'function') {
        r.catch((err: any) => {
          log.error({ event, jid, err: err?.message || String(err), stack: err?.stack }, 'event handler rejected');
        });
      }
    } catch (err: any) {
      log.error({ event, jid, err: err?.message || String(err), stack: err?.stack }, 'event handler threw');
    }
  }
}

/**
 * Called by sara-api.ts's POST /api/waha-webhook route. This is the single
 * default bot session the open-source quickstart runs.
 */
export async function handleWahaWebhookDefault(payload: any): Promise<void> {
  if (payload?.event === 'session.status') {
    const wasConnected = connected;
    connected = mapStatus(payload.payload?.status || '');
    if (connected && !wasConnected) log.info('WhatsApp connection OPEN (WAHA)');
    if (!connected && wasConnected) log.warn({ status: payload.payload?.status }, 'WAHA session no longer WORKING');
    return;
  }

  if (payload?.event !== 'message') return;
  const msg = payload.payload;
  if (!msg || msg.fromMe) return;

  const baileysMsg: any = {
    key: { remoteJid: msg.from, fromMe: false, id: msg.id || String(Date.now()) },
    message: {} as any,
    messageTimestamp: msg.timestamp || Math.floor(Date.now() / 1000),
  };

  if (msg.hasMedia && msg.media?.url) {
    try {
      const buf = await wahaFetchBinary(msg.media.url);
      if (buf) {
        const mimetype = msg.media.mimetype || 'application/octet-stream';
        if (mimetype.startsWith('audio/'))
          baileysMsg.message.audioMessage = { url: '', mimetype, _buffer: buf };
        else if (mimetype.startsWith('image/'))
          baileysMsg.message.imageMessage = { url: '', mimetype, caption: msg.body || '', _buffer: buf };
        else
          baileysMsg.message.documentMessage = { url: '', mimetype, fileName: msg.media.filename || msg.body || 'doc', _buffer: buf };
      }
    } catch (e: any) {
      log.error({ err: e?.message }, 'media download failed');
    }
  }
  if (msg.body) {
    baileysMsg.message.conversation = msg.body;
    baileysMsg.message.extendedTextMessage = { text: msg.body };
  }

  emit('messages.upsert', { messages: [baileysMsg], type: 'notify' });
}

async function ensureSessionStarted(): Promise<void> {
  const info = await wahaFetch('/api/sessions').catch(() => null);
  const existing = Array.isArray(info) ? info.find((s: any) => s.name === WAHA_SESSION_NAME) : null;

  if (existing && mapStatus(existing.status)) {
    connected = true;
    log.info({ session: WAHA_SESSION_NAME }, 'WAHA session already connected');
    return;
  }

  if (!existing || existing.status === 'STOPPED' || existing.status === 'FAILED') {
    log.info({ session: WAHA_SESSION_NAME, engine: WAHA_ENGINE }, 'starting WAHA session');
    await wahaFetch('/api/sessions/start', 'POST', {
      name: WAHA_SESSION_NAME,
      config: {
        engine: WAHA_ENGINE,
        webhooks: [{
          url: WEBHOOK_URL,
          events: ['message', 'session.status'],
          // Lets sara-api.ts's /api/waha-webhook verify the call actually
          // came from our WAHA instance instead of accepting unauthenticated
          // POSTs from anyone who can reach the port.
          customHeaders: [{ name: 'X-Sara-Webhook-Secret', value: WAHA_KEY }],
        }],
      },
    }).catch((e: any) => log.error({ err: e?.message }, 'WAHA session start failed — is the WAHA container reachable?'));
  }
}

export async function createWAHABot(): Promise<{ sock: SockLike; waitForConnection: () => Promise<void> }> {
  log.info({ url: WAHA_URL, session: WAHA_SESSION_NAME, engine: WAHA_ENGINE }, 'connecting to WAHA...');
  await ensureSessionStarted();

  // Poll a few times for QR / early status — most of the wait happens async
  // via the session.status webhook, this just gives the operator immediate
  // feedback instead of a silent terminal.
  for (let i = 0; i < 5 && !connected; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const info = await wahaFetch('/api/sessions').catch(() => null);
    const s = Array.isArray(info) ? info.find((x: any) => x.name === WAHA_SESSION_NAME) : null;
    if (s && mapStatus(s.status)) { connected = true; break; }
    if (s?.status === 'SCAN_QR_CODE') {
      const png = await wahaScreenshot(WAHA_SESSION_NAME);
      if (png && png.length > 500) {
        try {
          writeFileSync('qr_code.png', png);
          log.info('QR CODE saved to qr_code.png — scan it, or open the WAHA dashboard to view it live');
        } catch (e: any) {
          log.warn({ err: e?.message }, 'could not write qr_code.png');
        }
      }
      log.info({ dashboard: `${WAHA_URL}/dashboard` }, 'waiting for QR scan — WAHA dashboard also shows it live');
    }
  }

  const sock: SockLike = {
    get isReady() { return connected; },
    ev,
    async sendMessage(jid: string, content: any) {
      try {
        if (content.text) {
          await wahaFetch('/api/sendText', 'POST', { session: WAHA_SESSION_NAME, chatId: jid, text: content.text });
        } else if (content.image) {
          await wahaFetch('/api/sendImage', 'POST', {
            session: WAHA_SESSION_NAME,
            chatId: jid,
            file: { url: content.image.url, mimetype: 'image/jpeg', filename: 'image.jpg' },
            caption: content.caption || '',
          });
        } else if (content.document) {
          await wahaFetch('/api/sendFile', 'POST', {
            session: WAHA_SESSION_NAME,
            chatId: jid,
            file: { url: content.document.path, mimetype: 'application/octet-stream', filename: content.document.filename || 'document' },
            caption: content.document.caption || '',
          });
        }
      } catch (e: any) {
        log.error({ err: e?.message, jid }, 'send error');
      }
    },
    async sendPresenceUpdate(type: string, jid: string) {
      try {
        const endpoint = type === 'composing' ? '/api/startTyping' : '/api/stopTyping';
        await wahaFetch(endpoint, 'POST', { session: WAHA_SESSION_NAME, chatId: jid });
      } catch (e: any) {
        log.debug({ jid, type, err: e?.message || String(e) }, 'presence update failed');
      }
    },
  };

  const waitForConnection = () => new Promise<void>((resolveWait) => {
    if (connected) { resolveWait(); return; }
    const interval = setInterval(() => {
      if (connected) { clearInterval(interval); resolveWait(); }
    }, 2000);
    setTimeout(() => {
      clearInterval(interval);
      log.info('API bridge running — WhatsApp will connect once the QR is scanned');
      resolveWait();
    }, 60000).unref();
  });

  return { sock, waitForConnection };
}
