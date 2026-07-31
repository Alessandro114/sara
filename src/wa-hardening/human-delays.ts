// human-delays.ts — Delay generator + outbound rate limiter
//
// All outbound sends are gated through sendHumanized() which:
//   1. Shows a "composing" presence update
//   2. Waits 1.5-4s proportional to message length
//   3. Clears presence
//   4. Hard-caps outbound to 15 messages/minute total
//
// The goal is to make our traffic indistinguishable from a human typing on their phone.

export function computeTypingDelayMs(text: string): number {
  // 50ms per char feels human; clamp between 1.5s and 4s.
  const len = typeof text === 'string' ? text.length : 0;
  const base = len * 50;
  // Add small jitter so multiple messages of same length don't line up perfectly.
  const jitter = Math.floor(Math.random() * 400) - 200; // -200..+200ms
  return Math.min(4000, Math.max(1500, base + jitter));
}

export function randomReadReceiptDelayMs(): number {
  // 2-5s "I just glanced at my phone" delay for read receipts.
  return 2000 + Math.floor(Math.random() * 3000);
}

export function randomPresenceIntervalMs(): number {
  // 3-8 min random presence refresh (mimics checking WA occasionally).
  return (3 + Math.floor(Math.random() * 5)) * 60 * 1000;
}

export function sleep(ms: number): Promise<void> {
  return new Promise(res => setTimeout(res, ms));
}

/**
 * Outbound rate limiter — sliding window of 60 seconds, max 15 sends.
 * Throws OR waits depending on caller preference; here we wait.
 */
export class OutboundRateLimiter {
  private readonly max: number;
  private readonly windowMs: number;
  private timestamps: number[] = [];

  constructor(maxPerMinute = 15) {
    this.max = maxPerMinute;
    this.windowMs = 60 * 1000;
  }

  /** Wait until it is safe to send; records the send timestamp on return. */
  async acquire(): Promise<void> {
    while (true) {
      const now = Date.now();
      this.timestamps = this.timestamps.filter(t => now - t < this.windowMs);
      if (this.timestamps.length < this.max) {
        this.timestamps.push(now);
        return;
      }
      // Sleep until oldest timestamp falls out of the window + small jitter.
      const oldest = this.timestamps[0] ?? now;
      const waitMs = this.windowMs - (now - oldest) + 250;
      await sleep(Math.max(250, waitMs));
    }
  }
}
