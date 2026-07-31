// ===================================================
// SCALA WhatsApp Bot — Image Handler (v4 — Multilingual Enhanced Vision)
// ===================================================
type WASocket = any;
type WAMessage = any;
import { downloadMedia, extractTextContent } from '../media.js';
import { getMultimodalAIResponse, getAIResponse, storeInRAG } from '../ai.js';
import { logMessage, updateLeadScore, updateLeadInfo } from '../db.js';
import { sendHumanized } from '../humanize.js';
import { callOCR, callDataEntry, looksLikeDocument } from '../lib/backend-api.js';
import { processPropertyListingFromImage } from './property-listing.js';
import { redactPhone } from '../lib/phone-utils.js';
import { guardOutput } from '../lib/output-guard.js';

// ── Sector-specific image analysis prompts (multilingual) ──
const IMAGE_PROMPTS: Record<string, Record<string, string>> = {
    it: {
        ristorante: "L'utente ha inviato una foto. Se e' un piatto/cibo, analizza presentazione e suggerisci miglioramenti. Se e' un menu, analizza pricing e layout. Rispondi in modo naturale e diretto.",
        legale: "L'utente ha inviato una foto. Se e' un documento legale, analizza il contenuto e fornisci osservazioni. Rispondi in modo naturale e diretto.",
        commercialista: "L'utente ha inviato una foto. Se e' una fattura o documento fiscale, estrai le informazioni chiave. Rispondi in modo naturale e diretto.",
        agenzia: "L'utente ha inviato una foto. Se e' materiale marketing, analizza design e messaggio. Rispondi in modo naturale e diretto.",
        marketing: "L'utente ha inviato una foto. Se e' materiale marketing, analizza design e messaggio. Rispondi in modo naturale e diretto.",
        dermatologia: "L'utente ha inviato una foto. NOTA: NON puoi fare diagnosi mediche. Puoi descrivere cio' che vedi e suggerire di consultare un professionista. Rispondi in modo naturale.",
        general: "L'utente ha inviato un'immagine. Analizzala e rispondi in modo utile e naturale.",
    },
    en: {
        ristorante: "The user sent a photo. If it's a dish/food, analyze the presentation and suggest improvements. If it's a menu, analyze pricing and layout. Respond naturally and directly.",
        legale: "The user sent a photo. If it's a legal document, analyze the content and provide observations. Respond naturally and directly.",
        commercialista: "The user sent a photo. If it's an invoice or tax document, extract key information. Respond naturally and directly.",
        agenzia: "The user sent a photo. If it's marketing material, analyze design and message. Respond naturally and directly.",
        marketing: "The user sent a photo. If it's marketing material, analyze design and message. Respond naturally and directly.",
        dermatologia: "The user sent a photo. NOTE: You CANNOT make medical diagnoses. You can describe what you see and suggest consulting a professional. Respond naturally.",
        general: "The user sent an image. Analyze it and respond helpfully and naturally.",
    },
    es: {
        ristorante: "El usuario envió una foto. Si es un plato/comida, analiza la presentación y sugiere mejoras. Si es un menú, analiza precios y diseño. Responde de forma natural y directa.",
        legale: "El usuario envió una foto. Si es un documento legal, analiza el contenido y proporciona observaciones. Responde de forma natural y directa.",
        commercialista: "El usuario envió una foto. Si es una factura o documento fiscal, extrae la información clave. Responde de forma natural y directa.",
        agenzia: "El usuario envió una foto. Si es material de marketing, analiza diseño y mensaje. Responde de forma natural y directa.",
        marketing: "El usuario envió una foto. Si es material de marketing, analiza diseño y mensaje. Responde de forma natural y directa.",
        dermatologia: "El usuario envió una foto. NOTA: NO puedes hacer diagnósticos médicos. Puedes describir lo que ves y sugerir consultar a un profesional. Responde de forma natural.",
        general: "El usuario envió una imagen. Analízala y responde de forma útil y natural.",
    },
    pt: {
        ristorante: "O usuário enviou uma foto. Se for um prato/comida, analise a apresentação e sugira melhorias. Se for um cardápio, analise preços e layout. Responda de forma natural e direta.",
        legale: "O usuário enviou uma foto. Se for um documento legal, analise o conteúdo e forneça observações. Responda de forma natural e direta.",
        commercialista: "O usuário enviou uma foto. Se for uma fatura ou documento fiscal, extraia as informações-chave. Responda de forma natural e direta.",
        agenzia: "O usuário enviou uma foto. Se for material de marketing, analise design e mensagem. Responda de forma natural e direta.",
        marketing: "O usuário enviou uma foto. Se for material de marketing, analise design e mensagem. Responda de forma natural e direta.",
        dermatologia: "O usuário enviou uma foto. NOTA: NÃO pode fazer diagnósticos médicos. Pode descrever o que vê e sugerir consultar um profissional. Responda de forma natural.",
        general: "O usuário enviou uma imagem. Analise-a e responda de forma útil e natural.",
    },
};

