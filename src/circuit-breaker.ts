// ═══════════════════════════════════════════════════
// Circuit breaker — generic 3-state (CLOSED/OPEN/HALF_OPEN)
// ═══════════════════════════════════════════════════
// P1 fix 2026-04-12: when a provider is revoked/rate-limited, SARA was going
// mute for hours. This breaker cuts the call at source and falls back.
// (Originally introduced to guard Gemini, removed from the chain 2026-07-17.)
// No external deps — pure TS.
// ═══════════════════════════════════════════════════

import pino from 'pino';

export type BreakerState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface BreakerOptions {
    name: string;
    // How many consecutive failures within `windowMs` trip the breaker.
    failureThreshold: number;
    // Rolling window for counting consecutive failures.
    windowMs: number;
    // First OPEN→HALF_OPEN timeout. Doubled on each HALF_OPEN failure up to maxTimeoutMs.
    initialTimeoutMs: number;
    maxTimeoutMs: number;
}

export class CircuitBreaker {
    private state: BreakerState = 'CLOSED';
    private consecutiveFailures = 0;
    private firstFailureAt = 0;
    private openedAt = 0;
    private currentTimeoutMs: number;
    private readonly opts: BreakerOptions;
    private readonly log;

    constructor(opts: BreakerOptions) {
        this.opts = opts;
        this.currentTimeoutMs = opts.initialTimeoutMs;
        this.log = pino({ name: `breaker:${opts.name}`, level: 'info' });
    }

    getState(): BreakerState {
        // Check if it's time to transition OPEN → HALF_OPEN
        if (this.state === 'OPEN' && Date.now() - this.openedAt >= this.currentTimeoutMs) {
            this.transition('HALF_OPEN');
        }
        return this.state;
    }

    // Returns true if the breaker permits the call to proceed.
    canAttempt(): boolean {
        return this.getState() !== 'OPEN';
    }

    // Record a successful call. Resets failure counters and closes the breaker.
    recordSuccess(): void {
        if (this.state === 'HALF_OPEN') {
            this.log.info('half-open probe succeeded — closing breaker');
            this.currentTimeoutMs = this.opts.initialTimeoutMs;
        }
        this.consecutiveFailures = 0;
        this.firstFailureAt = 0;
        if (this.state !== 'CLOSED') this.transition('CLOSED');
    }

    // Record a failed call. May trip the breaker OPEN.
    recordFailure(err?: Error): void {
        const now = Date.now();

        if (this.state === 'HALF_OPEN') {
            // Probe failed — back to OPEN with longer timeout (cap at maxTimeoutMs)
            this.currentTimeoutMs = Math.min(this.currentTimeoutMs * 2, this.opts.maxTimeoutMs);
            this.log.warn(
                { err: err?.message, nextTimeoutMs: this.currentTimeoutMs },
                'half-open probe failed — reopening'
            );
            this.transition('OPEN');
            this.openedAt = now;
            return;
        }

        // CLOSED path — count consecutive failures within the window
        if (this.consecutiveFailures === 0 || now - this.firstFailureAt > this.opts.windowMs) {
            this.firstFailureAt = now;
            this.consecutiveFailures = 1;
        } else {
            this.consecutiveFailures++;
        }

        if (this.consecutiveFailures >= this.opts.failureThreshold) {
            this.log.warn(
                { failures: this.consecutiveFailures, err: err?.message, timeoutMs: this.currentTimeoutMs },
                'failure threshold reached — opening breaker'
            );
            this.transition('OPEN');
            this.openedAt = now;
        }
    }

    private transition(next: BreakerState): void {
        if (this.state === next) return;
        this.log.info({ from: this.state, to: next }, 'state transition');
        this.state = next;
    }
}

// geminiBreaker REMOVED 2026-07-17 — Gemini is no longer in any runtime path,
// so there is nothing left to trip. The CircuitBreaker class above is retained:
// it is still exported for future providers and breakerFallbackMessage() below
// is the user-facing degradation message when the whole chain is exhausted.

// Language-aware user-facing fallback when all providers in the chain fail.
export function breakerFallbackMessage(lang: string = 'it'): string {
    const msgs: Record<string, string> = {
        it: "Mi dispiace, sto avendo qualche problema tecnico momentaneo. Ti ricontatto tra pochi minuti.",
        en: "Sorry, I'm having a temporary technical issue. I'll get back to you in a few minutes.",
        es: "Lo siento, estoy teniendo un problema técnico momentáneo. Te contacto en unos minutos.",
        pt: "Desculpe, estou com um problema técnico momentâneo. Retorno em alguns minutos.",
    };
    return msgs[lang] || msgs.it;
}
