// ═══════════════════════════════════════════════════
// SARA — Multi-location (branches) awareness
// Added 2026-04-16 per Alessandro brief
// ═══════════════════════════════════════════════════
// Each tenant (Semeraro-style) can have N branches. A contact can be
// linked to a branch (either manually or via QR deep-link with
// ?utm_branch=<id>). When SARA answers to that contact, the branch
// context is injected in the system prompt so the reply references the
// right showroom + escalates to the right manager.

import { pool } from '../config.js';

export interface Branch {
    id: number;
    user_id: string | null;
    name: string | null;
    city: string | null;
    address: string | null;
    manager_name: string | null;
    manager_email: string | null;
    phone: string | null;
}

/**
 * Create/ensure the generic `branches` table and the `branch_id` /
 * `utm_branch` columns on contacts. Idempotent — safe to call on boot.
 */
export async function ensureBranchesSchema(): Promise<void> {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS branches (
                id SERIAL PRIMARY KEY,
                user_id UUID,
                name TEXT,
                city TEXT,
                address TEXT,
                manager_name TEXT,
                manager_email TEXT,
                phone TEXT,
                created_at TIMESTAMPTZ DEFAULT now()
            );
            CREATE INDEX IF NOT EXISTS idx_branches_user ON branches(user_id);
            CREATE INDEX IF NOT EXISTS idx_branches_city ON branches(LOWER(city));
        `);
        // Add branch_id to crm_contacts if the table exists.
        await pool.query(`
            DO $$
            BEGIN
                IF EXISTS (SELECT 1 FROM information_schema.tables
                           WHERE table_name = 'crm_contacts') THEN
                    ALTER TABLE crm_contacts ADD COLUMN IF NOT EXISTS branch_id INT;
                    ALTER TABLE crm_contacts ADD COLUMN IF NOT EXISTS utm_branch TEXT;
                END IF;
            END$$;
        `);
        // Add branch_id to wa_sessions too (so WA bot can resolve it without
        // touching crm_contacts on the hot path).
        await pool.query(`
            ALTER TABLE wa_sessions ADD COLUMN IF NOT EXISTS branch_id INT;
        `);
    } catch (err: any) {
        console.warn('[branches] ensure schema failed:', err.message);
    }
}

/**
 * Fetch a branch by id. Returns null if not found.
 */
export async function getBranch(id: number | null | undefined): Promise<Branch | null> {
    if (!id) return null;
    try {
        const r = await pool.query(`SELECT * FROM branches WHERE id = $1 LIMIT 1`, [id]);
        return r.rows[0] || null;
    } catch {
        return null;
    }
}

/**
 * Resolve a branch for a given WA phone: 1) if wa_sessions.branch_id is
 * set, use it; 2) else try to match a contact row with that phone; 3) else
 * try to match by session.tags containing a city name.
 */
export async function resolveBranchForPhone(
    phone: string,
    scalaUserId: string | null,
    sessionTags: string[] | null = null
): Promise<Branch | null> {
    // 1) wa_sessions.branch_id (hot path)
    try {
        const r = await pool.query(
            `SELECT branch_id FROM wa_sessions WHERE phone = $1`, [phone]
        );
        const bid = r.rows[0]?.branch_id;
        if (bid) return await getBranch(bid);
    } catch { /* fall through */ }

    // 2) crm_contacts row (if exists)
    try {
        const r = await pool.query(
            `SELECT branch_id FROM crm_contacts WHERE phone = $1
              AND ($2::text IS NULL OR user_id::text = $2::text)
              LIMIT 1`,
            [phone, scalaUserId]
        );
        const bid = r.rows[0]?.branch_id;
        if (bid) return await getBranch(bid);
    } catch { /* crm_contacts may not have branch_id column on some deploys */ }

    // 3) Match session tag -> branch city
    if (sessionTags && sessionTags.length > 0 && scalaUserId) {
        const lowerTags = sessionTags.map(t => String(t).toLowerCase());
        try {
            const r = await pool.query(
                `SELECT * FROM branches WHERE user_id = $1 AND LOWER(city) = ANY($2::text[]) LIMIT 1`,
                [scalaUserId, lowerTags]
            );
            if (r.rows[0]) return r.rows[0] as Branch;
        } catch { /* ignore */ }
    }

    return null;
}

/**
 * Produce the system-prompt snippet describing the branch. Empty string
 * if no branch.
 */
export function branchContextSnippet(b: Branch | null, lang: string = 'it'): string {
    if (!b) return '';
    const parts: string[] = [];
    if (lang === 'en') {
        parts.push(`The customer visited our ${b.city || b.name || 'branch'} showroom.`);
        if (b.manager_name) {
            parts.push(`The manager there is ${b.manager_name}${b.manager_email ? ` (${b.manager_email})` : ''}.`);
        }
        if (b.phone) parts.push(`Phone: ${b.phone}.`);
        parts.push(`If you need to escalate, contact them.`);
    } else {
        parts.push(`Il cliente ha visitato il nostro showroom di ${b.city || b.name || 'filiale'}.`);
        if (b.manager_name) {
            parts.push(`Il responsabile locale è ${b.manager_name}${b.manager_email ? ` (${b.manager_email})` : ''}.`);
        }
        if (b.phone) parts.push(`Telefono: ${b.phone}.`);
        parts.push(`Se serve, indirizza l'escalation a lui.`);
    }
    return `\n[BRANCH CONTEXT] ${parts.join(' ')}\n`;
}