// ── Enhanced analysis prompts (multilingual) ──
const ENHANCED_PROMPTS: Record<string, string> = {
    it: `
ANALISI AVANZATA IMMAGINE — Segui queste istruzioni aggiuntive:

1. ESTRAZIONE TESTO (OCR): Se l'immagine contiene testo (screenshot, documento, messaggio, pagina web),
   estrai e riporta il testo principale leggibile. Riassumi il contenuto se lungo.

2. BIGLIETTO DA VISITA: Se l'immagine e' un biglietto da visita o contiene dati di contatto:
   - Estrai: nome, cognome, azienda, ruolo, email, telefono, indirizzo, sito web
   - Rispondi con i dati estratti in formato chiaro
   - Suggerisci: "Vuoi che salvi questi contatti nel CRM di SCALA?"
   - Alla fine del messaggio aggiungi su una riga separata: [BUSINESS_CARD_DETECTED]

3. FATTURA/RICEVUTA/SCONTRINO: Se l'immagine e' una fattura, ricevuta, scontrino o documento contabile:
   - Estrai: fornitore/emittente, data, importo totale, IVA, voci principali
   - Rispondi con i dati estratti
   - Suggerisci: "Posso aiutarti a registrare questa spesa nel Balance Sheet AI di SCALA"
   - Alla fine del messaggio aggiungi su una riga separata: [RECEIPT_DETECTED]

4. SCREENSHOT DI APP/SITO: Se e' uno screenshot di un'applicazione o sito web:
   - Descrivi cosa mostra (dashboard, errore, configurazione, etc.)
   - Se e' un problema/errore, suggerisci soluzioni
   - Se e' un competitor, analizza punti di forza/debolezza

5. In tutti i casi, rispondi in modo naturale e colloquiale (stile WhatsApp, max 100 parole).
   NON usare bullet points. Vai dritto al punto.`,
    en: `
ADVANCED IMAGE ANALYSIS — Follow these additional instructions:

1. TEXT EXTRACTION (OCR): If the image contains text (screenshot, document, message, web page),
   extract and report the main readable text. Summarize if long.

2. BUSINESS CARD: If the image is a business card or contains contact data:
   - Extract: first name, last name, company, role, email, phone, address, website
   - Reply with extracted data in clear format
   - Suggest: "Would you like me to save these contacts in SCALA's CRM?"
   - At the end of the message add on a separate line: [BUSINESS_CARD_DETECTED]

3. INVOICE/RECEIPT: If the image is an invoice, receipt or accounting document:
   - Extract: supplier/issuer, date, total amount, tax, main items
   - Reply with extracted data
   - Suggest: "I can help you record this expense in SCALA's Balance Sheet AI"
   - At the end of the message add on a separate line: [RECEIPT_DETECTED]

4. APP/WEBSITE SCREENSHOT: If it's a screenshot of an application or website:
   - Describe what it shows (dashboard, error, settings, etc.)
   - If it's a problem/error, suggest solutions
   - If it's a competitor, analyze strengths/weaknesses

5. In all cases, respond naturally and conversationally (WhatsApp style, max 100 words).
   Do NOT use bullet points. Get straight to the point.`,
    es: `
ANÁLISIS AVANZADO DE IMAGEN — Sigue estas instrucciones adicionales:

1. EXTRACCIÓN DE TEXTO (OCR): Si la imagen contiene texto (captura de pantalla, documento, mensaje, página web),
   extrae y reporta el texto principal legible. Resume si es largo.

2. TARJETA DE VISITA: Si la imagen es una tarjeta de visita o contiene datos de contacto:
   - Extrae: nombre, apellido, empresa, cargo, email, teléfono, dirección, sitio web
   - Responde con los datos extraídos en formato claro
   - Sugiere: "¿Quieres que guarde estos contactos en el CRM de SCALA?"
   - Al final del mensaje agrega en una línea separada: [BUSINESS_CARD_DETECTED]

3. FACTURA/RECIBO: Si la imagen es una factura, recibo o documento contable:
   - Extrae: proveedor/emisor, fecha, monto total, impuestos, conceptos principales
   - Responde con los datos extraídos
   - Sugiere: "Puedo ayudarte a registrar este gasto en el Balance Sheet AI de SCALA"
   - Al final del mensaje agrega en una línea separada: [RECEIPT_DETECTED]

4. CAPTURA DE APP/SITIO: Si es una captura de pantalla de una aplicación o sitio web:
   - Describe lo que muestra (dashboard, error, configuración, etc.)
   - Si es un problema/error, sugiere soluciones
   - Si es un competidor, analiza fortalezas/debilidades

5. En todos los casos, responde de forma natural y coloquial (estilo WhatsApp, máximo 100 palabras).
   NO uses viñetas. Ve directo al punto.`,
    pt: `
ANÁLISE AVANÇADA DE IMAGEM — Siga estas instruções adicionais:

1. EXTRAÇÃO DE TEXTO (OCR): Se a imagem contiver texto (captura de tela, documento, mensagem, página web),
   extraia e relate o texto principal legível. Resuma se for longo.

2. CARTÃO DE VISITA: Se a imagem for um cartão de visita ou contiver dados de contato:
   - Extraia: nome, sobrenome, empresa, cargo, e-mail, telefone, endereço, site
   - Responda com os dados extraídos em formato claro
   - Sugira: "Quer que eu salve esses contatos no CRM da SCALA?"
   - No final da mensagem adicione em uma linha separada: [BUSINESS_CARD_DETECTED]

3. FATURA/RECIBO: Se a imagem for uma fatura, recibo ou documento contábil:
   - Extraia: fornecedor/emissor, data, valor total, impostos, itens principais
   - Responda com os dados extraídos
   - Sugira: "Posso ajudá-lo a registrar esta despesa no Balance Sheet AI da SCALA"
   - No final da mensagem adicione em uma linha separada: [RECEIPT_DETECTED]

4. CAPTURA DE APP/SITE: Se for uma captura de tela de um aplicativo ou site:
   - Descreva o que mostra (dashboard, erro, configuração, etc.)
   - Se for um problema/erro, sugira soluções
   - Se for um concorrente, analise pontos fortes/fracos

5. Em todos os casos, responda de forma natural e coloquial (estilo WhatsApp, máximo 100 palavras).
   NÃO use marcadores. Vá direto ao ponto.`,
};

