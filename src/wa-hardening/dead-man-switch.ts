// dead-man-switch.ts — DISABLED (always returns safe values)
// Removed: caused SARA to stop reconnecting after pairing failures.

export function isPaused(): boolean { return false; }
export function tripDeadMan(_reason: string): void { /* no-op */ }
export function clearDeadMan(): void { /* no-op */ }
export function recordHandshakeFailure(_reason: string): boolean { return false; }
export function recordSuccessfulHandshake(): void { /* no-op */ }
