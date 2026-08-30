// =====================================================================
// Multi-Session WhatsApp Manager for SOLO SARA — WAHA Edition
// Replaces whatsapp-web.js (DEPRECATED: passkey "Shortcake" broke it).
// Uses WAHA REST API (Docker, engine GOWS/NOWEB). NO chromium needed.
// Same public API as the old multi-session.ts — drop-in replacement.
// =====================================================================

import pino from 'pino';
import { handleSoloMessage } from './solo-handler.js';
import http from 'http';
import https from 'https';

// --- Types (unchanged) -----------------------------------------------
export type SessionStatus = 'disconnected' | 'connecting' | 'connected';

interface SoloSession {
    userId: string;
    status: SessionStatus;
    qr: string | null;       // base64 PNG data-URL of QR code
    phone: string | null;    // connected phone number
}

// --- Config ----------------------------------------------------------
const WAHA_URL = process.env.WAHA_API_URL || 'http://127.0.0.1:3004';
const WAHA_KEY = process.env.WAHA_API_KEY || 'CHANGE_ME';
const WAHA_ENGINE = process.env.WAHA_ENGINE || 'GOWS';
const WEBHOOK_URL = process.env.WAHA_WEBHOOK_URL || 'http://127.0.0.1:3006/api/waha-webhook';
const MAX_CONCURRENT_SESSIONS = parseInt(process.env.MAX_SOLO_SESSIONS || '50', 10);

const log = pino({ name: 'solo-multi-session' });

// --- State -----------------------------------------------------------
const sessions = new Map<string, SoloSession>();

// --- WAHA API helper -------------------------------------------------
async function wahaFetch(path: string, method = 'GET', body?: any): Promise<any> {
    const url = new URL(path, WAHA_URL);
    return new Promise((resolve, reject) => {
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
                try { resolve(JSON.parse(data)); }
                catch { resolve(data); }
            });
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('WAHA timeout')); });
        if (body) req.write(JSON.stringify(body));
        req.end();
    });
}

async function wahaScreenshot(sessionName: string): Promise<Buffer | null> {
    const url = new URL(`/api/screenshot?session=${sessionName}`, WAHA_URL);
    return new Promise((resolve) => {
        const mod = url.protocol === 'https:' ? https : http;
        const req = mod.request({
            method: 'GET', hostname: url.hostname, port: url.port,
            path: url.pathname + url.search,
            headers: { 'X-Api-Key': WAHA_KEY },
            timeout: 15000,
        }, (res) => {
            const chunks: Buffer[] = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () => resolve(Buffer.concat(chunks)));
        });
        req.on('error', () => resolve(null));
        req.end();
    });
}

// Map WAHA status → our status
function mapStatus(wahaStatus: string): SessionStatus {
    switch (wahaStatus) {
        case 'WORKING': return 'connected';
        case 'SCAN_QR_CODE': case 'STARTING': return 'connecting';
        default: return 'disconnected';
    }
}

// --- Public API (same signatures as old multi-session.ts) ------------

export async function createSession(userId: string): Promise<{ qr?: string; status: SessionStatus }> {
    const existing = sessions.get(userId);
    if (existing?.status === 'connected') return { status: 'connected' };
    if (existing?.status === 'connecting' && existing.qr) return { qr: existing.qr, status: 'connecting' };

    if (sessions.size >= MAX_CONCURRENT_SESSIONS && !sessions.has(userId)) {
        throw new Error(`Maximum concurrent sessions (${MAX_CONCURRENT_SESSIONS}) reached`);
    }

    const sessionName = `solo-${userId}`;
    const session: SoloSession = { userId, status: 'connecting', qr: null, phone: null };
    sessions.set(userId, session);

    try {
        // Start WAHA session with webhook for incoming messages
        await wahaFetch('/api/sessions/start', 'POST', {
            name: sessionName,
            config: {
                engine: WAHA_ENGINE,
                webhooks: [{
                    url: WEBHOOK_URL,
                    events: ['message', 'session.status'],
                }],
            },
        });
        log.info({ userId, sessionName, engine: WAHA_ENGINE }, 'WAHA session started');

        // Wait for QR to be available
        await new Promise(r => setTimeout(r, 5000));

        // Get QR as PNG → convert to data URL
        const png = await wahaScreenshot(sessionName);
        if (png && png.length > 500) {
            session.qr = `data:image/png;base64,${png.toString('base64')}`;
        }

        // Check actual status
        const info = await wahaFetch(`/api/sessions`);
        const wahaSession = Array.isArray(info)
            ? info.find((s: any) => s.name === sessionName)
            : null;
        if (wahaSession) {
            session.status = mapStatus(wahaSession.status);
            if (wahaSession.me?.id) {
                session.phone = wahaSession.me.id.split('@')[0] || null;
            }
        }
    } catch (err: any) {
        log.error({ userId, err: err?.message }, 'WAHA session start failed');
        session.status = 'disconnected';
    }

    return session.qr ? { qr: session.qr, status: session.status } : { status: session.status };
}