// Multilingual error/log messages
const IMG_MESSAGES: Record<string, { error: string }> = {
    it: { error: "Non sono riuscita a ricevere l'immagine, puoi riprovare?" },
    en: { error: "I couldn't receive the image, can you try again?" },
    es: { error: 'No pude recibir la imagen, ¿puedes intentar de nuevo?' },
    pt: { error: 'Não consegui receber a imagem, pode tentar de novo? 🙏' },
};

/**
 * Detect if image likely contains a business card based on AI response
 */
function detectBusinessCard(response: string): { name?: string; company?: string; email?: string } | null {
    if (!response.includes('[BUSINESS_CARD_DETECTED]')) return null;
    const info: { name?: string; company?: string; email?: string } = {};

    // Try to extract from the response text
    const emailMatch = response.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
    if (emailMatch) info.email = emailMatch[0];

    // Name extraction from structured response
    const nameMatch = response.match(/(?:nome|name|nombre)[:\s]+([A-Z][a-zàèéìòùáéíóúñ]+(?:\s+[A-Z][a-zàèéìòùáéíóúñ]+)*)/i);
    if (nameMatch) info.name = nameMatch[1].trim();

    // Company extraction
    const companyMatch = response.match(/(?:azienda|company|empresa|societa|studio)[:\s]+(.+?)(?:\n|$|,)/i);
    if (companyMatch) info.company = companyMatch[1].trim();

    return Object.keys(info).length > 0 ? info : null;
}

