// ═══════════════════════════════════════════════════════════
// SARA outbound webhooks (n8n / Make.com / Zapier) — issue #10
//
// Config (env, all optional — an event with no URL is a no-op):
//   SARA_WEBHOOK_CONVERSATION_STARTED, SARA_WEBHOOK_BOOKING_CONFIRMED,
//   SARA_WEBHOOK_TAKEOVER_REQUESTED,   SARA_WEBHOOK_LEAD_QUALIFIED
//   SARA_WEBHOOK_SECRET     if set, body is signed: X-Sara-Signature: sha256=<hmac hex>
//   SARA_WEBHOOK_RETRIES    extra attempts after the first (default 3, max 6)
//   SARA_WEBHOOK_TIMEOUT_MS per-attempt timeout (default 5000)
//
// Delivery is fire-and-forget: it never throws and never blocks the chat reply.
// 5xx / 429 / network errors are retried with exponential backoff; other 4xx are not.
// ═══════════════════════════════════════════════════════════

import { createHmac } from 'node:crypto';

export type WebhookEvent = 'conversation.started' | 'booking.confirmed' | 'takeover.requested' | 'lead.qualified';

export interface WebhookPayload {
    event: WebhookEvent;
    timestamp: string;
    data: Record<string, unknown>;
}

const ENV_KEY: Record<WebhookEvent, string> = {
    'conversation.started': 'SARA_WEBHOOK_CONVERSATION_STARTED',
    'booking.confirmed': 'SARA_WEBHOOK_BOOKING_CONFIRMED',
    'takeover.requested': 'SARA_WEBHOOK_TAKEOVER_REQUESTED',
    'lead.qualified': 'SARA_WEBHOOK_LEAD_QUALIFIED',
};

export function webhookUrlFor(event: WebhookEvent): string | null {
    const url = (process.env[ENV_KEY[event]] || '').trim();
    return /^https?:\/\//i.test(url) ? url : null;
}

export function signBody(body: string, secret: string): string {
    return 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

/** Deliver one event; resolves true on a 2xx. Exposed (with `backoffMs`) for tests. */
export async function deliverWebhook(
    event: WebhookEvent,
    data: Record<string, unknown>,
    opts: { backoffMs?: number } = {},
): Promise<boolean> {
    const url = webhookUrlFor(event);
    if (!url) return false;
    const payload: WebhookPayload = { event, timestamp: new Date().toISOString(), data };
    const body = JSON.stringify(payload);
    const headers: Record<string, string> = { 'Content-Type': 'application/json', 'X-Sara-Event': event };
    const secret = process.env.SARA_WEBHOOK_SECRET;
    if (secret) headers['X-Sara-Signature'] = signBody(body, secret);
    const retries = Math.min(6, Math.max(0, Number.parseInt(process.env.SARA_WEBHOOK_RETRIES ?? '3', 10) || 0));
    const timeout = Number.parseInt(process.env.SARA_WEBHOOK_TIMEOUT_MS ?? '5000', 10) || 5000;
    const backoff = opts.backoffMs ?? 1000;

    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            const res = await fetch(url, { method: 'POST', headers, body, signal: AbortSignal.timeout(timeout) });
            if (res.ok) return true;
            if (res.status < 500 && res.status !== 429) {
                console.warn(`[WEBHOOK] ${event} → HTTP ${res.status}, not retrying`);
                return false;
            }
        } catch (err: any) {
            console.warn(`[WEBHOOK] ${event} attempt ${attempt + 1} failed: ${err?.message}`);
        }
        if (attempt < retries) await sleep(backoff * 2 ** attempt);
    }
    console.warn(`[WEBHOOK] ${event} gave up after ${retries + 1} attempts`);
    return false;
}

/** Fire-and-forget wrapper for call sites in the chat path. */
export function emitWebhook(event: WebhookEvent, data: Record<string, unknown>): void {
    if (!webhookUrlFor(event)) return;
    void deliverWebhook(event, data).catch(() => { /* never surfaces */ });
}