export async function getSessionStatus(userId: string): Promise<SessionStatus> {
    const sessionName = `solo-${userId}`;
    try {
        const info = await wahaFetch('/api/sessions');
        const s = Array.isArray(info) ? info.find((x: any) => x.name === sessionName) : null;
        const status = s ? mapStatus(s.status) : 'disconnected';
        // Update local cache
        const local = sessions.get(userId);
        if (local) local.status = status;
        return status;
    } catch {
        return sessions.get(userId)?.status || 'disconnected';
    }
}

export async function stopSession(userId: string): Promise<void> {
    const sessionName = `solo-${userId}`;
    try {
        await wahaFetch('/api/sessions/stop', 'POST', { name: sessionName });
    } catch { /* ignore */ }
    sessions.delete(userId);
    log.info({ userId }, 'session stopped');
}

export async function getQRCode(userId: string): Promise<string | null> {
    const session = sessions.get(userId);
    if (!session || session.status === 'connected') return null;

    // Refresh QR from WAHA
    const sessionName = `solo-${userId}`;
    const png = await wahaScreenshot(sessionName);
    if (png && png.length > 500) {
        session.qr = `data:image/png;base64,${png.toString('base64')}`;
    }
    return session.qr;
}

export function getConnectedPhone(userId: string): string | null {
    return sessions.get(userId)?.phone || null;
}

export async function restoreAllSessions(): Promise<void> {
    try {
        const info = await wahaFetch('/api/sessions');
        if (!Array.isArray(info)) return;

        let restored = 0;
        for (const s of info) {
            if (!s.name?.startsWith('solo-')) continue;
            const userId = s.name.replace('solo-', '');
            const status = mapStatus(s.status);
            sessions.set(userId, {
                userId,
                status,
                qr: null,
                phone: s.me?.id?.split('@')[0] || null,
            });
            restored++;
        }
        log.info({ restored }, 'restored sessions from WAHA');
    } catch (err: any) {
        log.warn({ err: err?.message }, 'failed to restore sessions — WAHA may be starting');
    }
}

// --- Webhook handler (called by our Express/Fastify server) ----------
export async function handleWahaWebhook(payload: any): Promise<void> {
    const sessionName: string = payload?.session || '';
    if (!sessionName.startsWith('solo-')) return;
    const userId = sessionName.replace('solo-', '');

    // Session status change
    if (payload.event === 'session.status') {
        const session = sessions.get(userId);
        if (session) {
            session.status = mapStatus(payload.payload?.status || '');
            if (payload.payload?.me?.id) {
                session.phone = payload.payload.me.id.split('@')[0];
            }
            log.info({ userId, status: session.status }, 'session status changed');
        }
        return;
    }

    // Incoming message
    if (payload.event === 'message') {
        const msg = payload.payload;
        if (!msg?.from || !msg?.body) return;
        try {
            await handleSoloMessage(userId, null, msg, msg.from || sessionName);
        } catch (err: any) {
            log.error({ userId, err: err?.message }, 'solo message handler error');
        }
    }
}

// --- Send message via WAHA API ---------------------------------------
export async function sendMessage(userId: string, chatId: string, text: string): Promise<boolean> {
    const sessionName = `solo-${userId}`;
    try {
        await wahaFetch(`/api/sendText`, 'POST', {
            session: sessionName,
            chatId,
            text,
        });
        return true;
    } catch (err: any) {
        log.error({ userId, chatId, err: err?.message }, 'sendMessage failed');
        return false;
    }
}

// --- Check WAHA connection health ------------------------------------
export async function checkWahaHealth(): Promise<{
    status: 'connected' | 'disconnected';
    reachable: boolean;
    sessionsCount?: number;
    error?: string;
}> {
    try {
        const info = await Promise.race([
            wahaFetch('/api/sessions'),
            new Promise((_, reject) => setTimeout(() => reject(new Error('WAHA healthcheck timeout')), 3000)),
        ]);
        if (Array.isArray(info)) {
            return { status: 'connected', reachable: true, sessionsCount: info.length };
        }
        return { status: 'connected', reachable: true };
    } catch (err: any) {
        return { status: 'disconnected', reachable: false, error: err?.message || 'WAHA unavailable' };
    }
}

