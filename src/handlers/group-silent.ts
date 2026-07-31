// ═══════════════════════════════════════════════════════════════
// SARA Silent Group Listener — Listen-only CRM enrichment
//
// When SARA is added to a WA group marked as "silent", she:
//   1. NEVER sends messages in the group
//   2. Reads every message and buffers them
//   3. Every 5 messages OR 5 minutes, runs batch LLM analysis
//   4. Enriches the CRM contact with extracted business intelligence
//   5. Logs everything to sara_silent_events
//
// Enable via 1:1 message: "SARA ascolta il gruppo [nome]"
// Disable via: "SARA smetti di ascoltare il gruppo [nome]"
// ═══════════════════════════════════════════════════════════════

import type pg from 'pg';
import pino from 'pino';
import { chatChain, hasGroq, hasCerebras, hasMistral } from '../lib/ai-providers.js';

const log = pino({ name: 'group-silent' });

// ─── Types ───────────────────────────────────────────────

interface GroupMessage {
  senderJid: string;
  senderName: string;
  text: string;
  messageType: 'text' | 'image' | 'audio' | 'document';
  timestamp: Date;
}

interface SilentGroupEntry {
  jid: string;
  name: string;
  user_id: string;
  enabled_at: Date;
}

// ─── In-memory state ─────────────────────────────────────

/** Set of group JIDs marked as silent-listen */
const silentGroups = new Map<string, SilentGroupEntry>();

/** Message buffer per group — flushed on threshold */
const messageBuffers = new Map<string, GroupMessage[]>();

/** Last flush timestamp per group */
const lastFlushTime = new Map<string, number>();

// ─── Constants ───────────────────────────────────────────

const BATCH_SIZE = 5;             // Analyze every N messages
const FLUSH_INTERVAL_MS = 5 * 60 * 1000; // Or every 5 minutes
const MAX_BUFFER_SIZE = 50;       // Safety cap to prevent memory leak
const SARA_JID_SUFFIXES = ['@s.whatsapp.net', '@lid'];

// ─── DB Schema Bootstrap ─────────────────────────────────

/**
 * Ensure the sara_silent_groups table exists.
 * Called once at boot. Non-fatal on failure.
 */
