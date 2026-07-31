// ═══════════════════════════════════════════════════
// SCALA WhatsApp Bot — Backend API Client
// Connects SARA WhatsApp to the SCALA backend (localhost:3001)
// ═══════════════════════════════════════════════════

const BACKEND_URL = process.env.SCALA_BACKEND_URL || 'http://localhost:3001';
const SARA_API_KEY = process.env.SARA_API_KEY || '';

function headers(extra?: Record<string, string>): Record<string, string> {
    return {
        'Content-Type': 'application/json',
        'x-sara-api-key': SARA_API_KEY,
        ...extra,
    };
}

// ─── Data Entry: parse message and insert into vertical table ───
export async function callDataEntry(message: string, sector: string, userId?: string): Promise<{ success: boolean; record?: string; error?: string }> {
    try {
        const res = await fetch(`${BACKEND_URL}/api/ai/functions`, {
            method: 'POST',
            headers: headers(),
            body: JSON.stringify({
                action: 'ai-data-entry',
                message,
                sector,
                userId: userId || 'sara-whatsapp',
            }),
            signal: AbortSignal.timeout(30000),
        });
        const data = await res.json() as any;
        if (res.ok && data.success) {
            return { success: true, record: data.record || data.summary || 'record creato' };
        }
        return { success: false, error: data.error || `HTTP ${res.status}` };
    } catch (err: any) {
        console.error('[BACKEND] Data entry error:', err.message);
        return { success: false, error: err.message };
    }
}

// ─── OCR: send image buffer for text extraction ───
export async function callOCR(buffer: Buffer, mimetype: string, filename?: string): Promise<{ success: boolean; text?: string; error?: string }> {
    try {
        // Multipart form data upload
        const boundary = '----SaraOCR' + Date.now();
        const fname = filename || 'image.jpg';

        const bodyParts: Buffer[] = [];
        // File field
        bodyParts.push(Buffer.from(
            `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fname}"\r\nContent-Type: ${mimetype}\r\n\r\n`
        ));
        bodyParts.push(buffer);
        bodyParts.push(Buffer.from(`\r\n--${boundary}--\r\n`));

        const body = Buffer.concat(bodyParts);

        const res = await fetch(`${BACKEND_URL}/api/ocr/process`, {
            method: 'POST',
            headers: {
                'Content-Type': `multipart/form-data; boundary=${boundary}`,
                'x-sara-api-key': SARA_API_KEY,
            },
            body,
            signal: AbortSignal.timeout(60000),
        });
        const data = await res.json() as any;
        if (res.ok && (data.text || data.extractedText)) {
            return { success: true, text: data.text || data.extractedText };
        }
        return { success: false, error: data.error || `HTTP ${res.status}` };
    } catch (err: any) {
        console.error('[BACKEND] OCR error:', err.message);
        return { success: false, error: err.message };
    }
}

// ─── Balance Sheet Parser: extract financial data from PDF ───
export async function callBalanceParser(base64Content: string, filename: string, userId?: string): Promise<{ success: boolean; summary?: string; data?: any; error?: string }> {
    try {
        const res = await fetch(`${BACKEND_URL}/api/ai/functions`, {
            method: 'POST',
            headers: headers(),
            body: JSON.stringify({
                action: 'balance-parser',
                content: base64Content,
                filename,
                userId: userId || 'sara-whatsapp',
            }),
            signal: AbortSignal.timeout(60000),
        });
        const data = await res.json() as any;
        if (res.ok && (data.success || data.summary)) {
            return { success: true, summary: data.summary || JSON.stringify(data.data), data: data.data };
        }
        return { success: false, error: data.error || `HTTP ${res.status}` };
    } catch (err: any) {
        console.error('[BACKEND] Balance parser error:', err.message);
        return { success: false, error: err.message };
    }
}

