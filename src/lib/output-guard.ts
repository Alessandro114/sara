// ═══════════════════════════════════════════════════
// S.A.R.A. shared output guard — one place for the post-LLM guardrail suite
// ═══════════════════════════════════════════════════
// FIX #2 (2026-07-08): media/voice/PDF handlers used to send AI output
// straight to the user, bypassing the persona/leak guardrails that the text
// handler runs. This helper factors out that suite so EVERY outbound AI
// response (text + audio + image + document) goes through the same checks.
// ═══════════════════════════════════════════════════

import {
    validateOutput,
    checkForbiddenClaims,
    lowConfidenceFallback,
    logGuardrailEvent,
    type EscalationTarget,
} from './sara-bot-guardrails.js';
import { enforcePersonaRules } from './output-enforcer.js';

export interface GuardOutputOpts {
    // Phone (for guardrail event logging). Redacted downstream.
    phone?: string;
    // When true, run the forbidden-claim price/date/name guard and, on a hit,
    // replace the whole response with the localized low-confidence fallback.
    lowConfidence?: boolean;
    // Verbatim claims the KB actually contains (only used when lowConfidence).
    allowedClaims?: string[];
    // Escalation target for the low-confidence fallback copy.
    escalation?: EscalationTarget | null;
    // Word cap for persona enforcement (defaults to 80, same as text handler).
    maxWords?: number;
}

/**
 * Apply the post-LLM guardrail suite to an AI response.
 * Order mirrors handlers/text.ts:
 *   1. (optional) forbidden-claim guard when RAG confidence is low
 *   2. validateOutput — persona/system-prompt leak → wholesale sanitize
 *   3. enforcePersonaRules — word cap, emoji cap, markdown strip
 */
export function guardOutput(
    response: string,
    lang: string = 'it',
    opts: GuardOutputOpts = {}
): string {
    let out = response;
    const phone = opts.phone || '';

    if (opts.lowConfidence) {
        const forbidden = checkForbiddenClaims(out, opts.allowedClaims || []);
        if (!forbidden.safe) {
            logGuardrailEvent('output_violation', phone, {
                violations: forbidden.violations,
                sample: out,
            });
            out = lowConfidenceFallback(lang, opts.escalation ?? null);
        }
    }

    const validation = validateOutput(out, lang);
    if (!validation.safe) {
        logGuardrailEvent('output_violation', phone, {
            violations: validation.violations,
            sample: out,
        });
        out = validation.sanitized;
    }

    out = enforcePersonaRules(out, opts.maxWords ?? 80);
    return out;
}
