// webhooks.ts tests (issue #10). Run: npx tsx src/__tests__/webhooks.test.ts
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { deliverWebhook, emitWebhook, signBody, webhookUrlFor } from '../lib/webhooks.js';

const calls: Array<{ url: string; init: any }> = [];
let script: Array<number | 'throw'> = [];
(globalThis as any).fetch = async (url: string, init: any) => {
    calls.push({ url, init });
    const next = script.shift() ?? 200;
    if (next === 'throw') throw new Error('ECONNRESET');
    return { ok: next >= 200 && next < 300, status: next } as any;
};
const reset = (s: Array<number | 'throw'>) => { calls.length = 0; script = s; };

delete process.env.SARA_WEBHOOK_BOOKING_CONFIRMED;
assert.equal(webhookUrlFor('booking.confirmed'), null);
assert.equal(await deliverWebhook('booking.confirmed', {}), false, 'no URL = no-op');
assert.equal(calls.length, 0);

process.env.SARA_WEBHOOK_BOOKING_CONFIRMED = 'not-a-url';
assert.equal(webhookUrlFor('booking.confirmed'), null, 'non-http URL ignored');

process.env.SARA_WEBHOOK_BOOKING_CONFIRMED = 'https://hooks.example.com/x';
process.env.SARA_WEBHOOK_SECRET = 's3cret';
reset([200]);
assert.equal(await deliverWebhook('booking.confirmed', { phone: '39333' }, { backoffMs: 1 }), true);
const body = calls[0].init.body as string;
assert.deepEqual(Object.keys(JSON.parse(body)), ['event', 'timestamp', 'data']);
assert.equal(calls[0].init.headers['X-Sara-Event'], 'booking.confirmed');
assert.equal(calls[0].init.headers['X-Sara-Signature'], 'sha256=' + createHmac('sha256', 's3cret').update(body).digest('hex'));
assert.equal(signBody('a', 'k'), 'sha256=' + createHmac('sha256', 'k').update('a').digest('hex'));

delete process.env.SARA_WEBHOOK_SECRET;
process.env.SARA_WEBHOOK_RETRIES = '3';
reset([503, 'throw', 429, 200]);
assert.equal(await deliverWebhook('booking.confirmed', {}, { backoffMs: 1 }), true, 'retries 5xx/network/429 until 2xx');
assert.equal(calls.length, 4);
assert.equal(calls[0].init.headers['X-Sara-Signature'], undefined, 'no signature without secret');

reset([400]);
assert.equal(await deliverWebhook('booking.confirmed', {}, { backoffMs: 1 }), false);
assert.equal(calls.length, 1, '4xx is not retried');

reset([500, 500, 500, 500, 500]);
assert.equal(await deliverWebhook('booking.confirmed', {}, { backoffMs: 1 }), false);
assert.equal(calls.length, 4, '1 attempt + 3 retries');

reset([200]);
emitWebhook('lead.qualified', {}); // no URL configured for this event
assert.equal(calls.length, 0);
console.log('webhooks tests passed');
