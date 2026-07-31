// sock-registry.ts — shared singleton for WA socket access
// index.ts sets the active sock; sara-api.ts reads it to send outbound messages.

import type { SockLike } from '../wa-adapter.js';

let _activeSock: SockLike | null = null;

export function setActiveSock(sock: SockLike): void {
    _activeSock = sock;
}

export function getActiveSock(): SockLike | null {
    return _activeSock;
}

export function isConnected(): boolean {
    return _activeSock !== null;
}
