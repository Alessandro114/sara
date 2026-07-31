// wa-hardened-adapter.ts — Baileys 7.x QR-only adapter with anti-detection hardening
//
// Drop-in replacement for wa-adapter.ts. Keeps the SockLike contract so
// src/index.ts can swap imports without any other changes.
//
// This file is intentionally self-contained and does NOT touch the wwebjs
// auth store or cache directories. It creates its own:
//   auth_store_baileys_hardened/   — Baileys multi-file auth state
//   .session_fingerprint.json      — persistent browser fingerprint
//   .reconnect_state.json          — persistent backoff counter
//   .wa_paused                     — dead-man flag (manually cleared)
//   .wa_dead_man_log.txt           — human audit trail
//
// See README_HARDENED.md for the full feature walkthrough.

import {
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  downloadMediaMessage,
  type WASocket,
  type ConnectionState,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import qrcode from 'qrcode-terminal';
import { writeFileSync, mkdirSync, existsSync, rmSync } from 'fs';
import { resolve } from 'path';

// ─── Pairing code persistence (shared with sara-api.ts HTTP endpoint) ─────────
const PAIRING_CODE_FILE = resolve(process.cwd(), 'auth_store_baileys_hardened', '.pairing_code.json');

function writePairingCode(code: string, phone: string): void {
  try {
    mkdirSync(resolve(process.cwd(), 'auth_store_baileys_hardened'), { recursive: true });
    writeFileSync(PAIRING_CODE_FILE, JSON.stringify({
      code,
      issuedAt: Date.now(),
      phone,
      connected: false,
    }), 'utf8');
  } catch { /* non-fatal */ }
}

function clearPairingCode(): void {
  try {
    writeFileSync(PAIRING_CODE_FILE, JSON.stringify({
      code: null,
      issuedAt: null,
      phone: (process.env.BOT_PHONE || '').replace(/\D/g, ''),
      connected: true,
    }), 'utf8');
  } catch { /* non-fatal */ }
}

import { getOrCreateFingerprint, rotateFingerprint, type Fingerprint } from './wa-hardening/fingerprints.js';
import {
  computeTypingDelayMs,
  randomPresenceIntervalMs,
  randomReadReceiptDelayMs,
  sleep,
  OutboundRateLimiter,
} from './wa-hardening/human-delays.js';
import { nextBackoff, resetBackoff } from './wa-hardening/reconnect-backoff.js';
import {
  isPaused,
  recordHandshakeFailure,
  recordSuccessfulHandshake,
  tripDeadMan,
} from './wa-hardening/dead-man-switch.js';
import { buildPinoLogger, redactJid, bodyStats } from './wa-hardening/pii-redaction.js';

// ─── Public SockLike contract (mirrors wa-adapter.ts) ───────────────────────
export interface SockLike {
  ev: { on(event: string, handler: (...args: any[]) => void): void };
  sendMessage(jid: string, content: any): Promise<any>;
  sendPresenceUpdate(type: string, jid: string): Promise<void>;
}

const AUTH_DIR = resolve(process.cwd(), 'auth_store_baileys_hardened');
const QR_FILE = resolve(process.cwd(), 'qr_code.txt');

const log = buildPinoLogger('wa-hardened');

// Module-level socket reference for downloadMediaWWJS (set when socket is created)
let _activeSocket: WASocket | null = null;

// ─── Main factory ───────────────────────────────────────────────────────────
export async function createWWJSBot(): Promise<{
  sock: SockLike;
  waitForConnection: () => Promise<void>;
}> {
  // ─── Dead-man check before anything else ───
  if (false && isPaused()) { // DISABLED: dead-man must never stop the bot
    log.warn('dead-man flag present — ignoring, bot must stay alive');
    // Return a stub so the caller's API bridge keeps running even though WA is paused.
    return buildStubSock('paused');
  }

  mkdirSync(AUTH_DIR, { recursive: true });

  // ─── External event bridge (we forward Baileys events into this) ───
  type Handler = (...args: any[]) => void;
  const listeners: Record<string, Handler[]> = {};
  const ev = {
    on(event: string, handler: Handler) {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(handler);
    },
  };
  function emit(event: string, ...args: any[]): void {
    (listeners[event] || []).forEach(h => {
      try {
        h(...args);
      } catch (e: any) {
        log.error({ err: e?.message }, 'listener threw');
      }
    });
  }

  let currentSocket: WASocket | null = null;
  let connected = false;
  let waitResolvers: Array<() => void> = [];
  let _heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  const rateLimiter = new OutboundRateLimiter(15);

  // ─── LID → phone JID mapping (Baileys 7.x LID support) ───
  // When contacts send messages their remoteJid may be a LID (@lid suffix).
  // We maintain a runtime map so we can resolve LID → real phone JID for
  // sending. Populated via contacts.upsert events.
  const lidToPhoneMap = new Map<string, string>();

  // ─── Session fingerprint (persistent) ───
  let fingerprint: Fingerprint = getOrCreateFingerprint(false);
  log.info({ device: fingerprint[0], browser: fingerprint[1], version: fingerprint[2] }, 'using session fingerprint');

  // ─── Connection bootstrap with retry/backoff driven by connection.update ───
  // P0 fix 2026-04-12: boot-lock against concurrent boot() calls (was a bug —
  // connection.update handler + initial call could race → double socket)
  let lastPairingCodeAt = 0; // timestamp of last requestPairingCode call
  let pairingInProgress = false; // true after requestPairingCode, false after OPEN or full wipe
  let booting = false;
  let loggedOut401Count = 0; // Track consecutive 401s — only wipe after 4+
  async function boot(): Promise<void> {
    if (booting) {
      log.warn('boot() already in progress — skipping duplicate call');
      return;
    }
    booting = true;
    try {
      await _bootInternal();
    } finally {
      booting = false;
    }
  }

  async function _bootInternal(): Promise<void> {
    // dead-man check DISABLED — bot must ALWAYS restart
    // isPaused() check removed to prevent session death

    let authState: Awaited<ReturnType<typeof useMultiFileAuthState>>;
    try {
      authState = await useMultiFileAuthState(AUTH_DIR);
    } catch (e: any) {
      log.error({ err: e?.message }, 'auth state corrupted — wiping and re-pairing');
      try {
        rmSync(AUTH_DIR, { recursive: true, force: true });
        mkdirSync(AUTH_DIR, { recursive: true });
      } catch {
        /* non-fatal */
      }
      authState = await useMultiFileAuthState(AUTH_DIR);
      fingerprint = rotateFingerprint();
    }

    const { state, saveCreds } = authState;

    // P0 fix 2026-04-12: robust fallback when fetchLatestBaileysVersion returns
    // malformed result (network blip, HTML error page, etc.) — was a crash cause.
    let version: [number, number, number] = [2, 3000, 1015901307];
    try {
      const res = await fetchLatestBaileysVersion();
      if (res && Array.isArray((res as any).version) && (res as any).version.length >= 3) {
        version = (res as any).version as [number, number, number];
      } else {
        log.warn({ res }, 'fetchLatestBaileysVersion returned malformed result — using fallback');
      }
    } catch (e: any) {
      log.warn({ err: e?.message }, 'fetchLatestBaileysVersion failed — using hardcoded fallback');
    }

    const sock = makeWASocket({
      version,
      auth: state,
      browser: fingerprint,
      printQRInTerminal: false,
      markOnlineOnConnect: false,
      connectTimeoutMs: 60_000,
      defaultQueryTimeoutMs: 60_000,
      keepAliveIntervalMs: 10_000,
      syncFullHistory: false,
      logger: log as any,
    } as any);

    currentSocket = sock;
    _activeSocket = sock; // expose for downloadMediaWWJS

    sock.ev.on('creds.update', saveCreds);

    // ─── Pairing code (phone number, no QR needed) ───────────────────────
    // Only request a new pairing code if 90s have passed since the last one.
    // This prevents the rapid-cycle problem where each reconnect invalidates
    // the previous code before the user can enter it.
    if (!state.creds.registered) {
      const botPhone = (process.env.BOT_PHONE || '').replace(/\D/g, '');
      const now = Date.now();
      if (botPhone && (now - lastPairingCodeAt) > 90_000) {
        lastPairingCodeAt = now;
        pairingInProgress = true;
        setTimeout(async () => {
          try {
            const code = await (sock as any).requestPairingCode(botPhone);
            // Persist pairing code for HTTP endpoint + admin UI
            writePairingCode(code, botPhone);
            // eslint-disable-next-line no-console
            console.log('\n╔══════════════════════════════════════════╗');
            // eslint-disable-next-line no-console
            console.log('║  [WA-HARDENED] PAIRING CODE:             ║');
            // eslint-disable-next-line no-console
            console.log(`║  👉  ${code}  👈                          ║`);
            // eslint-disable-next-line no-console
            console.log('║  WhatsApp → Dispositivi collegati →      ║');
            // eslint-disable-next-line no-console
            console.log('║  Collega con numero di telefono          ║');
            // eslint-disable-next-line no-console
            console.log('╚══════════════════════════════════════════╝\n');
            log.info({ code }, 'pairing code emitted — valid for ~90s, enter it NOW');
          } catch (e: any) {
            log.error({ err: e?.message }, 'requestPairingCode failed');
          }
        }, 3000);
      } else if (botPhone && (now - lastPairingCodeAt) <= 90_000) {
        const secsLeft = Math.round((90_000 - (now - lastPairingCodeAt)) / 1000);
        log.info({ secsLeft }, 'pairing code still valid — not requesting new one yet');
      } else {
        log.warn('BOT_PHONE not set — cannot request pairing code');
      }
    }

    sock.ev.on('connection.update', (update: Partial<ConnectionState>) => {
      const { connection, lastDisconnect, qr } = update;
      if (qr && !state.creds.registered) {
        // Only show QR as fallback if pairing code wasn't requested
        const botPhone = (process.env.BOT_PHONE || '').replace(/\D/g, '');
        if (!botPhone) {
          try {
            writeFileSync(QR_FILE, qr, 'utf8');
          } catch { /* non-fatal */ }
          log.info('QR code emitted (fallback — no BOT_PHONE set)');
          // eslint-disable-next-line no-console
          console.log('\n[WA-HARDENED] 📱 QR CODE (fallback):');
          qrcode.generate(qr, { small: true });
        }
      }

      if (connection === 'open') {
        connected = true;
        pairingInProgress = false;
        loggedOut401Count = 0; // Reset — connection succeeded
        resetBackoff();
        recordSuccessfulHandshake();
        // Clear pairing code — connection is now live
        clearPairingCode();
        log.info('WhatsApp connection OPEN');
        waitResolvers.forEach(r => r());
        waitResolvers = [];

        // P1 fix 2026-04-26 (SAR-05): heartbeat every 30s to prevent WA idle disconnect.
        // Sends a presence "available" update to keep the session alive.
        if (_heartbeatInterval) clearInterval(_heartbeatInterval);
        _heartbeatInterval = setInterval(async () => {
          try {
            if (connected && currentSocket) {
              await currentSocket.sendPresenceUpdate('available');
              log.info('heartbeat: presence update sent');
            }
          } catch (e: any) {
            log.warn({ err: e?.message }, 'heartbeat: presence update failed (non-fatal)');
          }
        }, 30_000); // Every 30 seconds — keeps session alive
      }

      if (connection === 'close') {
        connected = false;
        const err = lastDisconnect?.error as Boom | undefined;
        const statusCode = err?.output?.statusCode;
        const reasonStr = DisconnectReason[statusCode as any] || String(statusCode || 'unknown');
        log.warn({ statusCode, reason: reasonStr }, 'connection CLOSED');

        // Hard-stop conditions: Meta explicitly rejected us.
        if (statusCode === DisconnectReason.loggedOut || statusCode === 401) {
          if (pairingInProgress || !state.creds.registered) {
            // Pairing code expired — just retry, do NOT wipe auth dir
            log.warn('pairing code expired or rejected — retrying with new code in 3s');
            booting = false;
            setTimeout(() => boot(), 3000);
            return;
          }
          // After a 515 restart, the next 401 is expected — retry with saved creds, do NOT wipe
          loggedOut401Count = (loggedOut401Count || 0) + 1;
          if (loggedOut401Count <= 3) {
            log.warn({ attempt: loggedOut401Count }, '401 after restart — retrying with saved creds (NOT wiping)');
            booting = false;
            setTimeout(() => boot(), 5000 * loggedOut401Count);
            return;
          }
          // Only wipe after 4+ consecutive 401s without any successful connection
          log.error('loggedOut / 401 x4 — session truly revoked, wiping auth and re-pairing');
          loggedOut401Count = 0;
          try {
            rmSync(AUTH_DIR, { recursive: true, force: true });
            mkdirSync(AUTH_DIR, { recursive: true });
          } catch { /* non-fatal */ }
          fingerprint = rotateFingerprint();
          booting = false;
          setTimeout(() => boot(), 5000);
          return;
        }

        // 515 restartRequired — IMMEDIATE reconnect, this is normal after pairing
        if (statusCode === 515 || statusCode === DisconnectReason.restartRequired) {
          log.info('515 restartRequired — reconnecting immediately (normal behavior)');
          booting = false;
          setTimeout(() => boot(), 2000);
          return;
        }

        // 428/408 connectionClosed/Lost — reconnect with short backoff
        if (statusCode === 428 || statusCode === 408 || statusCode === 440 || statusCode === 503) {
          const delay = Math.min(3000 * (loggedOut401Count + 1), 30000);
          log.info({ statusCode, delay }, 'temporary disconnect — reconnecting');
          booting = false;
          setTimeout(() => boot(), delay);
          return;
        }

        // 403 forbidden — account banned, stop permanently
        if (statusCode === 403) {
          log.error('403 forbidden — account may be banned, stopping');
          return;
        }

        // Any other code — reconnect with moderate backoff, no dead-man
        log.info({ statusCode, reason: reasonStr }, 'unknown disconnect — reconnecting in 10s');
        booting = false;
        setTimeout(() => boot(), 10000);
      }
    });

    // ─── LID → phone mapping from contacts ───
    sock.ev.on('contacts.upsert', (contacts: any[]) => {
      for (const c of contacts || []) {
        const id: string = c?.id || '';
        const phoneJid: string = (c as any)?.phoneJid || '';
        // contacts.upsert may contain {id: '@lid', phoneJid: '@s.whatsapp.net'}
        if (id.endsWith('@lid') && phoneJid.endsWith('@s.whatsapp.net')) {
          lidToPhoneMap.set(id, phoneJid);
          log.debug({ lid: redactJid(id), phone: redactJid(phoneJid) }, 'LID→phone mapped');
        }
      }
    });

    sock.ev.on('messages.upsert', ({ messages, type }: any) => {
      try {
        // P0 fix 2026-04-12: filter out non-actionable messages that cause
        // crashes in downstream handlers (reactions, read receipts, protocol,
        // sender-key distribution, and empty messages with no body at all).
        const validMessages = messages.filter((m: any) => {
          if (!m?.message) return false;
          const msgType = Object.keys(m.message)[0];
          if (!msgType) return false;
          if (msgType === 'reactionMessage') return false;
          if (msgType === 'protocolMessage') return false;
          if (msgType === 'senderKeyDistributionMessage') return false;
          if (msgType === 'messageContextInfo') return false;
          return true;
        });
        if (validMessages.length === 0) return;

        const outbound = validMessages.map((m: any) => {
          // Forward as-is; handlers already know the Baileys shape.
          if (m?.key?.remoteJid) {
            log.debug(
              { jid: redactJid(m.key.remoteJid), body: bodyStats(m.message?.conversation) },
              'message in'
            );
          }
          return m;
        });
        // Schedule a humanized read receipt for inbound non-fromMe messages.
        for (const m of outbound) {
          if (m?.key && !m.key.fromMe && m.key.remoteJid && m.key.id) {
            const jid = m.key.remoteJid as string;
            const id = m.key.id as string;
            const participant = m.key.participant as string | undefined;
            setTimeout(() => {
              if (!currentSocket || !connected) return;
              currentSocket.readMessages([{ remoteJid: jid, id, participant }]).catch(() => {
                /* ignore */
              });
            }, randomReadReceiptDelayMs());
          }
        }
        emit('messages.upsert', { messages: outbound, type });
      } catch (e: any) {
        log.error({ err: e?.message }, 'messages.upsert handler failed');
      }
    });
  }

  // ─── Outbound send wrapper with typing + rate cap + min floor ───
  async function humanizedSend(jid: string, content: any): Promise<void> {
    if (!currentSocket || !connected) {
      log.warn({ jid: redactJid(jid) }, 'send attempted while disconnected — dropping');
      return;
    }

    // Resolve LID JID → phone JID if we have the mapping
    const resolvedJid = (jid.endsWith('@lid') && lidToPhoneMap.get(jid)) ? lidToPhoneMap.get(jid)! : jid;
    if (resolvedJid !== jid) {
      log.debug({ lid: redactJid(jid), resolved: redactJid(resolvedJid) }, 'resolved LID→phone for send');
      jid = resolvedJid;
    }

    await rateLimiter.acquire();

    // Figure out a text length for delay computation.
    const text: string =
      (content && typeof content.text === 'string' && content.text) ||
      (content && typeof content.caption === 'string' && content.caption) ||
      '';

    const delayMs = computeTypingDelayMs(text);

    try {
      await currentSocket.sendPresenceUpdate('composing', jid);
    } catch {
      /* non-fatal */
    }

    await sleep(delayMs);

    try {
      await currentSocket.sendPresenceUpdate('paused', jid);
    } catch {
      /* non-fatal */
    }

    try {
      await currentSocket.sendMessage(jid, content);
      log.debug({ jid: redactJid(jid), delayMs, body: bodyStats(text) }, 'message out');
    } catch (e: any) {
      log.error({ jid: redactJid(jid), err: e?.message }, 'sendMessage failed');
    }
  }

  const sock: SockLike = {
    ev,
    async sendMessage(jid: string, content: any) {
      await humanizedSend(jid, content);
    },
    async sendPresenceUpdate(type: string, jid: string) {
      if (!currentSocket || !connected) return;
      try {
        await currentSocket.sendPresenceUpdate(type as any, jid);
      } catch {
        /* non-fatal */
      }
    },
  };

  // ─── Background: random presence refresh (looks like checking WA) ───
  const schedulePresenceRefresh = () => {
    const delay = randomPresenceIntervalMs();
    setTimeout(async () => {
      if (currentSocket && connected) {
        try {
          await currentSocket.sendPresenceUpdate('available');
        } catch {
          /* non-fatal */
        }
        try {
          // Flip back to unavailable after 10-30s (like briefly checking and closing).
          await sleep(10_000 + Math.floor(Math.random() * 20_000));
          await currentSocket.sendPresenceUpdate('unavailable');
        } catch {
          /* non-fatal */
        }
      }
      schedulePresenceRefresh();
    }, delay).unref?.();
  };
  schedulePresenceRefresh();

  // ─── Kick off first connection ───
  await boot();

  const waitForConnection = () =>
    new Promise<void>(resolve => {
      if (connected) return resolve();
      waitResolvers.push(resolve);
      // Safety: never block index.ts forever.
      setTimeout(() => {
        log.info('waitForConnection timeout — API bridge continuing in parallel');
        resolve();
      }, 120_000).unref?.();
    });

  return { sock, waitForConnection };
}

// ─── Stub sock used when dead-man is tripped at startup ─────────────────────
function buildStubSock(reason: string): { sock: SockLike; waitForConnection: () => Promise<void> } {
  const noop = async () => {};
  const listeners: Record<string, Array<(...args: any[]) => void>> = {};
  const sock: SockLike = {
    ev: {
      on(event, h) {
        if (!listeners[event]) listeners[event] = [];
        listeners[event].push(h);
      },
    },
    sendMessage: noop as any,
    sendPresenceUpdate: noop as any,
  };
  log.error({ reason }, 'returning STUB sock — WA is paused');
  return {
    sock,
    waitForConnection: () => Promise.resolve(),
  };
}

// ─── Media download helper — uses Baileys downloadMediaMessage ───────────────
export async function downloadMediaWWJS(msg: any): Promise<Buffer | null> {
  // Fallback 1: _buffer set by wa-adapter shim (wwebjs compat)
  const mediaMsg =
    msg?.message?.audioMessage ||
    msg?.message?.imageMessage ||
    msg?.message?.documentMessage ||
    msg?.message?.documentWithCaptionMessage?.message?.documentMessage ||
    msg?.message?.videoMessage;
  if (mediaMsg?._buffer) return mediaMsg._buffer as Buffer;

  // Fallback 2: Baileys native downloadMediaMessage
  if (!msg?.message) return null;
  try {
    const msgType =
      msg.message.audioMessage ? 'audioMessage' :
      msg.message.imageMessage ? 'imageMessage' :
      msg.message.videoMessage ? 'videoMessage' :
      msg.message.documentMessage ? 'documentMessage' :
      msg.message.documentWithCaptionMessage ? 'documentWithCaptionMessage' :
      null;
    if (!msgType) return null;

    const buffer = await downloadMediaMessage(
      msg,
      'buffer',
      {},
      {
        logger: log as any,
        reuploadRequest: _activeSocket ? (_activeSocket as any).updateMediaMessage : undefined,
      }
    );
    return buffer as Buffer;
  } catch (err: any) {
    console.error('[MEDIA] Baileys download failed:', err.message);
    return null;
  }
}

// Keep QR_FILE referenced (avoid TS unused warning if strict)
export const _internal = { QR_FILE, AUTH_DIR, fileExists: (p: string) => existsSync(p) };
