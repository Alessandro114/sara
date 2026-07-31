// ═══════════════════════════════════════════════════
// SCALA WhatsApp Bot — Configuration
// ═══════════════════════════════════════════════════
import pg from 'pg';

const { Pool } = pg;

export const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/scala_bot',
});

// A Pool 'error' event with no listener throws → uncaughtException → process exit.
pool.on('error', (err) => {
    console.error('[pool] idle client error', err);
});

// GEMINI_API_KEY / GEMINI_MODEL exports REMOVED 2026-07-17 — Gemini is out of
// the AI chain and out of every runtime path. Do not re-add: the chain is
// Groq → Cerebras → Mistral (see lib/ai-providers.ts).
export const BOT_NAME = process.env.BOT_NAME || 'S.A.R.A.';
export const SESSION_TIMEOUT = parseInt(process.env.SESSION_TIMEOUT_MINUTES || '30') * 60 * 1000;
export const MAX_MEDIA_SIZE_MB = parseInt(process.env.MAX_MEDIA_SIZE_MB || '7');
export const MAX_MEDIA_SIZE_BYTES = MAX_MEDIA_SIZE_MB * 1024 * 1024;

export const CTA_URLS: Record<string, string> = {
    general: process.env.CTA_URL_SCALA || 'https://app.get-scala.com',
    legale: process.env.CTA_URL_PRAXIS || 'https://app.get-scala.com/praxisos',
    commercialista: process.env.CTA_URL_PRAXIS || 'https://app.get-scala.com/praxisos',
    consulente: process.env.CTA_URL_PRAXIS || 'https://app.get-scala.com/praxisos',
    agenzia: process.env.CTA_URL_AGENCY || 'https://app.get-scala.com/agencyos',
    marketing: process.env.CTA_URL_AGENCY || 'https://app.get-scala.com/agencyos',
    comunicazione: process.env.CTA_URL_AGENCY || 'https://app.get-scala.com/agencyos',
    ristorante: process.env.CTA_URL_DINE || 'https://app.get-scala.com/dineos',
    ristorazione: process.env.CTA_URL_DINE || 'https://app.get-scala.com/dineos',
    bar: process.env.CTA_URL_DINE || 'https://app.get-scala.com/dineos',
    pizzeria: process.env.CTA_URL_DINE || 'https://app.get-scala.com/dineos',
    dermatologia: 'https://app.get-scala.com/dermalyos',
    immobiliare: 'https://app.get-scala.com/propertyos',
    automotive: 'https://app.get-scala.com/motoros',
    turismo: 'https://app.get-scala.com/travelos',
    toolkit: 'https://toolkit.get-scala.com',
    content: 'https://content.get-scala.com',
    network: 'https://network.get-scala.com',
};
