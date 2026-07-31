// wa-adapter.ts — whatsapp-web.js 1.34.6 adapter (production-hardened)
// Uses real Chromium browser — identical protocol fingerprint to real WA Web client.
// Session persists via LocalAuth on disk. Auto-reconnects on disconnect.
import pkg from 'whatsapp-web.js';
const { Client, LocalAuth, MessageMedia } = pkg;
import qrcode from 'qrcode-terminal';
import { writeFileSync, existsSync, unlinkSync, lstatSync, rmSync } from 'fs';
import { resolve } from 'path';
import pino from 'pino';

const log = pino({ name: 'wa-wwebjs' });

export interface SockLike {
  /** True only once the client has emitted 'ready' (i.e. paired AND connected).
   *  Consumers (followup scheduler, outreach) MUST check this before pushing messages:
   *  the process can be up while the client is unpaired, and whatsapp-web.js then throws
   *  from inside puppeteer ("Cannot read properties of null"). */
  readonly isReady: boolean;
  ev: { on(event: string, handler: (...args: any[]) => void): void };
  sendMessage(jid: string, content: any): Promise<any>;
  sendPresenceUpdate(type: string, jid: string): Promise<void>;
}

export async function createWWJSBot(): Promise<{ sock: SockLike; waitForConnection: () => Promise<void> }> {
  let client: any;
  let connected = false;
  let reconnectAttempts = 0;
  const MAX_RECONNECT = 50; // very high — we NEVER want to stop trying

  type Handler = (...args: any[]) => void;
  const listeners: Record<string, Handler[]> = {};
  const ev = {
    on(event: string, handler: Handler) {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(handler);
    },
  };
  // Handlers are registered as `async` (see index.ts), so a throw inside one becomes a
  // rejected promise. Without this guard the rejection escaped to the global
  // 'unhandledRejection' net below and was downgraded to a single log.warn with no JID —
  // i.e. an inbound message could vanish (no reply, no retry, no error log). Catch both
  // the synchronous throw and the async rejection, and log at error level WITH context.
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

  function clearStaleLocks() {
    const sessionDir = resolve('./auth_store_wwjs/session-sara-business');
    for (const lockFile of ['SingletonLock', 'SingletonSocket', 'SingletonCookie']) {
      const p = resolve(sessionDir, lockFile);
      try {
        const stat = lstatSync(p);
        if (stat.isSymbolicLink() || stat.isFile()) {
          unlinkSync(p);
          log.warn({ file: lockFile }, 'removed stale Chromium lock file');
        }
      } catch { /* ENOENT = file doesn't exist, that's fine */ }
    }
  }

  function createClient() {
    clearStaleLocks();
    return new Client({
      authStrategy: new LocalAuth({ clientId: 'sara-business', dataPath: './auth_store_wwjs' }),
      authTimeoutMs: 0,
      puppeteer: {
        headless: true,
        executablePath: process.env.CHROME_PATH || '/usr/bin/chromium-browser',
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--disable-extensions',
          '--disable-blink-features=AutomationControlled',
          '--no-first-run',
          '--no-default-browser-check',
          '--disable-background-networking',
          '--disable-sync',
          '--metrics-recording-only',
          '--disable-default-apps',
        ],
      },
    } as any);
  }

  function wireClient(c: any) {
    c.on('message', async (msg: any) => {
      if (msg.fromMe) return;
      const jid = msg.from;

      let realPhone: string | undefined;
      try {
        const contact = await msg.getContact();
        realPhone = contact.number || undefined;
      } catch (e: any) { log.debug({ jid, err: e?.message || String(e) }, 'contact/LID resolution failed — continuing without real phone'); }

      const baileysMsg: any = {
        key: { remoteJid: jid, fromMe: false, id: msg.id?._serialized || String(Date.now()) },
        message: {} as any,
        messageTimestamp: Math.floor(msg.timestamp || Date.now() / 1000),
        _realPhone: realPhone,
      };

      if (msg.hasMedia) {
        try {
          const media = await msg.downloadMedia();
          if (media) {
            const buf = Buffer.from(media.data, 'base64');
            if (msg.type === 'audio' || msg.type === 'ptt')
              baileysMsg.message.audioMessage = { url: '', mimetype: media.mimetype, _buffer: buf };
            else if (msg.type === 'image')
              baileysMsg.message.imageMessage = { url: '', mimetype: media.mimetype, caption: msg.body || '', _buffer: buf };
            else if (msg.type === 'document')
              baileysMsg.message.documentMessage = { url: '', mimetype: media.mimetype, fileName: msg.body || 'doc', _buffer: buf };
          }
        } catch (e: any) { log.error({ err: e?.message }, 'media download failed'); }
      }
      if (msg.body) {
        baileysMsg.message.conversation = msg.body;
        baileysMsg.message.extendedTextMessage = { text: msg.body };
      }
      emit('messages.upsert', { messages: [baileysMsg], type: 'notify' });
    });

    let pairingRequested = false;
    c.on('qr', async (qr: string) => {
      try { writeFileSync('qr_code.txt', qr); }
      catch (e: any) { log.error({ err: e?.message || String(e) }, 'failed to write qr_code.txt — QR only available in logs'); }
      (globalThis as any).__SARA_LAST_QR = qr;
      log.info('QR CODE generated — scan with WhatsApp');
      qrcode.generate(qr, { small: true });
      // Pairing-code alternative (often works when QR scanning fails): if SARA_PAIR_PHONE
      // is set (digits only, country code incl., e.g. 39333...), request an 8-char code to
      // type in WhatsApp → Linked devices → Link with phone number instead. Request once.
      const pairPhone = (process.env.SARA_PAIR_PHONE || '').replace(/[^0-9]/g, '');
      if (pairPhone && !pairingRequested) {
        pairingRequested = true;
        try {
          const code: string = await (c as any).requestPairingCode(pairPhone);
          try { writeFileSync('pairing_code.txt', String(code)); }
          catch (e: any) { log.error({ err: e?.message || String(e) }, 'failed to write pairing_code.txt — code only available in logs'); }
          (globalThis as any).__SARA_PAIR_CODE = code;
          log.info(`PAIRING CODE for +${pairPhone}: ${code} — WhatsApp > Dispositivi collegati > Collega con numero di telefono`);
        } catch (e: any) {
          pairingRequested = false;
          log.warn({ err: e?.message || String(e) }, 'requestPairingCode failed');
        }
      }
    });

    c.on('ready', () => {
      connected = true;
      reconnectAttempts = 0;
      totalReconnects = 0;
      reconnectInFlight = false;
      log.info('WhatsApp connection OPEN (whatsapp-web.js)');
      // Flush any messages queued while disconnected
      if (pendingMessages.length > 0) {
        log.info({ queued: pendingMessages.length }, 'flushing pending messages after reconnect');
        flushPendingMessages().catch((e: any) => log.error({ err: e?.message || String(e) }, 'flushing pending messages failed'));
      }
    });

    c.on('authenticated', () => {
      log.info('Session authenticated — creds saved to disk');
    });

    c.on('auth_failure', (msg: any) => {
      log.error({ msg }, 'AUTH FAILURE — session invalid, clearing session for fresh QR');
      connected = false;
      // Wipe corrupted session so next restart gets a clean QR.
      // NOTE: this used to call require('fs') — this is an ESM module ("type": "module"),
      // so `require` is undefined and the very first line threw a ReferenceError that the
      // empty catch swallowed: the wipe silently did NOTHING and the bot went into a QR
      // loop instead of a clean re-pair. Use the statically imported rmSync, and log.
      try {
        rmSync(resolve('./auth_store_wwjs/session-sara-business'), { recursive: true, force: true });
        log.warn('session directory wiped — restart will show fresh QR');
      } catch (e: any) {
        log.error({ err: e?.message || String(e) }, 'session wipe FAILED — next restart may loop on QR');
      }
      scheduleReconnect();
    });

    c.on('disconnected', (reason: string) => {
      connected = false;
      log.warn({ reason }, 'disconnected from WhatsApp');

      if (reason === 'LOGOUT') {
        log.error('User logged out — need new QR scan');
        return; // Don't auto-reconnect on explicit logout
      }

      // Auto-reconnect for all other disconnects
      scheduleReconnect();
    });

    // Handle Chromium crashes
    c.on('change_state', (state: string) => {
      log.info({ state }, 'connection state changed');
      if (state === 'CONFLICT' || state === 'UNLAUNCHED' || state === 'UNPAIRED') {
        connected = false;
        scheduleReconnect();
      }
    });
  }

  const MAX_ABSOLUTE_RECONNECT = 200;
  let totalReconnects = 0;

  // Concurrency guard. Several events can demand a reconnect at the same instant — a
  // Chromium crash raises BOTH 'disconnected' and 'change_state' (CONFLICT/UNPAIRED), and
  // the watchdog can pile on. Each call used to arm its own setTimeout, so two callbacks
  // ran destroy() + createClient() concurrently: only the last assignment to `client`
  // survived and the previous Chromium was left orphaned, leaking ~300-500MB. That is the
  // most likely mechanism behind the recurring OOM → QR re-pair.
  // The flag is ALWAYS released in the finally below: a stuck flag would permanently
  // disable reconnection, which is worse than the leak it prevents.
  let reconnectInFlight = false;

  function scheduleReconnect() {
    if (reconnectInFlight) {
      log.warn({ total: totalReconnects }, 'reconnect already in flight — ignoring duplicate request');
      return;
    }
    totalReconnects++;
    if (totalReconnects >= MAX_ABSOLUTE_RECONNECT) {
      log.error({ total: totalReconnects }, 'absolute reconnect limit reached — possible ban or permanent failure, stopping');
      return;
    }
    if (reconnectAttempts >= MAX_RECONNECT) {
      log.warn({ attempts: reconnectAttempts, total: totalReconnects }, 'max reconnect cycle reached — backing off 5min before reset');
      reconnectAttempts = 0;
    }

    const delay = Math.min(3000 * Math.pow(1.5, reconnectAttempts), 300000);
    reconnectAttempts++;
    reconnectInFlight = true;
    log.info({ attempt: reconnectAttempts, total: totalReconnects, delayMs: delay }, 'scheduling reconnect');

    setTimeout(async () => {
      let retry = false;
      try {
        log.info('destroying old client...');
        try { await client.destroy(); }
        catch (e: any) { log.warn({ err: e?.message || String(e) }, 'destroying old client failed — continuing (Chromium may be orphaned)'); }
        log.info('creating new client...');
        client = createClient();
        wireClient(client);
        await client.initialize();
      } catch (e: any) {
        log.error({ err: e?.message }, 'reconnect failed — retrying');
        retry = true;
      } finally {
        // Release BEFORE the retry below, otherwise the recursive call would see the flag
        // still set, bail out as a "duplicate", and the reconnect loop would die silently.
        reconnectInFlight = false;
      }
      if (retry) scheduleReconnect();
    }, delay);
  }

  // Heartbeat: send presence every 30s to keep session alive
  setInterval(() => {
    if (connected && client) {
      try {
        client.sendPresenceAvailable();
      } catch (e: any) { log.debug({ err: e?.message || String(e) }, 'heartbeat sendPresenceAvailable failed'); }
    }
  }, 30_000).unref();

  // Watchdog: every 5 minutes verify WA is truly connected
  // Only acts if we WERE connected and lost it — never triggers during initial QR wait
  setInterval(async () => {
    if (!connected) return; // Don't interfere with QR scanning phase
    try {
      const state = await client.getState();
      if (state !== 'CONNECTED') {
        log.warn({ state }, 'watchdog: WA state lost, reconnecting');
        connected = false;
        scheduleReconnect();
      }
    } catch (e: any) {
      log.warn({ err: e?.message }, 'watchdog: getState failed, reconnecting');
      connected = false;
      scheduleReconnect();
    }
  }, 300_000).unref();

  // Graceful shutdown — flush session to disk but DO NOT call client.destroy()
  // destroy() triggers a WA logout signal, invalidating the session permanently.
  // Instead: flush data, exit node, let systemd SIGKILL Chromium (no logout sent).
  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info('graceful shutdown — closing browser to flush session to disk');
    try {
      // Gracefully CLOSE Chromium. browser.close() flushes IndexedDB (where the
      // WA multi-device session lives) to disk and does NOT send a logout —
      // logout is only sent by client.logout() (which also deletes the profile).
      // The old code did a no-op page.evaluate + let systemd SIGKILL Chromium,
      // which truncated the IndexedDB write → session lost → QR re-pair on every
      // restart. LocalAuth has no destroy() override, so this preserves the session.
      const browser = client?.pupBrowser;
      if (browser?.isConnected?.()) {
        await Promise.race([
          browser.close(),
          new Promise(r => setTimeout(r, 12000)),
        ]);
      }
    } catch (e: any) {
      log.warn({ err: e?.message }, 'shutdown: browser close failed');
    }
    log.info('shutdown complete — browser closed cleanly (session preserved)');
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  const pendingMessages: Array<{ jid: string; content: any }> = [];
  const MAX_PENDING = 100;

  async function flushPendingMessages() {
    while (pendingMessages.length > 0 && connected) {
      const msg = pendingMessages.shift()!;
      try {
        if (msg.content.text) await client.sendMessage(msg.jid, msg.content.text);
        else if (msg.content.image) {
          const media = await MessageMedia.fromUrl(msg.content.image.url);
          await client.sendMessage(msg.jid, media, { caption: msg.content.caption || '' });
        } else if (msg.content.document) {
          const media = MessageMedia.fromFilePath(msg.content.document.path);
          await client.sendMessage(msg.jid, media, { sendMediaAsDocument: true, caption: msg.content.document.caption || '' });
        }
      } catch (e: any) { log.warn({ err: e?.message, jid: msg.jid }, 'flush pending message failed'); }
    }
  }

  // NOTE: connection.update is a Baileys event, never emitted by wwebjs adapter.
  // Pending message flush is handled in the client 'ready' handler above.

  const sock: SockLike = {
    // Getter, not a snapshot: `connected` is reassigned on every ready/disconnect.
    get isReady() { return connected; },
    ev,
    async sendMessage(jid: string, content: any) {
      if (!connected) {
        if (pendingMessages.length < MAX_PENDING) {
          pendingMessages.push({ jid, content });
          log.info({ jid, queued: pendingMessages.length }, 'message queued (disconnected)');
        } else {
          log.warn({ jid }, 'message dropped — pending queue full');
        }
        return;
      }
      try {
        if (content.text) await client.sendMessage(jid, content.text);
        else if (content.image) {
          const media = await MessageMedia.fromUrl(content.image.url);
          await client.sendMessage(jid, media, { caption: content.caption || '' });
        } else if (content.document) {
          const media = MessageMedia.fromFilePath(content.document.path);
          await client.sendMessage(jid, media, { sendMediaAsDocument: true, caption: content.document.caption || '' });
        }
      } catch (e: any) { log.error({ err: e?.message }, 'send error'); }
    },
    async sendPresenceUpdate(type: string, jid: string) {
      if (!connected) return;
      try {
        const chat = await client.getChatById(jid);
        if (type === 'composing') await chat.sendStateTyping();
        else await chat.clearState();
      } catch (e: any) { log.debug({ jid, type, err: e?.message || String(e) }, 'presence update failed'); }
    },
  };

  // Global safety net — never crash on unhandled rejection (e.g. auth timeout)
  process.on('unhandledRejection', (reason: any) => {
    log.warn({ reason: String(reason) }, 'unhandled rejection caught — not crashing');
  });
  process.on('uncaughtException', (err: any) => {
    log.error({ err: err?.message || String(err) }, 'uncaught exception caught — not crashing');
  });

  // Initial boot with retry — don't destroy client on first failure (preserves session)
  log.info('starting whatsapp-web.js (Chromium browser engine)...');
  client = createClient();
  wireClient(client);

  const initWithRetry = async (attempt = 1) => {
    try {
      await client.initialize();
    } catch (err: any) {
      log.warn({ err: err?.message || String(err), attempt }, 'client.initialize() failed');
      if (attempt < 3) {
        const delay = 5000 * attempt;
        log.info({ attempt: attempt + 1, delayMs: delay }, 'retrying initialize with fresh client (preserving session store)');
        await new Promise(r => setTimeout(r, delay));
        try { await client.destroy(); }
        catch (e: any) { log.warn({ err: e?.message || String(e) }, 'destroy before retry failed — continuing (Chromium may be orphaned)'); }
        client = createClient();
        wireClient(client);
        return initWithRetry(attempt + 1);
      }
      log.error('all initialize attempts failed — falling back to reconnect loop');
      scheduleReconnect();
    }
  };
  initWithRetry();

  const waitForConnection = () => new Promise<void>((resolve) => {
    if (connected) { resolve(); return; }
    const checkReady = () => {
      client.on('ready', () => resolve());
    };
    checkReady();
    // Don't block server startup — resolve after 60s even without connection
    setTimeout(() => {
      log.info('API bridge running — WhatsApp will connect when QR scanned or session restored');
      resolve();
    }, 60000);
  });

  return { sock, waitForConnection };
}

// Media download helper
export async function downloadMediaWWJS(msg: any): Promise<Buffer | null> {
  const mediaMsg = msg.message?.audioMessage || msg.message?.imageMessage || msg.message?.documentMessage || msg.message?.videoMessage;
  if (mediaMsg?._buffer) return mediaMsg._buffer;
  return null;
}
