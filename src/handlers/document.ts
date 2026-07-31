// ═══════════════════════════════════════════════════
// SCALA WhatsApp Bot — Document Handler (v3 — Multilingual)
// ═══════════════════════════════════════════════════
type WASocket = any;
type WAMessage = any;
import { downloadMedia, extractTextContent, type DownloadResult } from '../media.js';
import { getAIResponse, storeInRAG } from '../ai.js';
import { logMessage, updateLeadScore } from '../db.js';
import { sendHumanized } from '../humanize.js';
import { callBalanceParser, callDataEntry, looksLikeFinancial } from '../lib/backend-api.js';
import { processPropertyListingFromDocument } from './property-listing.js';
import { redactPhone } from '../lib/phone-utils.js';
import { guardOutput } from '../lib/output-guard.js';

// Multilingual messages
// Documents can be up to 25MB (PDFs are text-heavy, we only extract text)
const MAX_DOCUMENT_SIZE_BYTES = 25 * 1024 * 1024;

const MESSAGES: Record<string, {
    processing: (filename: string) => string;
    downloadError: string;
    tooLarge: (filename: string, sizeMB: number) => string;
    notPdf: (filename: string) => string;
    truncated: string;
    promptWithCaption: (filename: string, caption: string, text: string) => string;
    promptNoCaption: (filename: string, text: string) => string;
    truncatedNote: (maxChars: number, totalChars: number) => string;
    chunkingNotice: (pages: number, chunks: number) => string;
    chunkPrompt: (i: number, total: number, text: string) => string;
    chunkCombinePrompt: (summaries: string) => string;
    creditWarning: (credits: number) => string;
}> = {
    it: {
        processing: (f) => `Dammi un momento, sto guardando "${f}" 📄`,
        downloadError: 'Non sono riuscita a scaricare il file, puoi riprovare? 🙏',
        tooLarge: (f, sz) => `Il file "${f}" e' troppo grande (${sz.toFixed(0)}MB). Il limite e' 25MB. Prova a comprimere il PDF o a dividerlo in parti piu' piccole.`,
        notPdf: (f) => `Ho ricevuto "${f}"! Per file Word/Excel, descrivimi il contenuto principale a parole e ti aiuto subito. Oppure inviami una versione PDF per l'analisi completa 📄`,
        truncated: '...documento troncato...',
        promptWithCaption: (f, c, t) => `L'utente ha inviato un PDF "${f}" con questa richiesta: "${c}"\n\nContenuto:\n---\n${t}\n---\n\nAnalizza e rispondi alla richiesta.`,
        promptNoCaption: (f, t) => `L'utente ha inviato un PDF "${f}". Fai un riepilogo con i punti chiave.\n\nContenuto:\n---\n${t}\n---`,
        truncatedNote: (max, total) => `\n\n_Nota: ho analizzato i primi ${max} caratteri su ${total} totali._`,
        chunkingNotice: (pages, chunks) => `Documento lungo (~${pages} pagine). Analizzo le prime ~50 pagine, serviranno ${chunks} crediti AI.`,
        chunkPrompt: (i, total, text) => `Analizza questa parte ${i}/${total} del documento e fornisci un riassunto dei punti chiave:\n\n---\n${text}\n---`,
        chunkCombinePrompt: (summaries) => `Ecco i riassunti delle diverse parti di un documento lungo. Combina tutto in un unico riassunto coerente e completo con i punti chiave:\n\n${summaries}`,
        creditWarning: (credits) => `_Questo documento richiede ${credits} crediti dei tuoi 17 giornalieri._`,
    },
    en: {
        processing: (f) => `Give me a moment, I'm looking at "${f}" 📄`,
        downloadError: "I couldn't download the file, can you try again? 🙏",
        tooLarge: (f, sz) => `The file "${f}" is too large (${sz.toFixed(0)}MB). The limit is 25MB. Try compressing the PDF or splitting it into smaller parts.`,
        notPdf: (f) => `I received "${f}"! For Word/Excel files, describe the main content in words and I'll help you right away. Or send me a PDF version for full analysis 📄`,
        truncated: '...document truncated...',
        promptWithCaption: (f, c, t) => `The user sent a PDF "${f}" with this request: "${c}"\n\nContent:\n---\n${t}\n---\n\nAnalyze and respond to the request.`,
        promptNoCaption: (f, t) => `The user sent a PDF "${f}". Provide a summary with key points.\n\nContent:\n---\n${t}\n---`,
        truncatedNote: (max, total) => `\n\n_Note: I analyzed the first ${max} characters out of ${total} total._`,
        chunkingNotice: (pages, chunks) => `Long document (~${pages} pages). Analyzing the first ~50 pages, this will use ${chunks} AI credits.`,
        chunkPrompt: (i, total, text) => `Analyze this part ${i}/${total} of the document and provide a summary of the key points:\n\n---\n${text}\n---`,
        chunkCombinePrompt: (summaries) => `Here are summaries of different parts of a long document. Combine everything into a single coherent and complete summary with key points:\n\n${summaries}`,
        creditWarning: (credits) => `_This document requires ${credits} of your 17 daily credits._`,
    },
    es: {
        processing: (f) => `Dame un momento, estoy revisando "${f}" 📄`,
        downloadError: 'No pude descargar el archivo, ¿puedes intentar de nuevo? 🙏',
        tooLarge: (f, sz) => `El archivo "${f}" es demasiado grande (${sz.toFixed(0)}MB). El limite es 25MB. Intenta comprimir el PDF o dividirlo en partes mas pequenas.`,
        notPdf: (f) => `¡Recibí "${f}"! Para archivos Word/Excel, descríbeme el contenido principal en palabras y te ayudo enseguida. O envíame una versión PDF para el análisis completo 📄`,
        truncated: '...documento truncado...',
        promptWithCaption: (f, c, t) => `El usuario envió un PDF "${f}" con esta solicitud: "${c}"\n\nContenido:\n---\n${t}\n---\n\nAnaliza y responde a la solicitud.`,
        promptNoCaption: (f, t) => `El usuario envió un PDF "${f}". Haz un resumen con los puntos clave.\n\nContenido:\n---\n${t}\n---`,
        truncatedNote: (max, total) => `\n\n_Nota: analicé los primeros ${max} caracteres de ${total} totales._`,
        chunkingNotice: (pages, chunks) => `Documento largo (~${pages} paginas). Analizo las primeras ~50 paginas, se necesitaran ${chunks} creditos AI.`,
        chunkPrompt: (i, total, text) => `Analiza esta parte ${i}/${total} del documento y proporciona un resumen de los puntos clave:\n\n---\n${text}\n---`,
        chunkCombinePrompt: (summaries) => `Aqui estan los resumenes de diferentes partes de un documento largo. Combina todo en un unico resumen coherente y completo con los puntos clave:\n\n${summaries}`,
        creditWarning: (credits) => `_Este documento requiere ${credits} de tus 17 creditos diarios._`,
    },
    pt: {
        processing: (f) => `Dê-me um momento, estou analisando "${f}" 📄`,
        downloadError: 'Não consegui baixar o arquivo, pode tentar de novo? 🙏',
        tooLarge: (f, sz) => `O arquivo "${f}" e' muito grande (${sz.toFixed(0)}MB). O limite e' 25MB. Tente comprimir o PDF ou dividi-lo em partes menores.`,
        notPdf: (f) => `Recebi "${f}"! Para arquivos Word/Excel, descreva o conteúdo principal em palavras e te ajudo imediatamente. Ou envie uma versão PDF para análise completa 📄`,
        truncated: '...documento truncado...',
        promptWithCaption: (f, c, t) => `O usuário enviou um PDF "${f}" com esta solicitação: "${c}"\n\nConteúdo:\n---\n${t}\n---\n\nAnalise e responda à solicitação.`,
        promptNoCaption: (f, t) => `O usuário enviou um PDF "${f}". Faça um resumo com os pontos-chave.\n\nConteúdo:\n---\n${t}\n---`,
        truncatedNote: (max, total) => `\n\n_Nota: analisei os primeiros ${max} caracteres de ${total} totais._`,
        chunkingNotice: (pages, chunks) => `Documento longo (~${pages} paginas). Analisando as primeiras ~50 paginas, serao necessarios ${chunks} creditos AI.`,
        chunkPrompt: (i, total, text) => `Analise esta parte ${i}/${total} do documento e forneca um resumo dos pontos-chave:\n\n---\n${text}\n---`,
        chunkCombinePrompt: (summaries) => `Aqui estao os resumos de diferentes partes de um documento longo. Combine tudo em um unico resumo coerente e completo com os pontos-chave:\n\n${summaries}`,
        creditWarning: (credits) => `_Este documento requer ${credits} dos seus 17 creditos diarios._`,
    },
};

