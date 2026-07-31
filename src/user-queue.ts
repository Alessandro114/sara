// ═══════════════════════════════════════════════════
// Per-user FIFO message queue
// ═══════════════════════════════════════════════════
// P1 fix 2026-04-12: "3 messaggi rapidi = 3 risposte fuori ordine".
// Concurrent AI responses for the same user could complete out of order,
// producing a nonsensical conversation. We serialize per user with a
// promise-chain pattern: each new task `await`s the user's tail promise.
// ═══════════════════════════════════════════════════

import pino from 'pino';

const log = pino({ name: 'user-queue', level: 'info' });

// Map from userId → tail of its promise chain. Each new task chains onto
// the tail, guaranteeing FIFO ordering for that user. Other users run in parallel.
const userTails = new Map<string, Promise<void>>();
// Track how many tasks are currently queued per user (for backpressure + stats).
const userDepths = new Map<string, number>();

const MAX_QUEUE_DEPTH = 10;

export interface QueueStats {
    activeUsers: number;
    totalDepth: number;
    deepestUser: { userId: string; depth: number } | null;
}

/**
 * Enqueue a task (an async function) for a given user.
 * - Tasks for the same user run strictly in order (FIFO).
 * - Tasks for different users run in parallel.
 * - If the user's queue is already ≥ MAX_QUEUE_DEPTH, the new task is DROPPED
 *   with a warn log ("drop oldest" semantics: the new arrival is rejected
 *   because FIFO guarantees oldest is already being worked on).
 *
 * Returns a promise that resolves when the task has finished (or rejects
 * only if it was dropped — internal task errors are swallowed and logged
 * so the chain never breaks).
 */
export function enqueueUserMessage(userId: string, task: () => Promise<void>): Promise<void> {
    const currentDepth = userDepths.get(userId) || 0;
    if (currentDepth >= MAX_QUEUE_DEPTH) {
        log.warn({ userId: redact(userId), depth: currentDepth }, 'queue full — dropping new message');
        return Promise.reject(new Error('user queue full'));
    }

    userDepths.set(userId, currentDepth + 1);
    const prev = userTails.get(userId) || Promise.resolve();

    // Chain the new task onto the tail. We MUST catch so the chain cannot
    // be permanently poisoned by a rejection — errors are logged, not propagated.
    const next: Promise<void> = prev.then(
        () => task().catch(err => {
            log.error({ userId: redact(userId), err: err?.message }, 'task errored in user queue');
        }),
        () => task().catch(err => {
            log.error({ userId: redact(userId), err: err?.message }, 'task errored in user queue');
        })
    ).finally(() => {
        const d = (userDepths.get(userId) || 1) - 1;
        if (d <= 0) {
            userDepths.delete(userId);
            // Only clear tail if it's still the one we set — otherwise a later
            // enqueue already replaced it and we must not stomp on it.
            if (userTails.get(userId) === next) {
                userTails.delete(userId);
            }
        } else {
            userDepths.set(userId, d);
        }
    });

    userTails.set(userId, next);
    return next;
}

/**
 * Health-monitor observability hook. Returns a snapshot of queue depth.
 */
export function getUserQueueStats(): QueueStats {
    let totalDepth = 0;
    let deepest: { userId: string; depth: number } | null = null;
    for (const [userId, depth] of userDepths.entries()) {
        totalDepth += depth;
        if (!deepest || depth > deepest.depth) {
            deepest = { userId: redact(userId), depth };
        }
    }
    return {
        activeUsers: userDepths.size,
        totalDepth,
        deepestUser: deepest,
    };
}

// Phone/JID redaction — logs must never leak full contact IDs.
function redact(userId: string): string {
    const digits = userId.replace(/\D/g, '');
    return digits.length >= 4 ? `***${digits.slice(-4)}` : '***';
}
