// ═══════════════════════════════════════════════════
// S.A.R.A. — SCALA AI Response Agent
// WhatsApp Business Bot + REST API Bridge
// Engine: whatsapp-web.js (NOT Baileys — Baileys removed May 2026)
// ═══════════════════════════════════════════════════
import 'dotenv/config';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

// CRASH-LOOP GUARD REMOVED — systemd handles restart with Restart=always
// The old guard killed the process after 5 restarts, causing WA session revocation.
// Now systemd restarts immediately (RestartSec=3) without limits.

// Start S.A.R.A. API bridge (runs on port 3006)
import './sara-api.js';

import { BOT_NAME } from './config.js';
import { initDB, getSession, upsertSession, logMessage } from './db.js';
import { detectMediaType, extractLocation, extractContacts } from './media.js';
import { handleText } from './handlers/text.js';
import { handleAudio } from './handlers/audio.js';
import { handleImage } from './handlers/image.js';
import { handleDocument } from './handlers/document.js';
import { startFollowupScheduler } from './followup.js';
import { sendHumanized } from './humanize.js';
// WA ENGINE: whatsapp-web.js (real Chromium, stable sessions, lower ban risk)
// Baileys adapter REMOVED (May 2026) — wa-hardened-adapter.ts is dead code
import { createWWJSBot, type SockLike } from './wa-adapter.js';
import { setActiveSock } from './lib/sock-registry.js';
import { startCrmSyncDrainLoop } from './crm-sync.js';
import { loadTakeoverStates } from './lib/human-takeover.js';
import { enqueueUserMessage } from './user-queue.js';
import { initSectorEmbeddings } from './sectors.js';
import { startAlertScheduler } from './lib/proactive-alerts.js';
import { initOutreach } from './lib/safe-outreach.js';
import {
    isSilentGroup,
    processGroupMessageSilently,
    detectSilentGroupCommand,
    handleSilentGroupCommand,
    ensureSilentGroupsSchema,
    startSilentGroupFlushTimer,
} from './handlers/group-silent.js';
import { restoreAllSessions } from './lib/multi-session.js';
import { startDreamScheduler } from './lib/dream-cycle.js';
import { ensureFactsColumn, digestAllPending } from './lib/fact-predigest.js';
import { redactPhone } from './lib/phone-utils.js';

// ─── Per-user rate limiting (max 5 msgs per 30s) ───
const rateLimitMap = new Map<string, number[]>();
function isRateLimited(phone: string): boolean {
    // Evict if map exceeds safe size (10K unique users in 30s window is extreme)
    if (rateLimitMap.size > 10000) {
        // Evict oldest half by clearing and letting active users re-populate
        rateLimitMap.clear();
    }
    const now = Date.now();
    const timestamps = rateLimitMap.get(phone) || [];
    const recent = timestamps.filter(t => now - t < 30000);
    if (recent.length >= 5) { rateLimitMap.set(phone, recent); return true; }
    recent.push(now);
    rateLimitMap.set(phone, recent);
    return false;
}
setInterval(() => { rateLimitMap.clear(); }, 300000).unref();