// ─── Detect if a message looks like data entry ───
// Returns true if message contains 2+ of: name, phone, email, date, amount
export function looksLikeDataEntry(text: string): boolean {
    let signals = 0;

    // Capitalized name (2+ capitalized words together)
    if (/[A-Z][a-zàèéìòùáéíóúñ]+\s+[A-Z][a-zàèéìòùáéíóúñ]+/.test(text)) signals++;

    // Phone number
    if (/(?:\+?\d{1,3}[\s.-]?)?\(?\d{2,4}\)?[\s.-]?\d{3,4}[\s.-]?\d{3,4}/.test(text)) signals++;

    // Email
    if (/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.test(text)) signals++;

    // Date (various formats)
    if (/\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}/.test(text)) signals++;

    // Price/amount (€, $, numbers with comma/dot)
    if (/(?:€|\$|EUR|USD)\s*\d+|\d+(?:[.,]\d+)?\s*(?:€|\$|EUR|euro|dollars)/.test(text)) signals++;

    // Address-like (via, street, piazza, calle, rua + number)
    if (/(?:via|viale|piazza|corso|street|av\.|calle|rua)\s+[A-Za-zàèéìòùáéíóúñ\s]+,?\s*\d/i.test(text)) signals++;

    return signals >= 2;
}

// ─── Detect if image likely contains a document (invoice, receipt, card) ───
// Based on MIME type hints and filename patterns
export function looksLikeDocument(mimetype: string, caption?: string): boolean {
    // If caption mentions document keywords
    if (caption) {
        const lower = caption.toLowerCase();
        if (/fattura|invoice|ricevuta|receipt|scontrino|ticket|biglietto|carta|card|menu|documento|document|contratto|contract|bolletta|bill/i.test(lower)) {
            return true;
        }
    }
    // PDFs are always documents
    if (mimetype.includes('pdf')) return true;
    return false;
}

// ─── Detect if PDF content is financial ───
export function looksLikeFinancial(text: string, filename: string): boolean {
    const lower = (text + ' ' + filename).toLowerCase();
    const financialTerms = [
        'fattura', 'invoice', 'bilancio', 'balance sheet', 'conto economico',
        'income statement', 'stato patrimoniale', 'iva', 'vat', 'imponibile',
        'taxable', 'totale dare', 'totale avere', 'ricavi', 'revenue',
        'costi', 'costs', 'utile', 'profit', 'perdita', 'loss',
        'attivo', 'passivo', 'assets', 'liabilities', 'cashflow',
        'partita doppia', 'registro', 'nota integrativa', 'f24',
    ];
    let matches = 0;
    for (const term of financialTerms) {
        if (lower.includes(term)) matches++;
    }
    return matches >= 2;
}

// ─── Extract contact info for CRM offer ───
export interface ContactInfo {
    name?: string;
    email?: string;
    phone?: string;
    company?: string;
}

// Words that must NOT be extracted as part of a contact name
const GREETING_BLACKLIST = new Set([
    'Sara', 'SARA', 'Ciao', 'Buongiorno', 'Buonasera', 'Salve', 'Pronto',
    'Hello', 'Hi', 'Hey', 'Hola', 'Buenos', 'Buenas', 'Oi', 'Olà', 'Olá',
    'Grazie', 'Thanks', 'Gracias', 'Obrigado', 'Scala', 'Gentile', 'Spett',
]);

export function extractContactFromText(text: string): ContactInfo | null {
    const info: ContactInfo = {};

    // Name: 2+ capitalized words, excluding greeting/bot words
    const nameMatches = text.matchAll(/([A-Z][a-zàèéìòùáéíóúñ]+(?:\s+[A-Z][a-zàèéìòùáéíóúñ]+)+)/g);
    for (const m of nameMatches) {
        const candidate = m[1];
        const words = candidate.split(/\s+/);
        // Skip if ANY word is a greeting/bot name
        if (words.some(w => GREETING_BLACKLIST.has(w))) continue;
        info.name = candidate;
        break;
    }

    // Email
    const emailMatch = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
    if (emailMatch) info.email = emailMatch[0];

    // Phone
    const phoneMatch = text.match(/(?:\+\d{1,3}[\s.-]?)?\(?\d{2,4}\)?[\s.-]?\d{3,4}[\s.-]?\d{3,4}/);
    if (phoneMatch) info.phone = phoneMatch[0];

    // Need at least name + one contact method
    if (info.name && (info.email || info.phone)) {
        return info;
    }
    return null;
}
