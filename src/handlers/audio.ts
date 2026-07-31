// ═══════════════════════════════════════════════════
// SCALA WhatsApp Bot — Audio Handler (v4 — Voice-to-CRM)
// v4: Transcribe first, check for CRM commands, then fall through to AI.
// v3: Multilingual direct response (no transcription echo).
// ═══════════════════════════════════════════════════
type WASocket = any;
type WAMessage = any;
import { downloadMedia } from '../media.js';
import { getMultimodalAIResponse, storeInRAG } from '../ai.js';
import { logMessage, updateLeadScore } from '../db.js';
import { sendHumanized } from '../humanize.js';
import { transcribeChain } from '../lib/ai-providers.js';
import { handleVoiceCRM } from './voice-crm.js';
import { redactPhone } from '../lib/phone-utils.js';
import { guardOutput } from '../lib/output-guard.js';

// Multilingual messages
const MESSAGES: Record<string, { error: string; prompt: string; ragPrefix: string }> = {
    it: {
        error: 'Non sono riuscita a ricevere il vocale, puoi riprovare? 🙏',
        prompt: `L'utente ha inviato un messaggio vocale WhatsApp. Ascolta attentamente e rispondi direttamente alla richiesta o domanda dell'utente.
IMPORTANTE: NON trascrivere ciò che l'utente ha detto. NON usare formati come "Trascrizione:" o "Hai detto:". Rispondi direttamente come in una conversazione naturale.`,
        ragPrefix: "Contenuto vocale dell'utente (riassunto AI):",
    },
    en: {
        error: "I couldn't receive the voice message, can you try again? 🙏",
        prompt: `The user sent a WhatsApp voice message. Listen carefully and respond directly to the user's request or question.
IMPORTANT: Do NOT transcribe what the user said. Do NOT use formats like "Transcription:" or "You said:". Respond directly as in a natural conversation.`,
        ragPrefix: "User voice content (AI summary):",
    },
    es: {
        error: 'No pude recibir el mensaje de voz, ¿puedes intentar de nuevo? 🙏',
        prompt: `El usuario envió un mensaje de voz de WhatsApp. Escucha atentamente y responde directamente a la solicitud o pregunta del usuario.
IMPORTANTE: NO transcribas lo que el usuario dijo. NO uses formatos como "Transcripción:" o "Dijiste:". Responde directamente como en una conversación natural.`,
        ragPrefix: "Contenido vocal del usuario (resumen IA):",
    },
    pt: {
        error: 'Não consegui receber a mensagem de voz, pode tentar de novo? 🙏',
        prompt: `O usuário enviou uma mensagem de voz do WhatsApp. Escute com atenção e responda diretamente à solicitação ou pergunta do usuário.
IMPORTANTE: NÃO transcreva o que o usuário disse. NÃO use formatos como "Transcrição:" ou "Você disse:". Responda diretamente, como em uma conversa natural.`,
        ragPrefix: "Conteúdo de voz do usuário (resumo IA):",
    },
};

export async function handleAudio(
    sock: WASocket,
    msg: WAMessage,
    session: any
): Promise<void> {
    const phone = msg.key.remoteJid!;
    const lang = session?.user_language || 'it';
    const msgs = MESSAGES[lang] || MESSAGES.it;

    // NO robotic "Sto ascoltando..." message — just show composing like a human would
    try {
        await sock.sendPresenceUpdate('composing', phone);
    } catch { /* ignore */ }

    const media = await downloadMedia(msg);
    if (!media) {
        await sendHumanized(sock, phone, msgs.error);
        return;
    }

    await logMessage(phone, 'in', '[vocale]', 'audio');
    await updateLeadScore(phone, 3); // Voice notes = higher engagement

    // ─── Step 1: Try to transcribe audio for CRM command detection ───
    let transcription: string | null = null;
    try {
        const result = await transcribeChain(media.buffer, media.mimetype || 'audio/ogg', lang);
        transcription = result.text;
        console.log(`[AUDIO] Transcription (${result.provider}): ${transcription.substring(0, 120)}`);
    } catch (err: any) {
        // Transcription failed — fall through to multimodal AI.
        // NOTE (2026-07-17): with Gemini removed, getMultimodalAIResponse() re-runs
        // transcribeChain() for audio, i.e. the same Groq Whisper that just failed.
        // This fall-through is now a formality: expect the graceful error message.
        console.log(`[AUDIO] Transcription unavailable: ${err.message}, falling through to multimodal`);
    }

    // ─── Step 2: Check if the voice message is a CRM command ───
    if (transcription && transcription.length >= 5) {
        try {
            const crmResponse = await handleVoiceCRM(
                transcription,
                phone,
                session?.scala_user_id
            );

            if (crmResponse) {
                // It was a CRM command — send the confirmation and return
                const sector = session?.sector || 'general';
                await storeInRAG(
                    `${msgs.ragPrefix} [CRM COMMAND] ${transcription.substring(0, 200)}`,
                    sector,
                    `Vocale CRM da ${phone.split('@')[0]} (${new Date().toLocaleDateString(lang === 'en' ? 'en-US' : lang === 'es' ? 'es-ES' : lang === 'pt' ? 'pt-BR' : 'it-IT')})`
                );

                await sendHumanized(sock, phone, crmResponse);
                console.log(`[AUDIO] ${redactPhone(phone)}: CRM command executed (${(media.buffer.length / 1024).toFixed(0)}KB)`);
                return;
            }
        } catch (err: any) {
            // CRM handler failed — fall through to normal AI response
            console.error(`[AUDIO] Voice-CRM error (falling through): ${err.message}`);
        }
    }

    // ─── Step 3: Normal AI response (not a CRM command) ───
    const base64Audio = media.buffer.toString('base64');

    const parts = [
        { inline_data: { mime_type: media.mimetype || 'audio/ogg', data: base64Audio } },
        { text: msgs.prompt },
    ];

    let response = await getMultimodalAIResponse(parts, session, 'messaggio vocale', phone);
    if (!response || response.trim().length < 3) {
        // AI completely unavailable — at least acknowledge the voice note
        const fallbacks: Record<string, string> = {
            it: 'Ho ricevuto il tuo vocale ma al momento non riesco ad elaborarlo. Puoi scrivermi lo stesso messaggio in testo? 🙏',
            en: "I received your voice message but can't process it right now. Could you write the same message in text? 🙏",
            es: 'Recibí tu mensaje de voz pero no puedo procesarlo ahora. ¿Podrías escribirme el mismo mensaje en texto? 🙏',
            pt: 'Recebi seu áudio mas não consigo processar agora. Pode me escrever a mesma mensagem em texto? 🙏',
        };
        response = fallbacks[lang] || fallbacks.it;
    }

    // Store audio context in RAG (internal, not shown to user)
    const sector = session?.sector || 'general';
    await storeInRAG(
        `${msgs.ragPrefix} ${response.substring(0, 200)}`,
        sector,
        `Vocale da ${phone.split('@')[0]} (${new Date().toLocaleDateString(lang === 'en' ? 'en-US' : lang === 'es' ? 'es-ES' : lang === 'pt' ? 'pt-BR' : 'it-IT')})`
    );

    // FIX #2: route media AI output through the same guardrails as text.ts
    response = guardOutput(response, lang, { phone });

    await sendHumanized(sock, phone, response);
    console.log(`[AUDIO] ${redactPhone(phone)}: ${(media.buffer.length / 1024).toFixed(0)}KB processed`);
}