async function startBot() {
    await initDB();

    // ── Schema bootstrap for tenant config + branches (2026-04-16) ──
    try {
        const { ensureTenantColumns } = await import('./lib/tenant-config.js');
        const { ensureBranchesSchema } = await import('./lib/branches.js');
        await ensureTenantColumns();
        await ensureBranchesSchema();
    } catch (err: any) {
        console.warn('[BOOT] schema ensure failed (non-fatal):', err?.message);
    }

    // ── Schema bootstrap for L4/L5/L6 persistent memory (2026-05-21) ──
    try {
        const { ensureMemorySchema } = await import('./lib/persistent-memory.js');
        await ensureMemorySchema();
    } catch (err: any) {
        console.warn('[BOOT] L4/L5/L6 memory schema ensure failed (non-fatal):', err?.message);
    }

    // Pre-warm Ollama availability check so first fallback has no probe latency
    import('./lib/ai-providers.js').then(m => {
        if (typeof (m as any).checkOllama === 'function') {
            (m as any).checkOllama().catch(() => { /* non-fatal */ });
        }
    }).catch(() => { /* non-fatal */ });

    // Fire-and-forget: load / refresh sector embeddings so sector detection
    // is semantic instead of keyword-only (P1 fix 2026-04-12).
    initSectorEmbeddings().catch(err => console.error('[SECTORS] embedding init failed:', err?.message));

    // Start CRM sync drain loop — retries any leads that were queued while
    // the backend was down (P1 fix 2026-04-12).
    startCrmSyncDrainLoop();

    // Load human takeover states from DB
    const { pool } = await import('./db.js');
    loadTakeoverStates(pool).catch(err => console.error('[TAKEOVER] init failed:', err?.message));

    // Bootstrap silent group listener schema + load active groups
    ensureSilentGroupsSchema(pool).catch(err => console.error('[SILENT-GROUP] schema init failed:', err?.message));

    // Start timer that flushes stale group message buffers
    startSilentGroupFlushTimer(pool);

    const { sock, waitForConnection } = await createWWJSBot();

    // Wait for WhatsApp Business connection (QR scan)
    await waitForConnection();

    // Register active sock so sara-api can send outbound messages
    setActiveSock(sock);

    // Start follow-up scheduler
    startFollowupScheduler(sock as any);

    // Start proactive alert scheduler (Feature 3)
    startAlertScheduler();

    // Bootstrap facts_json column + digest pending docs
    ensureFactsColumn().then(() => digestAllPending()).catch(err =>
        console.warn('[PREDIGEST] init failed (non-fatal):', err?.message)
    );

    // Start dream cycle scheduler (pre-computes responses during off-peak hours)
    startDreamScheduler();

    // Initialize safe outreach system (Feature 5)
    initOutreach(sock as any);

    // Restore SOLO SARA multi-sessions (each customer's own WhatsApp)
    restoreAllSessions().catch(err =>
        console.error('[SOLO-SESSION] restore failed (non-fatal):', err?.message)
    );

    sock.ev.on('messages.upsert', async ({ messages }) => {
        for (const msg of messages) {
            if (!msg.message || msg.key.fromMe) continue;
            const phone = msg.key.remoteJid!;
            const realPhone = (msg as any)._realPhone as string | undefined;

            // ─── SKIP BROADCAST / STATUS / NEWSLETTER ───
            // SARA only handles 1:1 chats and explicitly-monitored groups.
            if (phone === 'status@broadcast' || phone.endsWith('@broadcast') || phone.includes('@newsletter')) {
                continue;
            }

            // ─── SILENT GROUP LISTENER ───
            // Intercept group messages BEFORE any other processing.
            // If the group is marked for silent listening, process silently and skip.
            if (phone.endsWith('@g.us') && isSilentGroup(phone)) {
                const senderJid = (msg.key.participant as string) || phone;
                const senderName = (msg as any).pushName || senderJid.split('@')[0];
                const msgText = msg.message?.conversation
                    || msg.message?.extendedTextMessage?.text || '';
                if (msgText) {
                    const { pool: dbPool } = await import('./db.js');
                    // Resolve group name (best-effort, fallback to JID)
                    let groupName = phone;
                    try {
                        if ((sock as any).groupMetadata) {
                            const meta = await (sock as any).groupMetadata(phone);
                            groupName = meta?.subject || phone;
                        }
                    } catch { /* use JID as fallback name */ }

                    processGroupMessageSilently(
                        phone, groupName, senderJid, senderName, msgText, 'text', dbPool
                    ).catch(err => console.error(`[SILENT-GROUP] ${redactPhone(phone)}: ${err?.message}`));
                }
                continue; // Don't respond in the group
            }

            // ─── SKIP ALL NON-SILENT GROUPS ───
            // SARA only monitors groups explicitly added to the silent listener.
            // Any other group message is ignored to prevent unsolicited replies.
            if (phone.endsWith('@g.us')) {
                console.log('[SKIP] group msg from non-silent group');
                continue;
            }

            // ─── RATE LIMITING ───
            if (isRateLimited(phone)) {
                console.log(`[RATE] ${redactPhone(phone)} rate limited (>5 msgs/30s)`);
                continue;
            }

            // Serialize all work per user so 3 rapid messages can't produce
            // out-of-order replies.
            enqueueUserMessage(phone, () => processIncomingMessage(sock, msg, phone, realPhone))
                .catch(async (err) => {
                    if (err?.message === 'user queue full') {
                        // Notify user instead of silently dropping
                        const session = await import('./db.js').then(m => m.getSession(phone)).catch(() => null);
                        const lang = (session as any)?.user_language || 'it';
                        const busyMsgs: Record<string, string> = {
                            it: 'Sto elaborando i tuoi messaggi precedenti, dammi un attimo! ⏳',
                            en: "I'm still processing your previous messages, give me a moment! ⏳",
                            es: 'Todavía estoy procesando tus mensajes anteriores, ¡dame un momento! ⏳',
                            pt: 'Ainda estou processando suas mensagens anteriores, me dê um momento! ⏳',
                        };
                        try { await sock.sendMessage(phone, { text: busyMsgs[lang] || busyMsgs.it }); } catch { /* ignore */ }
                    }
                });
        }
    });
}

