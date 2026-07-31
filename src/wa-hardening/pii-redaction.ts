// pii-redaction.ts — log sanitizer for Pino
//
// GDPR + Meta ToS both push us to avoid writing phone numbers and message
// bodies to logs. This module provides:
//   - redactPhone(): "39379...8633" → "***8633"
//   - redactJid():   "393793658633@s.whatsapp.net" → "***8633@s.whatsapp.net"
//   - bodyStats():   replaces a message body with {len: 42}
//   - buildPinoLogger(): a Pino instance with custom serializers applied
//
// Anything else that looks like a phone number in free-text logs is scrubbed
// with scrubPII(), which you can wrap around log messages manually.

import { pino } from 'pino';

export function redactPhone(phone: string | null | undefined): string {
  if (!phone) return '';
  const digits = phone.replace(/\D/g, '');
  if (digits.length <= 4) return '***';
  return `***${digits.slice(-4)}`;
}

export function redactJid(jid: string | null | undefined): string {
  if (!jid) return '';
  const [user, domain] = jid.split('@');
  return `${redactPhone(user)}${domain ? '@' + domain : ''}`;
}

export function bodyStats(body: unknown): { len: number; kind: string } {
  if (body == null) return { len: 0, kind: 'empty' };
  if (typeof body === 'string') return { len: body.length, kind: 'text' };
  if (typeof body === 'object') {
    try {
      return { len: JSON.stringify(body).length, kind: 'object' };
    } catch {
      return { len: 0, kind: 'object' };
    }
  }
  return { len: String(body).length, kind: typeof body };
}

/** Scrub any E.164-ish numbers from a free-text string. */
export function scrubPII(text: string): string {
  return text.replace(/\+?\d{7,15}/g, match => redactPhone(match));
}

/**
 * Build a Pino logger that auto-redacts common PII paths.
 * Paths follow Pino redact syntax: https://getpino.io/#/docs/redaction
 */
export function buildPinoLogger(name: string) {
  return pino({
    name,
    level: process.env.WA_LOG_LEVEL || 'info',
    redact: {
      paths: [
        'phone',
        'jid',
        'remoteJid',
        'from',
        'to',
        'msg.key.remoteJid',
        'message.conversation',
        'message.extendedTextMessage.text',
        'body',
        'text',
        '*.phone',
        '*.jid',
      ],
      censor: '[REDACTED]',
    },
  });
}
