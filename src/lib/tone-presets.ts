// ═══════════════════════════════════════════════════
// SARA — Tone-of-voice presets (whatsapp-bot)
// ═══════════════════════════════════════════════════
// 2026-04-16 Audit multilingua fix P2: 4 tones x 4 languages (it/en/es/pt).
// Mirrors the backend tone-presets module

export type ToneKey = 'professionale' | 'caloroso' | 'commerciale-diretto' | 'tecnico';
export type ToneLang = 'it' | 'en' | 'es' | 'pt';

export const TONE_PRESETS_LOC: Record<ToneKey, Record<ToneLang, string>> = {
    professionale: {
        it: `Rispondi in modo formale, usando "lei", zero emoji, linguaggio professionale. Mantieni frasi asciutte e misurate.`,
        en: `Respond formally, using a polite professional register, no emoji, measured and professional language. Keep sentences concise and composed.`,
        es: `Responde de manera formal, usando "usted", sin emojis, lenguaje profesional. Mantén frases breves y mesuradas.`,
        pt: `Responda de forma formal, usando "o senhor" ou "a senhora", sem emojis, linguagem profissional. Mantenha frases concisas e comedidas.`,
    },
    caloroso: {
        it: `Rispondi in modo caloroso e confidenziale usando "tu", quasi zero emoji (max 1 ogni 10 messaggi), linguaggio empatico ("capisco perfettamente", "nessun problema"), come se parlassi con un amico.`,
        en: `Respond in a warm, friendly register, using first-name/informal tone, almost no emoji (max 1 every 10 messages), empathetic language ("I totally get it", "no worries"), as if talking to a friend.`,
        es: `Responde de manera cálida y cercana usando el tuteo, casi sin emojis (max 1 cada 10 mensajes), lenguaje empático ("te entiendo perfectamente", "sin problema"), como si hablaras con un amigo.`,
        pt: `Responda de forma calorosa e próxima usando o "você", quase sem emojis (max 1 a cada 10 mensagens), linguagem empática ("eu entendo perfeitamente", "sem problema"), como se estivesse falando com um amigo.`,
    },
    'commerciale-diretto': {
        it: `Rispondi in modo diretto orientato alla chiusura. Usa "tu", zero emoji, CTA chiari. Esempio: "vuoi che ti prepari il preventivo adesso?". Zero fronzoli.`,
        en: `Respond directly, sales-closing oriented. Use informal "you", no emoji, clear CTAs. Example: "want me to draft the quote now?". No fluff.`,
        es: `Responde de forma directa y orientada al cierre. Usa tuteo, sin emojis, CTAs claros. Ejemplo: "¿quieres que te prepare el presupuesto ahora?". Sin rodeos.`,
        pt: `Responda de forma direta e orientada ao fechamento. Use "você", sem emojis, CTAs claros. Exemplo: "quer que eu prepare o orçamento agora?". Sem rodeios.`,
    },
    tecnico: {
        it: `Rispondi in modo preciso e tecnico. Usa "tu", jargon accettato se rilevante, riferisci a documentazione quando possibile.`,
        en: `Respond precisely and technically. Use informal "you", accepted jargon where relevant, reference documentation when possible.`,
        es: `Responde de manera precisa y técnica. Usa tuteo, jerga aceptada si es relevante, remite a documentación cuando sea posible.`,
        pt: `Responda de forma precisa e técnica. Use "você", jargão aceito quando relevante, remeta à documentação quando possível.`,
    },
};

// Legacy alias — IT-only map kept for backward compatibility
export const TONE_PRESETS: Record<ToneKey, string> = {
    professionale: TONE_PRESETS_LOC.professionale.it,
    caloroso: TONE_PRESETS_LOC.caloroso.it,
    'commerciale-diretto': TONE_PRESETS_LOC['commerciale-diretto'].it,
    tecnico: TONE_PRESETS_LOC.tecnico.it,
};

export const DEFAULT_TONE: ToneKey = 'caloroso';
export const DEFAULT_TONE_LANG: ToneLang = 'it';

export function isValidTone(x: unknown): x is ToneKey {
    return typeof x === 'string' && x in TONE_PRESETS_LOC;
}

export function isValidToneLang(x: unknown): x is ToneLang {
    return x === 'it' || x === 'en' || x === 'es' || x === 'pt';
}

export function resolveTone(x: unknown): ToneKey {
    return isValidTone(x) ? x : DEFAULT_TONE;
}

export function resolveToneLang(x: unknown): ToneLang {
    return isValidToneLang(x) ? x : DEFAULT_TONE_LANG;
}

/**
 * Produce the tone snippet to inject in the system prompt.
 * `lang` accepts any string; will be normalized to it/en/es/pt (fallback IT).
 */
export function toneSnippet(tone: ToneKey, lang?: string | null): string {
    const t = TONE_PRESETS_LOC[tone] || TONE_PRESETS_LOC[DEFAULT_TONE];
    const normalized: ToneLang = (() => {
        if (!lang) return DEFAULT_TONE_LANG;
        const l = lang.toLowerCase().slice(0, 2);
        if (l === 'en') return 'en';
        if (l === 'es') return 'es';
        if (l === 'pt') return 'pt';
        return 'it';
    })();
    return t[normalized] || t[DEFAULT_TONE_LANG];
}
