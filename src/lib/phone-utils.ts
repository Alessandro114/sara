// ═══════════════════════════════════════════════════
// Centralized phone normalization for SARA
// All modules must use these functions to avoid
// duplicate CRM records from inconsistent formatting.
// ═══════════════════════════════════════════════════

/**
 * Strip WhatsApp JID suffix and normalize to digits-only (no + sign).
 * e.g. "[phone removed]@s.whatsapp.net" → "[phone removed]"
 * e.g. "[phone removed]" → "[phone removed]"
 */
export function normalizePhone(phone: string): string {
    return phone
        .replace(/@.*/, '')           // strip @s.whatsapp.net, @lid, etc.
        .replace(/[^\d]/g, '');       // keep only digits (no +, no spaces)
}

/**
 * Redact phone for logs — GDPR-safe last-4 only.
 */
export function redactPhone(phone: string): string {
    const digits = normalizePhone(phone);
    return digits.length >= 4 ? `***${digits.slice(-4)}` : '****';
}
