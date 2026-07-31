// ═══════════════════════════════════════════════════
// SCALA WhatsApp Bot — Media Download Utility
// ═══════════════════════════════════════════════════
import { MAX_MEDIA_SIZE_BYTES } from './config.js';
import { downloadMediaWWJS } from './wa-adapter.js';

// Use adapter's WAMessage type or fallback
type WAMessage = any;

export interface DownloadedMedia {
    buffer: Buffer;
    mimetype: string;
    filename?: string;
}

export interface DownloadResult {
    media: DownloadedMedia | null;
    reason?: 'too_large' | 'download_failed';
    fileSizeMB?: number;
}

export type MessageMediaType = 'text' | 'audio' | 'image' | 'video' | 'document' | 'location' | 'contact' | 'sticker' | 'unknown';

/**
 * Detect the type of media in a WhatsApp message
 */
export function detectMediaType(msg: WAMessage): MessageMediaType {
    const m = msg.message;
    if (!m) return 'text';

    if (m.audioMessage) return 'audio';
    if (m.imageMessage) return 'image';
    if (m.videoMessage) return 'video';
    if (m.documentMessage || m.documentWithCaptionMessage) return 'document';
    if (m.locationMessage || m.liveLocationMessage) return 'location';
    if (m.contactMessage || m.contactsArrayMessage) return 'contact';
    if (m.stickerMessage) return 'sticker';
    if (m.conversation || m.extendedTextMessage) return 'text';

    return 'unknown';
}

/**
 * Extract location data from a location message
 */
export function extractLocation(msg: WAMessage): { lat: number; lng: number; address?: string } | null {
    const m = msg.message;
    if (!m) return null;
    const loc = m.locationMessage || m.liveLocationMessage;
    if (!loc || loc.degreesLatitude == null) return null;
    return {
        lat: loc.degreesLatitude,
        lng: loc.degreesLongitude,
        address: loc.address || undefined,
    };
}

export interface ExtractedContact {
    displayName: string;
    vcard: string;
    phone?: string;
    email?: string;
}

/**
 * Parse phone and email from a vCard string (RFC 2426)
 */
function parseVCard(vcard: string): { phone?: string; email?: string } {
    if (!vcard) return {};
    // TEL field: TEL;TYPE=CELL:+391234567890 or TEL:+391234567890
    const telMatch = vcard.match(/^TEL[^:]*:([+\d\s\-().]+)/im);
    const phone = telMatch ? telMatch[1].replace(/\s/g, '').trim() : undefined;
    // EMAIL field
    const emailMatch = vcard.match(/^EMAIL[^:]*:([^\r\n]+)/im);
    const email = emailMatch ? emailMatch[1].trim() : undefined;
    return { phone: phone || undefined, email: email || undefined };
}

/**
 * Extract contact info from a contact message, including phone and email from vCard
 */
export function extractContacts(msg: WAMessage): ExtractedContact[] {
    const m = msg.message;
    if (!m) return [];
    if (m.contactMessage) {
        const vcard = m.contactMessage.vcard || '';
        return [{ displayName: m.contactMessage.displayName || '', vcard, ...parseVCard(vcard) }];
    }
    if (m.contactsArrayMessage?.contacts) {
        return m.contactsArrayMessage.contacts.map((c: any) => {
            const vcard = c.vcard || '';
            return { displayName: c.displayName || '', vcard, ...parseVCard(vcard) };
        });
    }
    return [];
}

/**
 * Extract text content from a message (text, captions)
 */
export function extractTextContent(msg: WAMessage): string {
    const m = msg.message;
    if (!m) return '';

    return m.conversation
        || m.extendedTextMessage?.text
        || m.imageMessage?.caption
        || m.videoMessage?.caption
        || m.documentWithCaptionMessage?.message?.documentMessage?.caption
        || '';
}

/**
 * Download media from a WhatsApp message using Baileys
 * Retries once after 2.5s if the first attempt fails (bot may be mid-reconnect).
 * @param maxSizeBytes — override max file size (default: MAX_MEDIA_SIZE_BYTES from config)
 */
export async function downloadMedia(msg: WAMessage, maxSizeBytes?: number): Promise<DownloadedMedia | null>;
export async function downloadMedia(msg: WAMessage, maxSizeBytes: number | undefined, detailed: true): Promise<DownloadResult>;
export async function downloadMedia(msg: WAMessage, maxSizeBytes?: number, detailed?: boolean): Promise<DownloadedMedia | DownloadResult | null> {
    const effectiveMax = maxSizeBytes ?? MAX_MEDIA_SIZE_BYTES;

    const tryDownload = async (): Promise<Buffer | null> => {
        try {
            return await downloadMediaWWJS(msg) as Buffer | null;
        } catch {
            return null;
        }
    };

    try {
        let buffer = await tryDownload();

        if (!buffer) {
            // Retry once after short delay — socket may be reconnecting
            console.warn('[MEDIA] First download attempt returned null, retrying in 2.5s...');
            await new Promise(r => setTimeout(r, 2500));
            buffer = await tryDownload();
        }

        if (!buffer) {
            console.error('[MEDIA] Download returned null after retry (expired URL or unsupported type)');
            return detailed ? { media: null, reason: 'download_failed' } : null;
        }

        const fileSizeMB = buffer.length / 1024 / 1024;

        if (buffer.length > effectiveMax) {
            console.warn(`[MEDIA] File too large: ${fileSizeMB.toFixed(1)}MB (max ${effectiveMax / 1024 / 1024}MB)`);
            return detailed ? { media: null, reason: 'too_large', fileSizeMB } : null;
        }

        const m = msg.message!;
        const mimetype =
            m.audioMessage?.mimetype
            || m.imageMessage?.mimetype
            || m.videoMessage?.mimetype
            || m.documentMessage?.mimetype
            || m.documentWithCaptionMessage?.message?.documentMessage?.mimetype
            || 'application/octet-stream';

        const filename =
            m.documentMessage?.fileName
            || m.documentWithCaptionMessage?.message?.documentMessage?.fileName
            || undefined;

        console.log(`[MEDIA] Downloaded: ${mimetype}, ${(buffer.length / 1024).toFixed(1)}KB`);
        const media = { buffer, mimetype, filename };
        return detailed ? { media } : media;
    } catch (err: any) {
        console.error('[MEDIA] Download error:', err.message);
        return detailed ? { media: null, reason: 'download_failed' } : null;
    }
}