export async function handleDocument(
    sock: WASocket,
    msg: WAMessage,
    session: any
): Promise<void> {
    const phone = msg.key.remoteJid!;
    const lang = session?.user_language || 'it';
    const msgs = MESSAGES[lang] || MESSAGES.it;
    const caption = extractTextContent(msg);
    const docMsg = msg.message?.documentMessage || msg.message?.documentWithCaptionMessage?.message?.documentMessage;
    const filename = docMsg?.fileName || 'documento';
    const mimetype = docMsg?.mimetype || '';

    // For documents keep a brief processing note (they take longer)
    await sendHumanized(sock, phone, msgs.processing(filename));

    const result: DownloadResult = await downloadMedia(msg, MAX_DOCUMENT_SIZE_BYTES, true);
    if (!result.media) {
        if (result.reason === 'too_large') {
            await sendHumanized(sock, phone, msgs.tooLarge(filename, result.fileSizeMB || 0));
        } else {
            await sendHumanized(sock, phone, msgs.downloadError);
        }
        return;
    }
    const media = result.media;

    let extractedText = '';

    if (mimetype.includes('pdf')) {
        try {
            const pdfParse = (await import('pdf-parse')).default;
            const pdfData = await pdfParse(media.buffer);
            extractedText = pdfData.text?.trim() || '';
            console.log(`[DOC] PDF parsed: ${extractedText.length} chars from "${filename}"`);
        } catch (err: any) {
            console.error('[DOC] PDF parse error:', err.message);
        }
    }

    // For plain-text formats, read the buffer directly as UTF-8
    const lowerFilename = filename.toLowerCase();
    const isPlainText =
        lowerFilename.endsWith('.txt') ||
        lowerFilename.endsWith('.csv') ||
        mimetype.includes('text/plain') ||
        mimetype.includes('text/csv');
    if (!extractedText && isPlainText) {
        try {
            extractedText = media.buffer.toString('utf8').trim();
            console.log(`[DOC] Plain-text read: ${extractedText.length} chars from "${filename}"`);
        } catch (err: any) {
            console.error('[DOC] Plain-text read error:', err.message);
        }
    }

    if (!extractedText) {
        await sendHumanized(sock, phone, msgs.notPdf(filename));
        await logMessage(phone, 'in', `[documento: ${filename}]`, 'document');
        return;
    }

    const sector = session?.sector || 'general';

    // ── Financial Document Path: use balance-parser backend ──
    if (looksLikeFinancial(extractedText, filename)) {
        console.log(`[DOC] ${redactPhone(phone)}: Financial document detected — calling balance-parser`);
        const base64Content = media.buffer.toString('base64');
        const balanceResult = await callBalanceParser(base64Content, filename, session?.scala_user_id);

        if (balanceResult.success && balanceResult.summary) {
            const financialMsgs: Record<string, (s: string) => string> = {
                it: (s) => `Ho analizzato il documento finanziario "${filename}".\n\n${s}`,
                en: (s) => `I analyzed the financial document "${filename}".\n\n${s}`,
                es: (s) => `He analizado el documento financiero "${filename}".\n\n${s}`,
                pt: (s) => `Analisei o documento financeiro "${filename}".\n\n${s}`,
            };
            const fmtMsg = (financialMsgs[lang] || financialMsgs.it)(balanceResult.summary);

            await logMessage(phone, 'in', `[PDF finanziario: ${filename}]`, 'document');
            await updateLeadScore(phone, 8); // Financial docs = very high engagement

            // Store in RAG
            if (sector !== 'general') {
                try { await storeInRAG(`[Balance] ${filename}: ${balanceResult.summary.substring(0, 500)}`, sector, 'balance-sheet'); } catch { /* ignore */ }
            }

            await sendHumanized(sock, phone, fmtMsg);
            console.log(`[DOC] ${redactPhone(phone)}: "${filename}" → balance-parser OK`);
            return;
        }
        // If balance-parser failed, fall through to generic analysis
        console.log(`[DOC] ${redactPhone(phone)}: balance-parser failed (${balanceResult.error}), falling through`);
    }

    // ── Property Listing Document Path: fire-and-forget (same as text.ts pattern) ──
    (async () => {
        try {
            const propertyConfirm = await processPropertyListingFromDocument(
                extractedText, phone, session, filename
            );
            if (propertyConfirm) {
                await sendHumanized(sock, phone, propertyConfirm);
            }
        } catch (err: any) {
            console.error('[PROPERTY-DOC] non-blocking error:', err.message);
        }
    })();

    // ── Generic Document Path ──
    const MAX_CHARS_SINGLE = 50000;   // Single-pass limit (raised from 15K)
    const CHUNK_SIZE = 15000;         // Per-chunk size for long docs
    const MAX_CHUNKS = 5;             // Cap at 5 chunks (75K chars ~ 50 pages)

    let fullResponse: string;

    if (extractedText.length <= MAX_CHARS_SINGLE) {
        // ── Single-pass: document fits in one call ──
        const prompt = caption
            ? msgs.promptWithCaption(filename, caption, extractedText)
            : msgs.promptNoCaption(filename, extractedText);
        fullResponse = await getAIResponse(prompt, session, phone);
    } else {
        // ── Chunking path: split into chunks, summarize each, combine ──
        const cappedText = extractedText.substring(0, CHUNK_SIZE * MAX_CHUNKS);
        const totalChunks = Math.min(Math.ceil(cappedText.length / CHUNK_SIZE), MAX_CHUNKS);
        const estPages = Math.round(cappedText.length / 1500); // ~1500 chars per page

        // Notify user about long document processing
        await sendHumanized(sock, phone, msgs.chunkingNotice(estPages, totalChunks + 1));

        // Credit warning for free users
        const userPlan = session?.plan || session?.subscription_plan || 'free';
        if (userPlan === 'free' && totalChunks > 1) {
            await sendHumanized(sock, phone, msgs.creditWarning(totalChunks + 1));
        }

        // Process each chunk
        const chunkSummaries: string[] = [];
        for (let i = 0; i < totalChunks; i++) {
            const chunkText = cappedText.substring(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
            const chunkPrompt = msgs.chunkPrompt(i + 1, totalChunks, chunkText);
            const summary = await getAIResponse(chunkPrompt, session, phone);
            chunkSummaries.push(`[Parte ${i + 1}/${totalChunks}]\n${summary}`);
        }

        // Combine summaries into final response
        const combinedSummaries = chunkSummaries.join('\n\n');
        let combinePrompt = msgs.chunkCombinePrompt(combinedSummaries);
        if (caption) {
            combinePrompt += `\n\nL'utente ha anche chiesto: "${caption}"`;
        }
        fullResponse = await getAIResponse(combinePrompt, session, phone);

        // Add note about truncation if original was even longer
        if (extractedText.length > cappedText.length) {
            fullResponse += msgs.truncatedNote(cappedText.length, extractedText.length);
        }
    }

    await logMessage(phone, 'in', `[PDF: ${filename}, ${extractedText.length} chars]`, 'document');
    await updateLeadScore(phone, 5); // PDFs = high engagement

    // Try to auto-insert document data into vertical if user has a sector
    if (sector !== 'general' && extractedText.length > 100) {
        try {
            await callDataEntry(
                `[Documento ${filename}] ${extractedText.substring(0, 2000)}`,
                sector,
                session?.scala_user_id
            );
        } catch { /* ignore — best effort */ }
    }

    // Store in RAG
    if (sector !== 'general') {
        try { await storeInRAG(`[Doc] ${filename}: ${extractedText.substring(0, 500)}`, sector, 'document'); } catch { /* ignore */ }
    }

    // FIX #2: route media AI output through the same guardrails as text.ts
    fullResponse = guardOutput(fullResponse, lang, { phone });

    await sendHumanized(sock, phone, fullResponse);
    console.log(`[DOC] ${redactPhone(phone)}: "${filename}" → ${extractedText.length} chars`);
}