export async function ensureSilentGroupsSchema(pool: pg.Pool): Promise<void> {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS sara_silent_groups (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        group_jid TEXT NOT NULL UNIQUE,
        group_name TEXT NOT NULL,
        user_id UUID NOT NULL,
        enabled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        disabled_at TIMESTAMPTZ,
        active BOOLEAN NOT NULL DEFAULT true
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS sara_group_analyses (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        group_jid TEXT NOT NULL,
        group_name TEXT NOT NULL,
        user_id UUID,
        message_count INT NOT NULL DEFAULT 0,
        conversation_preview TEXT,
        analysis JSONB,
        crm_contact_id UUID,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // Load active silent groups into memory
    const res = await pool.query(
      `SELECT group_jid, group_name, user_id, enabled_at
       FROM sara_silent_groups WHERE active = true`
    );
    for (const row of res.rows) {
      silentGroups.set(row.group_jid, {
        jid: row.group_jid,
        name: row.group_name,
        user_id: row.user_id,
        enabled_at: row.enabled_at,
      });
    }
    if (silentGroups.size > 0) {
      log.info({ count: silentGroups.size }, 'loaded silent groups from DB');
    }
  } catch (err: any) {
    log.warn({ err: err?.message }, 'silent groups schema bootstrap failed (non-fatal)');
  }
}

// ─── Public API ──────────────────────────────────────────

/**
 * Check if a group JID is marked for silent listening.
 */
export function isSilentGroup(groupJid: string): boolean {
  return silentGroups.has(groupJid);
}

/**
 * Process a group message silently — NO response is ever sent.
 * Accumulates messages in buffer and triggers batch analysis.
 */
export async function processGroupMessageSilently(
  groupJid: string,
  groupName: string,
  senderJid: string,
  senderName: string,
  messageText: string,
  messageType: 'text' | 'image' | 'audio' | 'document',
  pool: pg.Pool
): Promise<void> {
  // 1. Skip if sender is SARA herself
  if (isSaraSelf(senderJid)) {
    return;
  }

  // 2. Skip empty/trivially short messages
  if (!messageText || messageText.trim().length < 3) {
    return;
  }

  // 3. Accumulate in buffer
  let buffer = messageBuffers.get(groupJid);
  if (!buffer) {
    buffer = [];
    // Start the flush clock when the buffer is actually created, not at
    // epoch 0. Previously `lastFlushTime.get(groupJid) || 0` defaulted to 0
    // for a brand-new group, so `Date.now() - 0` always exceeded
    // FLUSH_INTERVAL_MS and the very first message of a new group triggered
    // an immediate, premature flush of a 1-message "batch".
    lastFlushTime.set(groupJid, Date.now());
  }
  buffer.push({
    senderJid,
    senderName: senderName || 'Unknown',
    text: messageText.trim(),
    messageType,
    timestamp: new Date(),
  });

  // Safety cap — prevent memory leak from high-volume groups
  if (buffer.length > MAX_BUFFER_SIZE) {
    buffer.splice(0, buffer.length - MAX_BUFFER_SIZE);
  }

  messageBuffers.set(groupJid, buffer);

  // 4. Check if we should flush (batch size OR time threshold)
  const lastFlush = lastFlushTime.get(groupJid) ?? Date.now();
  const timeSinceFlush = Date.now() - lastFlush;
  const shouldFlush = buffer.length >= BATCH_SIZE || timeSinceFlush >= FLUSH_INTERVAL_MS;

  if (shouldFlush && buffer.length > 0) {
    // Take the buffer and clear it
    const messagesToAnalyze = [...buffer];
    messageBuffers.set(groupJid, []);
    lastFlushTime.set(groupJid, Date.now());

    // Fire-and-forget — analysis errors must never block message processing
    analyzeGroupConversation(messagesToAnalyze, groupJid, groupName, pool).catch(err => {
      log.error({ err: err?.message, groupJid }, 'group conversation analysis failed');
    });
  }
}

// ─── Batch Analysis ──────────────────────────────────────

/**
 * Neutral fallback analysis object. Used whenever the LLM call fails,
 * returns nothing (e.g. no AI provider configured), or its output cannot
 * be parsed as JSON. Keeping this in one place avoids the two fallback
 * literals drifting apart and guarantees `analysis` is NEVER null when
 * downstream code reads `analysis.sentiment` / `analysis.*`.
 */
function defaultAnalysis(): Record<string, any> {
  return {
    client_name: null, client_company: null, client_email: null, client_phone: null,
    budget_signals: [], pain_points: [], competitor_mentions: [],
    decision_timeline: null, sentiment: 'neutral', action_items: [],
    key_topics: [], deal_stage: 'initial',
  };
}

async function analyzeGroupConversation(
  messages: GroupMessage[],
  groupJid: string,
  groupName: string,
  pool: pg.Pool
): Promise<void> {
  const entry = silentGroups.get(groupJid);
  const userId = entry?.user_id || null;

  // Build conversation context
  const context = messages
    .map(m => `[${m.senderName}]: ${m.text}`)
    .join('\n');

  // Truncate for LLM
  const truncatedContext = context.length > 3000
    ? context.slice(0, 3000) + '\n...[truncated]'
    : context;

  const prompt = `You are a business communication analyst for a CRM system.
Analyze this WhatsApp group conversation between business operators and clients.
Group name: "${groupName}"

Conversation:
---
${truncatedContext}
---

Extract a JSON object with EXACTLY these keys (return ONLY valid JSON, no markdown, no code fences):
{
  "client_name": "name of the client (NOT the operator/salesperson) or null",
  "client_company": "company name if mentioned or null",
  "client_email": "email if mentioned or null",
  "client_phone": "phone number if mentioned or null",
  "budget_signals": ["any budget/price/cost mentions, e.g. 'budget 500K'"],
  "pain_points": ["problems, needs, or complaints expressed"],
  "competitor_mentions": ["other products, services, or platforms mentioned"],
  "decision_timeline": "deadline or timeline mentioned, or null",
  "sentiment": "positive" or "neutral" or "negative",
  "action_items": ["follow-ups, tasks, or next steps mentioned"],
  "key_topics": ["main discussion topics"],
  "deal_stage": "initial" or "qualifying" or "proposal" or "negotiation" or "closing"
}`;

  let analysis: any = null;

  try {
    const raw = await callLlmRaw(prompt);
    if (raw) {
      analysis = parseJsonResponse(raw);
    } else {
      // callLlmRaw returns null (does NOT throw) when no provider is
      // configured. Without this branch, `analysis` stayed null here,
      // `analysis.sentiment` below threw a TypeError, the outer catch
      // ("failed to store group analysis") swallowed it, and the whole
      // batch was lost because the buffer had already been cleared before
      // this function ran.
      log.warn(
        { groupJid, groupName, messageCount: messages.length },
        'callLlmRaw returned no content (no AI provider configured) — using fallback analysis so this batch is not lost'
      );
      analysis = defaultAnalysis();
    }
  } catch (err: any) {
    log.error(
      { err: err?.message, groupJid, groupName, messageCount: messages.length },
      'LLM analysis failed for group conversation — using fallback analysis so this batch is not lost'
    );
    analysis = defaultAnalysis();
  }

  // GDPR: truncate conversation preview for storage
  const preview = context.slice(0, 500);

  // 1. Log in sara_group_analyses
  let crmContactId: string | null = null;
  try {
    // 2. Enrich CRM contact if we have identifying info
    if (userId) {
      crmContactId = await enrichCRMFromGroupAnalysis(analysis, userId, groupName, pool);
    }

    await pool.query(
      `INSERT INTO sara_group_analyses
        (group_jid, group_name, user_id, message_count, conversation_preview, analysis, crm_contact_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        groupJid,
        groupName,
        userId,
        messages.length,
        preview,
        JSON.stringify(analysis),
        crmContactId,
      ]
    );

    log.info({
      groupJid,
      groupName,
      messageCount: messages.length,
      clientName: analysis.client_name || 'unknown',
      sentiment: analysis.sentiment,
      dealStage: analysis.deal_stage,
      crmContactId,
    }, 'group conversation analyzed');
  } catch (err: any) {
    log.error(
      { err: err?.message, groupJid, groupName, messageCount: messages.length },
      'failed to store group analysis — this batch of buffered messages is now lost (buffer was already cleared before analysis ran)'
    );
  }

  // 3. Fire alert to the backend Silent Engine via HTTP (if configured)
  try {
    const backendUrl = process.env.SCALA_BACKEND_URL;
    const saraKey = process.env.SARA_API_KEY;
    if (backendUrl && saraKey && userId) {
      await fetch(`${backendUrl}/api/sara/silent-event`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Sara-Api-Key': saraKey,
        },
        body: JSON.stringify({
          channel: 'whatsapp_group',
          direction: 'inbound',
          from: analysis.client_phone || analysis.client_name || groupName,
          to: groupName,
          content: context.slice(0, 2000),
          media_type: 'text',
          metadata: { group_jid: groupJid, group_name: groupName, analysis },
          timestamp: new Date().toISOString(),
          user_id: userId,
        }),
        signal: AbortSignal.timeout(10000),
      }).catch(() => { /* non-fatal */ });
    }
  } catch {
    // Silent engine integration is optional — non-fatal
  }
}

// ─── CRM Enrichment ─────────────────────────────────────

async function enrichCRMFromGroupAnalysis(
  analysis: any,
  userId: string,
  groupName: string,
  pool: pg.Pool
): Promise<string | null> {
  // Build tags from analysis
  const tags: string[] = ['group_listener', `group:${groupName.replace(/[^a-z0-9_\-]/gi, '_').slice(0, 50)}`];

  if (analysis.sentiment === 'negative') tags.push('negative_sentiment');
  if (analysis.sentiment === 'positive') tags.push('positive_sentiment');
  if (analysis.deal_stage) tags.push(`stage:${analysis.deal_stage}`);
  // `analysis` is unvalidated LLM JSON (see parseJsonResponse). `|| []` only
  // guards against null/undefined — if the model returns a string instead of
  // an array (e.g. competitor_mentions: "nessuno"), `("nessuno" || []).length`
  // is 7 (> 0), so callers below must use Array.isArray() instead.
  if (Array.isArray(analysis.competitor_mentions) && analysis.competitor_mentions.length > 0) tags.push('competitor_mentioned');
  if (Array.isArray(analysis.budget_signals) && analysis.budget_signals.length > 0) tags.push('budget_mentioned');
  if (Array.isArray(analysis.pain_points) && analysis.pain_points.length > 0) tags.push('has_pain_points');

  // Build enrichment notes
  const noteParts: string[] = [];
  noteParts.push(`[${new Date().toISOString().slice(0, 16)}] Group: ${groupName}`);
  if (analysis.deal_stage) noteParts.push(`Deal stage: ${analysis.deal_stage}`);
  if (analysis.sentiment) noteParts.push(`Sentiment: ${analysis.sentiment}`);
  if (analysis.decision_timeline) noteParts.push(`Timeline: ${analysis.decision_timeline}`);
  if (Array.isArray(analysis.budget_signals) && analysis.budget_signals.length > 0) {
    noteParts.push(`Budget: ${analysis.budget_signals.join(', ')}`);
  }
  if (Array.isArray(analysis.pain_points) && analysis.pain_points.length > 0) {
    noteParts.push(`Pain points: ${analysis.pain_points.join(', ')}`);
  }
  if (Array.isArray(analysis.competitor_mentions) && analysis.competitor_mentions.length > 0) {
    noteParts.push(`Competitors: ${analysis.competitor_mentions.join(', ')}`);
  }
  if (Array.isArray(analysis.action_items) && analysis.action_items.length > 0) {
    noteParts.push(`Actions: ${analysis.action_items.join(', ')}`);
  }
  const noteText = noteParts.join(' | ');

  // Build data JSONB with analysis fields
  const dataJson: Record<string, any> = {};
  if (analysis.decision_timeline) dataJson.decision_timeline = analysis.decision_timeline;
  if (Array.isArray(analysis.budget_signals) && analysis.budget_signals.length > 0) dataJson.budget_signals = analysis.budget_signals;
  if (Array.isArray(analysis.pain_points) && analysis.pain_points.length > 0) dataJson.pain_points = analysis.pain_points;
  if (Array.isArray(analysis.competitor_mentions) && analysis.competitor_mentions.length > 0) dataJson.competitor_mentions = analysis.competitor_mentions;
  if (Array.isArray(analysis.action_items) && analysis.action_items.length > 0) dataJson.action_items = analysis.action_items;
  if (Array.isArray(analysis.key_topics) && analysis.key_topics.length > 0) dataJson.key_topics = analysis.key_topics;
  if (analysis.deal_stage) dataJson.deal_stage = analysis.deal_stage;
  dataJson.last_group_analysis = new Date().toISOString();
  dataJson.source_group = groupName;

  // Determine how to identify the contact
  const clientName = analysis.client_name || null;
  const clientPhone = analysis.client_phone?.replace(/[\s\-()]/g, '') || null;
  const clientEmail = analysis.client_email || null;
  const clientCompany = analysis.client_company || null;

  // We need at least a phone or email to upsert; fallback to name-based lookup
  if (!clientPhone && !clientEmail && !clientName) {
    log.debug({ groupName }, 'no client identifier extracted — skipping CRM enrichment');
    return null;
  }

  try {
    let contactId: string | null = null;

    if (clientPhone) {
      // Phone-based upsert
      const res = await pool.query(
        `INSERT INTO crm_contacts (
           id, user_id, phone, name, company, email,
           source, tags, notes, data,
           last_message_at, wa_messages_count,
           created_at, updated_at
         ) VALUES (
           gen_random_uuid(), $1, $2, $3, $4, $5,
           'whatsapp_group_listener', $6, $7,
           $8::jsonb,
           NOW(), 1,
           NOW(), NOW()
         )
         ON CONFLICT (user_id, phone) WHERE phone IS NOT NULL
         DO UPDATE SET
           name = COALESCE(NULLIF(EXCLUDED.name, ''), crm_contacts.name),
           company = COALESCE(NULLIF(EXCLUDED.company, ''), crm_contacts.company),
           email = COALESCE(NULLIF(EXCLUDED.email, ''), crm_contacts.email),
           tags = (SELECT ARRAY(SELECT DISTINCT unnest(
             COALESCE(crm_contacts.tags, '{}') || COALESCE(EXCLUDED.tags, '{}')
           ))),
           notes = CASE
             WHEN EXCLUDED.notes IS NOT NULL
             THEN COALESCE(crm_contacts.notes, '') || E'\\n' || EXCLUDED.notes
             ELSE crm_contacts.notes
           END,
           data = crm_contacts.data || COALESCE(EXCLUDED.data, '{}'::jsonb),
           last_message_at = NOW(),
           updated_at = NOW()
         RETURNING id`,
        [
          userId,                                       // $1
          clientPhone,                                  // $2
          clientName,                                   // $3
          clientCompany,                                // $4
          clientEmail,                                  // $5
          tags,                                         // $6
          noteText,                                     // $7
          JSON.stringify(dataJson),                     // $8
        ]
      );
      contactId = res.rows[0]?.id || null;
    } else if (clientEmail) {
      // Email-based upsert
      const res = await pool.query(
        `INSERT INTO crm_contacts (
           id, user_id, email, name, company,
           source, tags, notes, data,
           last_message_at,
           created_at, updated_at
         ) VALUES (
           gen_random_uuid(), $1, $2, $3, $4,
           'whatsapp_group_listener', $5, $6,
           $7::jsonb,
           NOW(),
           NOW(), NOW()
         )
         ON CONFLICT (user_id, email) WHERE (deleted_at IS NULL AND email IS NOT NULL AND email <> '')
         DO UPDATE SET
           name = COALESCE(NULLIF(EXCLUDED.name, ''), crm_contacts.name),
           company = COALESCE(NULLIF(EXCLUDED.company, ''), crm_contacts.company),
           tags = (SELECT ARRAY(SELECT DISTINCT unnest(
             COALESCE(crm_contacts.tags, '{}') || COALESCE(EXCLUDED.tags, '{}')
           ))),
           notes = CASE
             WHEN EXCLUDED.notes IS NOT NULL
             THEN COALESCE(crm_contacts.notes, '') || E'\\n' || EXCLUDED.notes
             ELSE crm_contacts.notes
           END,
           data = crm_contacts.data || COALESCE(EXCLUDED.data, '{}'::jsonb),
           last_message_at = NOW(),
           updated_at = NOW()
         RETURNING id`,
        [
          userId,                                       // $1
          clientEmail,                                  // $2
          clientName,                                   // $3
          clientCompany,                                // $4
          tags,                                         // $5
          noteText,                                     // $6
          JSON.stringify(dataJson),                     // $7
        ]
      );
      contactId = res.rows[0]?.id || null;
    } else if (clientName) {
      // Name-only: try to find existing, or create new
      const existing = await pool.query(
        `SELECT id FROM crm_contacts WHERE user_id = $1 AND name ILIKE $2 LIMIT 1`,
        [userId, clientName]
      );
      if (existing.rows.length > 0) {
        contactId = existing.rows[0].id;
        // Update existing
        await pool.query(
          `UPDATE crm_contacts SET
             company = COALESCE($1, company),
             tags = (SELECT ARRAY(SELECT DISTINCT unnest(COALESCE(tags, '{}') || $2::text[]))),
             notes = COALESCE(notes, '') || E'\\n' || $3,
             data = data || $4::jsonb,
             last_message_at = NOW(),
             updated_at = NOW()
           WHERE id = $5`,
          [
            clientCompany,
            tags,
            noteText,
            JSON.stringify(dataJson),
            contactId,
          ]
        );
      } else {
        // Create new contact with name only
        const res = await pool.query(
          `INSERT INTO crm_contacts (
             id, user_id, name, company,
             source, tags, notes, data,
             last_message_at,
             created_at, updated_at
           ) VALUES (
             gen_random_uuid(), $1, $2, $3,
             'whatsapp_group_listener', $4, $5,
             $6::jsonb,
             NOW(),
             NOW(), NOW()
           ) RETURNING id`,
          [userId, clientName, clientCompany, tags, noteText, JSON.stringify(dataJson)]
        );
        contactId = res.rows[0]?.id || null;
      }
    }

    if (contactId) {
      log.info({
        contactId,
        clientName,
        clientPhone: clientPhone ? `***${clientPhone.slice(-4)}` : null,
        groupName,
      }, 'CRM contact enriched from group listener');
    }

    return contactId;
  } catch (err: any) {
    // err.code (e.g. Postgres '42P10' for an ON CONFLICT predicate that
    // doesn't match any unique index) is critical to diagnose failures like
    // this silently — log it plus which identifier branch was attempted.
    log.error({
      err: err?.message,
      errCode: err?.code,
      groupName,
      userId,
      hasPhone: !!clientPhone,
      hasEmail: !!clientEmail,
      hasName: !!clientName,
    }, 'CRM enrichment from group analysis failed');
    return null;
  }
}

// ─── Management: Enable / Disable / List ─────────────────

/**
 * Mark a group as "silent listen" — SARA will silently monitor all messages.
 */
export async function enableSilentGroup(
  groupJid: string,
  groupName: string,
  userId: string,
  pool: pg.Pool
): Promise<void> {
  await pool.query(
    `INSERT INTO sara_silent_groups (group_jid, group_name, user_id, enabled_at, active)
     VALUES ($1, $2, $3, NOW(), true)
     ON CONFLICT (group_jid)
     DO UPDATE SET group_name = $2, user_id = $3, enabled_at = NOW(), active = true, disabled_at = NULL`,
    [groupJid, groupName, userId]
  );

  silentGroups.set(groupJid, {
    jid: groupJid,
    name: groupName,
    user_id: userId,
    enabled_at: new Date(),
  });

  log.info({ groupJid, groupName, userId }, 'silent group listening enabled');
}

/**
 * Remove a group from "silent listen".
 */
export async function disableSilentGroup(groupJid: string, pool: pg.Pool): Promise<void> {
  await pool.query(
    `UPDATE sara_silent_groups SET active = false, disabled_at = NOW() WHERE group_jid = $1`,
    [groupJid]
  );

  silentGroups.delete(groupJid);
  messageBuffers.delete(groupJid);
  lastFlushTime.delete(groupJid);

  log.info({ groupJid }, 'silent group listening disabled');
}

/**
 * List all active silent groups for a user.
 */
export async function listSilentGroups(
  userId: string,
  pool: pg.Pool
): Promise<{ jid: string; name: string }[]> {
  const res = await pool.query(
    `SELECT group_jid AS jid, group_name AS name
     FROM sara_silent_groups
     WHERE user_id = $1 AND active = true
     ORDER BY enabled_at DESC`,
    [userId]
  );
  return res.rows;
}

// ─── Command Detection (1:1 messages) ────────────────────

/**
 * Detect if a 1:1 message is a silent-listen command.
 * Returns the command details or null.
 *
 * Supported commands:
 *   "SARA ascolta il gruppo [nome]"       → enable
 *   "SARA smetti di ascoltare il gruppo [nome]" → disable
 *   "SARA gruppi silenziosi"              → list
 */
export function detectSilentGroupCommand(text: string): {
  action: 'enable' | 'disable' | 'list';
  groupName?: string;
} | null {
  const lower = text.toLowerCase().trim();

  // List command
  if (/\b(gruppi silenziosi|gruppi in ascolto|lista gruppi|silent groups|listening groups)\b/i.test(lower)) {
    return { action: 'list' };
  }

  // Enable: "SARA ascolta il gruppo [nome]"
  const enableMatch = lower.match(
    /(?:sara\s+)?(?:ascolta|listen(?:\s+to)?|monitora|segui)\s+(?:il\s+)?(?:gruppo|group)\s+(.+)/i
  );
  if (enableMatch) {
    return { action: 'enable', groupName: enableMatch[1].trim() };
  }

  // Disable: "SARA smetti di ascoltare il gruppo [nome]"
  const disableMatch = lower.match(
    /(?:sara\s+)?(?:smetti\s+di\s+ascoltare|stop\s+listening|non\s+ascoltare|ignora)\s+(?:il\s+)?(?:gruppo|group)\s+(.+)/i
  );
  if (disableMatch) {
    return { action: 'disable', groupName: disableMatch[1].trim() };
  }

  return null;
}

/**
 * Handle a silent-listen command from a 1:1 chat.
 * Resolves group name to JID by searching SARA's group list.
 * Returns a response message to send back to the user.
 */
export async function handleSilentGroupCommand(
  sock: any,
  senderPhone: string,
  command: { action: 'enable' | 'disable' | 'list'; groupName?: string },
  pool: pg.Pool
): Promise<string> {
  // Resolve user_id from admin
  const { getAdminUserId } = await import('../crm-sync.js');
  const userId = await getAdminUserId();
  if (!userId) {
    return 'Errore: impossibile risolvere l\'utente admin. Configura SCALA_ADMIN_USER_ID.';
  }

  if (command.action === 'list') {
    const groups = await listSilentGroups(userId, pool);
    if (groups.length === 0) {
      return 'Nessun gruppo in ascolto silenzioso al momento.';
    }
    const list = groups.map((g, i) => `${i + 1}. ${g.name}`).join('\n');
    return `Gruppi in ascolto silenzioso:\n${list}`;
  }

  if (!command.groupName) {
    return 'Specifica il nome del gruppo. Esempio: "SARA ascolta il gruppo Trattativa Mario Rossi"';
  }

  // Resolve group name to JID by fetching SARA's group list
  let matchedGroup: { jid: string; name: string } | null = null;
  try {
    if (sock.groupFetchAllParticipating) {
      const groups = await sock.groupFetchAllParticipating();
      const targetLower = command.groupName.toLowerCase();

      for (const [jid, meta] of Object.entries(groups)) {
        const groupMeta = meta as any;
        const name = groupMeta.subject || groupMeta.name || '';
        if (name.toLowerCase().includes(targetLower) || targetLower.includes(name.toLowerCase())) {
          matchedGroup = { jid, name };
          break;
        }
      }
    }
  } catch (err: any) {
    log.warn({ err: err?.message }, 'failed to fetch group list for command');
  }

  if (!matchedGroup) {
    return `Non riesco a trovare il gruppo "${command.groupName}". Assicurati che SARA sia stata aggiunta al gruppo.`;
  }

  if (command.action === 'enable') {
    await enableSilentGroup(matchedGroup.jid, matchedGroup.name, userId, pool);
    return `Ascolto silenzioso attivato per il gruppo "${matchedGroup.name}".\n\nNon scrivero mai nel gruppo — analizzo le conversazioni e arricchisco il CRM automaticamente.`;
  }

  if (command.action === 'disable') {
    if (!silentGroups.has(matchedGroup.jid)) {
      return `Il gruppo "${matchedGroup.name}" non era in ascolto silenzioso.`;
    }
    await disableSilentGroup(matchedGroup.jid, pool);
    return `Ascolto silenzioso disattivato per il gruppo "${matchedGroup.name}".`;
  }

  return 'Comando non riconosciuto.';
}

// ─── Timer-based flush ───────────────────────────────────

/**
 * Start interval that flushes stale buffers (groups with messages
 * sitting for > FLUSH_INTERVAL_MS without hitting BATCH_SIZE).
 */
export function startSilentGroupFlushTimer(pool: pg.Pool): void {
  const timer = setInterval(async () => {
    const now = Date.now();
    for (const [groupJid, buffer] of messageBuffers) {
      // Defensive cleanup: a group can become inactive without going through
      // disableSilentGroup() (e.g. the sara_silent_groups row is flipped to
      // active=false directly in the DB, or a future code path removes it
      // from `silentGroups` without touching these two Maps). Without this
      // check, stale entries in messageBuffers/lastFlushTime are never
      // deleted and both Maps grow without bound over a long-running uptime.
      if (!silentGroups.has(groupJid)) {
        messageBuffers.delete(groupJid);
        lastFlushTime.delete(groupJid);
        log.info({ groupJid }, 'silent group flush timer: dropped stale buffer for a group that is no longer active');
        continue;
      }

      if (buffer.length === 0) continue;
      const lastFlush = lastFlushTime.get(groupJid) ?? now;
      if (now - lastFlush >= FLUSH_INTERVAL_MS) {
        const messages = [...buffer];
        messageBuffers.set(groupJid, []);
        lastFlushTime.set(groupJid, now);

        const entry = silentGroups.get(groupJid);
        const groupName = entry?.name || groupJid;

        analyzeGroupConversation(messages, groupJid, groupName, pool).catch(err => {
          log.error({ err: err?.message, groupJid, groupName, messageCount: messages.length }, 'timer-triggered group analysis failed');
        });
      }
    }
  }, 60_000); // Check every 60 seconds

  if (typeof timer.unref === 'function') timer.unref();
  log.info('silent group flush timer started (60s interval)');
}

// ─── Helpers ─────────────────────────────────────────────

function isSaraSelf(senderJid: string): boolean {
  // In Baileys, the bot's own JID is available on the socket.
  // As a heuristic, we check if this is fromMe (already handled in index.ts)
  // or matches known SARA phone patterns.
  const saraPhone = process.env.SARA_PHONE_NUMBER || '';
  if (saraPhone && senderJid.includes(saraPhone.replace('+', ''))) {
    return true;
  }
  return false;
}

/**
 * Raw LLM call for structured JSON extraction.
 *
 * 2026-07-17: was callGeminiRaw() — a DIRECT generativelanguage.googleapis.com
 * call that bypassed SARA's provider chain entirely. Now routed through
 * chatChain() (Groq → Cerebras → Mistral), the same chain as the rest of SARA.
 *
 * CONTRACT (unchanged, relied upon by analyzeGroupConversation):
 *   - returns null WITHOUT throwing when no provider is configured
 *     (previously: when GEMINI_API_KEY was missing)
 *   - throws when a configured provider chain fails outright
 * Both outcomes must land on defaultAnalysis() in the caller, so the batch of
 * messages is never lost.
 */
async function callLlmRaw(prompt: string): Promise<string | null> {
  if (!hasGroq() && !hasCerebras() && !hasMistral()) {
    log.warn('No AI provider configured (Groq/Cerebras/Mistral) — skipping group analysis');
    return null;
  }

  const { text, provider } = await chatChain(
    [{ role: 'user', content: prompt }],
    1024
  );
  if (!text) {
    throw new Error(`Empty response from ${provider}`);
  }
  log.info({ provider }, 'group analysis served');
  return text;
}

function parseJsonResponse(raw: string): any {
  let cleaned = raw.trim();

  // Strip markdown code fences
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
  }

  try {
    return JSON.parse(cleaned);
  } catch {
    // Try to extract JSON object from response
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch { /* fall through */ }
    }

    log.warn('failed to parse LLM JSON response for group analysis');
    return defaultAnalysis();
  }
}