// Extracted so we can feed it to the per-user queue. Handles media routing,
// opt-out, session upkeep, errors. NOTE: original loop `continue` statements
// were rewritten as `return` because we're now per-message, not per-batch.
async function processIncomingMessage(sock: any, msg: any, phone: string, realPhone: string | undefined): Promise<void> {
    let session = await getSession(phone);
    if (!session) {
        await upsertSession(phone, { sector: 'general' });
        session = await getSession(phone);
    }

    // Real phone resolved from LID: there is NO column to persist it into.
    // wa_sessions has no `real_phone` column (and `phone_display` is a different concern,
    // owned by the language/profiling handlers), so the previous UPDATE always threw and
    // was silently swallowed by an empty catch. Logged instead of persisted until a
    // migration adds a real column.
    if (realPhone && session) {
        console.debug(`[LID] Resolved real phone for session ${phone} (not persisted: no wa_sessions column)`);
    }

    // ─── OPT-OUT CHECK ───
    const msgText = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
    if (session?.opted_out) {
        if (/riattiva|reactivate|resubscribe/i.test(msgText)) {
            await upsertSession(phone, { opted_out: false } as any);
            await sendHumanized(sock, phone, 'Bentornato! 🎉 Sono di nuovo qui per aiutarti. Come posso esserti utile?');
        }
        return; // Silently ignore opted-out users
    }
    // ─── GDPR OPT-OUT DETECTION ───
    if (/\b(stop|basta|cancella|non mi contattare|disiscrivi|unsubscribe|opt.?out)\b/i.test(msgText)) {
        await upsertSession(phone, { opted_out: true } as any);
        await sendHumanized(sock, phone, 'Hai scelto di non ricevere più messaggi. Per riattivare, scrivi "riattiva". Grazie! 🙏');
        return;
    }

    // Route by media type
    const mediaType = detectMediaType(msg);

    try {
        switch (mediaType) {
            case 'audio':
                // Update session for counting
                await upsertSession(phone, {});
                session = await getSession(phone);
                await handleAudio(sock, msg, session);
                break;

            case 'image':
                await upsertSession(phone, {});
                session = await getSession(phone);
                await handleImage(sock, msg, session);
                break;

            case 'document':
                await upsertSession(phone, {});
                session = await getSession(phone);
                await handleDocument(sock, msg, session);
                break;

            case 'video': {
                await upsertSession(phone, {});
                session = await getSession(phone);
                const videoLang = session?.user_language || 'it';
                const videoMsgs: Record<string, string> = {
                    it: 'Ho ricevuto il video! Al momento posso analizzare testo, vocali, immagini e PDF. Il supporto video completo arriva presto 🎬',
                    en: 'I received the video! Right now I can analyze text, voice notes, images and PDFs. Full video support is coming soon 🎬',
                    es: '¡Recibí el video! Por ahora puedo analizar texto, audios, imágenes y PDFs. El soporte completo de video llega pronto 🎬',
                    pt: 'Recebi o vídeo! Por enquanto posso analisar texto, áudios, imagens e PDFs. O suporte completo a vídeo chega em breve 🎬',
                };
                await sendHumanized(sock, phone, videoMsgs[videoLang] || videoMsgs.it);
                break;
            }

            case 'location': {
                const loc = extractLocation(msg);
                if (loc) {
                    const lang = session?.user_language || 'it';
                    const locMsgs: Record<string, string> = {
                        it: `📍 Posizione ricevuta! Coordinate: ${loc.lat.toFixed(5)}, ${loc.lng.toFixed(5)}${loc.address ? `\nIndirizzo: ${loc.address}` : ''}\n\nPosso aiutarti con informazioni su questa zona, analisi immobiliari o altro? 🗺️`,
                        en: `📍 Location received! Coordinates: ${loc.lat.toFixed(5)}, ${loc.lng.toFixed(5)}${loc.address ? `\nAddress: ${loc.address}` : ''}\n\nCan I help you with information about this area, property analysis, or anything else? 🗺️`,
                        es: `📍 ¡Ubicación recibida! Coordenadas: ${loc.lat.toFixed(5)}, ${loc.lng.toFixed(5)}${loc.address ? `\nDirección: ${loc.address}` : ''}\n\n¿Puedo ayudarte con información sobre esta zona, análisis inmobiliario u otra cosa? 🗺️`,
                        pt: `📍 Localização recebida! Coordenadas: ${loc.lat.toFixed(5)}, ${loc.lng.toFixed(5)}${loc.address ? `\nEndereço: ${loc.address}` : ''}\n\nPosso ajudá-lo com informações sobre esta área, análise imobiliária ou outra coisa? 🗺️`,
                    };
                    await sendHumanized(sock, phone, locMsgs[lang] || locMsgs.it);
                    await logMessage(phone, 'in', `[posizione: ${loc.lat},${loc.lng}]`, 'location' as any);
                }
                break;
            }

            case 'contact': {
                const contacts = extractContacts(msg);
                if (contacts.length > 0) {
                    const lang = session?.user_language || 'it';
                    const names = contacts.map(c => c.displayName).filter(Boolean).join(', ');
                    const phones = contacts.map(c => c.phone).filter(Boolean).join(', ');
                    const extras = phones ? ` (${phones})` : '';
                    const contactMsgs: Record<string, string> = {
                        it: `👤 Ho ricevuto ${contacts.length === 1 ? 'il contatto' : `${contacts.length} contatti`}: ${names || 'senza nome'}${extras}.\n\nVuoi che lo aggiunga al tuo CRM? Dimmi pure! 📋`,
                        en: `👤 I received ${contacts.length === 1 ? 'the contact' : `${contacts.length} contacts`}: ${names || 'unnamed'}${extras}.\n\nWould you like me to add ${contacts.length === 1 ? 'it' : 'them'} to your CRM? Just let me know! 📋`,
                        es: `👤 Recibí ${contacts.length === 1 ? 'el contacto' : `${contacts.length} contactos`}: ${names || 'sin nombre'}${extras}.\n\n¿Quieres que lo agregue a tu CRM? ¡Dímelo! 📋`,
                        pt: `👤 Recebi ${contacts.length === 1 ? 'o contato' : `${contacts.length} contatos`}: ${names || 'sem nome'}${extras}.\n\nQuer que eu adicione ao seu CRM? É só falar! 📋`,
                    };
                    await sendHumanized(sock, phone, contactMsgs[lang] || contactMsgs.it);
                    await logMessage(phone, 'in', `[contatto: ${names}${phones ? ` tel:${phones}` : ''}]`, 'contact' as any);
                }
                break;
            }

            case 'sticker': {
                const lang = session?.user_language || 'it';
                const stickerMsgs: Record<string, string> = {
                    it: '😄 Bella sticker! Posso rispondere meglio a messaggi di testo, vocali, immagini e documenti. Come posso aiutarti?',
                    en: '😄 Nice sticker! I respond better to text messages, voice notes, images and documents. How can I help you?',
                    es: '😄 ¡Buen sticker! Puedo responder mejor a mensajes de texto, notas de voz, imágenes y documentos. ¿Cómo puedo ayudarte?',
                    pt: '😄 Ótimo sticker! Respondo melhor a mensagens de texto, áudios, imagens e documentos. Como posso ajudá-lo?',
                };
                await sendHumanized(sock, phone, stickerMsgs[lang] || stickerMsgs.it);
                break;
            }

            case 'text':
                await handleText(sock, msg, session);
                break;

            default:
                // Unknown media: ignore silently
                console.log(`[SKIP] ${redactPhone(phone)}: unknown media type`);
                break;
        }
    } catch (err: any) {
        console.error(`[ERROR] ${redactPhone(phone)} (${mediaType}):`, err.message);
        try {
            await sock.sendMessage(phone, {
                text: '⚠️ Si è verificato un errore. Riprova tra poco! 🔧'
            });
        } catch { /* ignore send errors */ }
    }
}

startBot().catch(err => {
    console.error(`\n⚠️ [S.A.R.A. Bot] Failed to start WhatsApp bot: ${err.message}`);
    console.error(`💡 The S.A.R.A. API bridge on port ${process.env.SARA_API_PORT || 3006} is still running.`);
    console.error(`   Bot requires: PostgreSQL running + at least one of GROQ_API_KEY / CEREBRAS_API_KEY / MISTRAL_API_KEY in .env`);
    console.error(`   Fix: Check DATABASE_URL in .env and ensure PostgreSQL is running.\n`);
    // Don't exit — keep the S.A.R.A. API bridge alive
});