export async function handleImage(
    sock: WASocket,
    msg: WAMessage,
    session: any
): Promise<void> {
    const phone = msg.key.remoteJid!;
    const lang = session?.user_language || 'it';
    const msgs = IMG_MESSAGES[lang] || IMG_MESSAGES.it;

    // Show composing instead of robotic message
    try {
        await sock.sendPresenceUpdate('composing', phone);
    } catch { /* ignore */ }

    const media = await downloadMedia(msg);
    if (!media) {
        await sendHumanized(sock, phone, msgs.error);
        return;
    }

    const base64Image = media.buffer.toString('base64');
    const caption = extractTextContent(msg);
    const sector = session?.sector || 'general';
    const sectorPrompts = IMAGE_PROMPTS[lang] || IMAGE_PROMPTS.it;
    const sectorPrompt = sectorPrompts[sector] || sectorPrompts.general;
    const enhancedPrompt = ENHANCED_PROMPTS[lang] || ENHANCED_PROMPTS.it;

    // ── OCR Path: if image looks like a document, run OCR first ──
    const isDocumentImage = looksLikeDocument(media.mimetype || 'image/jpeg', caption);
    let ocrText: string | undefined;

    if (isDocumentImage) {
        console.log(`[IMAGE-OCR] ${redactPhone(phone)}: Document-like image detected, running OCR...`);
        const ocrResult = await callOCR(media.buffer, media.mimetype || 'image/jpeg', 'whatsapp-image.jpg');
        if (ocrResult.success && ocrResult.text && ocrResult.text.length > 20) {
            ocrText = ocrResult.text;
            console.log(`[IMAGE-OCR] ${redactPhone(phone)}: OCR extracted ${ocrText.length} chars`);
        }
    }

    let response: string;

    if (ocrText) {
        // Use OCR text + AI for structured analysis
        const ocrPromptTemplates: Record<string, string> = {
            it: `Ho estratto questo testo dall'immagine tramite OCR:\n\n---\n${ocrText.substring(0, 8000)}\n---\n\nAnalizza il contenuto e fornisci un riepilogo strutturato. Se è una fattura/ricevuta, estrai importi, date, fornitore. Se è un biglietto da visita, estrai i contatti. Rispondi in modo naturale e utile.`,
            en: `I extracted this text from the image via OCR:\n\n---\n${ocrText.substring(0, 8000)}\n---\n\nAnalyze the content and provide a structured summary. If it's an invoice/receipt, extract amounts, dates, supplier. If it's a business card, extract contacts. Respond naturally and helpfully.`,
            es: `Extraje este texto de la imagen via OCR:\n\n---\n${ocrText.substring(0, 8000)}\n---\n\nAnaliza el contenido y proporciona un resumen estructurado. Si es una factura/recibo, extrae montos, fechas, proveedor. Si es una tarjeta de visita, extrae los contactos. Responde de forma natural y útil.`,
            pt: `Extraí este texto da imagem via OCR:\n\n---\n${ocrText.substring(0, 8000)}\n---\n\nAnalise o conteúdo e forneça um resumo estruturado. Se for uma fatura/recibo, extraia valores, datas, fornecedor. Se for um cartão de visita, extraia os contatos. Responda de forma natural e útil.`,
        };
        const ocrPrompt = ocrPromptTemplates[lang] || ocrPromptTemplates.it;
        response = await getAIResponse(ocrPrompt, session, phone);

        // Try data entry if we have a sector and it looks like actionable data
        if (sector !== 'general' && ocrText.length > 50) {
            try {
                const dataResult = await callDataEntry(
                    `[OCR da immagine] ${ocrText.substring(0, 2000)}`,
                    sector,
                    session?.scala_user_id
                );
                if (dataResult.success) {
                    const savedMsgs: Record<string, string> = {
                        it: `\n\nHo anche salvato i dati estratti nel tuo ${sector}.`,
                        en: `\n\nI also saved the extracted data to your ${sector}.`,
                        es: `\n\nTambién guardé los datos extraídos en tu ${sector}.`,
                        pt: `\n\nTambém salvei os dados extraídos no seu ${sector}.`,
                    };
                    response += savedMsgs[lang] || savedMsgs.it;
                }
            } catch { /* ignore data entry errors */ }
        }
    } else {
        // Standard vision path (existing behavior)
        const fullPrompt = `${sectorPrompt}\n\n${enhancedPrompt}`;
        const userWrotePrefix = lang === 'en' ? 'The user wrote' : lang === 'es' ? 'El usuario escribió' : "L'utente ha scritto";
        const parts: Array<{ text?: string; inline_data?: { mime_type: string; data: string } }> = [
            { inline_data: { mime_type: media.mimetype || 'image/jpeg', data: base64Image } },
            { text: caption ? `${fullPrompt}\n\n${userWrotePrefix}: "${caption}"` : fullPrompt },
        ];

        response = await getMultimodalAIResponse(parts, session, caption || 'analisi immagine', phone);
    }

    // ── Post-processing: extract business card data and update lead info ──
    const cardInfo = detectBusinessCard(response);
    if (cardInfo) {
        console.log(`[IMAGE] Business card detected for ${redactPhone(phone)}`);
        const updates: Record<string, string> = {};
        if (cardInfo.name && !session?.user_name) updates.user_name = cardInfo.name;
        if (cardInfo.company && !session?.company_name) updates.company_name = cardInfo.company;
        if (cardInfo.email && !session?.email) updates.email = cardInfo.email;
        if (Object.keys(updates).length > 0) {
            await updateLeadInfo(phone, updates as any);
        }
        // Clean the marker from visible response
        response = response.replace(/\[BUSINESS_CARD_DETECTED\]/g, '').trim();

        // Auto-save contact to CRM if we have a sector
        if (sector !== 'general' && (cardInfo.name || cardInfo.email)) {
            const contactMsg = `${cardInfo.name || ''} ${cardInfo.email || ''} ${cardInfo.company || ''}`.trim();
            try {
                await callDataEntry(contactMsg, sector, session?.scala_user_id);
                const savedMsgs: Record<string, string> = {
                    it: `\n\nHo salvato il contatto nel tuo CRM.`,
                    en: `\n\nI saved the contact to your CRM.`,
                    es: `\n\nGuardé el contacto en tu CRM.`,
                    pt: `\n\nSalvei o contato no seu CRM.`,
                };
                response += savedMsgs[lang] || savedMsgs.it;
            } catch { /* ignore */ }
        }
    }

    // Clean receipt marker from visible response
    if (response.includes('[RECEIPT_DETECTED]')) {
        response = response.replace(/\[RECEIPT_DETECTED\]/g, '').trim();
        console.log(`[IMAGE] Receipt/invoice detected for ${redactPhone(phone)}`);
    }

    await logMessage(phone, 'in', caption || '[immagine]', 'image', undefined, response.substring(0, 500));

    // Images show higher engagement — score +5 (vs +2 for text)
    await updateLeadScore(phone, 5);

    // Store in RAG if meaningful analysis
    if (ocrText && sector !== 'general') {
        try { await storeInRAG(`[OCR] ${ocrText.substring(0, 500)}`, sector, 'image-ocr'); } catch { /* ignore */ }
    }

    // ── Property Listing Detection: if image looks like a property photo/listing sheet ──
    (async () => {
        try {
            // Use OCR text if available, otherwise use the AI vision response as source
            const textForDetection = ocrText || response;
            const confirmMsg = await processPropertyListingFromImage(
                textForDetection, phone, session, undefined, caption
            );
            if (confirmMsg) {
                await sendHumanized(sock, phone, confirmMsg);
                console.log(`[PROPERTY-IMG] ${redactPhone(phone)}: listing saved from image`);
            }
        } catch (err: any) {
            console.error('[PROPERTY-IMG] non-blocking error:', err.message);
        }
    })();

    // FIX #2: route media AI output through the same guardrails as text.ts
    response = guardOutput(response, lang, { phone });

    await sendHumanized(sock, phone, response);
    console.log(`[IMAGE] ${redactPhone(phone)}: ${(media.buffer.length / 1024).toFixed(0)}KB${ocrText ? ' (OCR)' : ''}`);
}
