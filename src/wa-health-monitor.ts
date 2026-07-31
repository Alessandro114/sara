// ═══════════════════════════════════════════════════════════
// wa-health-monitor.ts — Background health watchdog for Baileys
// ═══════════════════════════════════════════════════════════
// P0 fix 2026-04-12: observability + auto-stop when number banned.
// Runs as a sidecar to the main bot. Monitors connection state,
// memory, auth dir size, and 24h disconnect rate. If rate exceeds
// threshold, reports shouldStop=true so caller can gracefully stop.

import { readFileSync, writeFileSync, existsSync, statSync, readdirSync } from 'fs';
import { resolve } from 'path';
import pino from 'pino';

const HEALTH_FILE = resolve(process.cwd(), '.health_state.json');
const MAX_AUTH_DIR_SIZE_MB = 50; // Baileys auth dir shouldn't grow past this
const MAX_PROCESS_MEMORY_MB = 200; // Baileys ~50MB baseline, generous cap
const MAX_DISCONNECTS_24H = 10; // banned/cooldown threshold

const log = pino({ name: 'health-monitor', level: 'info' });

export interface HealthState {
    lastConnected: number;
    lastDisconnect: number;
    disconnects24h: number;
    lastRestart: number;
    restarts24h: number;
}

function defaultHealth(): HealthState {
    return {
        lastConnected: 0,
        lastDisconnect: 0,
        disconnects24h: 0,
        lastRestart: 0,
        restarts24h: 0,
    };
}

function loadHealth(): HealthState {
    try {
        if (!existsSync(HEALTH_FILE)) return defaultHealth();
        const parsed = JSON.parse(readFileSync(HEALTH_FILE, 'utf8'));
        return { ...defaultHealth(), ...parsed };
    } catch {
        return defaultHealth();
    }
}

function saveHealth(s: HealthState): void {
    try {
        writeFileSync(HEALTH_FILE, JSON.stringify(s, null, 2), 'utf8');
    } catch { /* ignore */ }
}

function prune24h(s: HealthState): HealthState {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    if (s.lastDisconnect < cutoff) s.disconnects24h = 0;
    if (s.lastRestart < cutoff) s.restarts24h = 0;
    return s;
}

/**
 * Call from Baileys connection.update handler on each state change.
 * Returns shouldStop=true if too many disconnects indicate banned/cooldown.
 */
export function recordConnectionEvent(status: 'connected' | 'disconnected'): {
    shouldStop: boolean;
    state: HealthState;
} {
    const h = prune24h(loadHealth());
    const now = Date.now();

    if (status === 'connected') {
        h.lastConnected = now;
    } else {
        h.lastDisconnect = now;
        h.disconnects24h++;
    }

    saveHealth(h);

    if (h.disconnects24h >= MAX_DISCONNECTS_24H) {
        log.error(
            { disconnects: h.disconnects24h },
            'Too many disconnects in 24h — number likely banned/cooldown'
        );
        return { shouldStop: true, state: h };
    }

    return { shouldStop: false, state: h };
}

/** Record a planned restart (so we can distinguish from crashes) */
export function recordPlannedRestart(): void {
    const h = prune24h(loadHealth());
    h.lastRestart = Date.now();
    h.restarts24h++;
    saveHealth(h);
}

/**
 * Periodic health check — call every 60s via setInterval in index.ts.
 * Logs memory, auth dir size, and staleness. Non-destructive.
 */
export function runPeriodicHealthCheck(): void {
    const memMB = process.memoryUsage().heapUsed / 1024 / 1024;
    const h = prune24h(loadHealth());

    if (memMB > MAX_PROCESS_MEMORY_MB) {
        log.warn(
            { memMB: Math.round(memMB), threshold: MAX_PROCESS_MEMORY_MB },
            'Memory usage high — consider restart'
        );
    }

    const authDir = resolve(process.cwd(), 'auth_store_baileys_hardened');
    if (existsSync(authDir)) {
        const sizeMB = getDirSizeMB(authDir);
        if (sizeMB > MAX_AUTH_DIR_SIZE_MB) {
            log.warn(
                { sizeMB: Math.round(sizeMB), threshold: MAX_AUTH_DIR_SIZE_MB },
                'Auth directory oversized'
            );
        }
    }

    if (h.lastConnected > 0 && Date.now() - h.lastConnected > 10 * 60 * 1000) {
        log.warn('No connection in 10+ minutes — possible session expiry');
    }

    log.info(
        {
            memMB: Math.round(memMB),
            disconnects24h: h.disconnects24h,
            restarts24h: h.restarts24h,
            lastConnectedMinAgo: h.lastConnected
                ? Math.round((Date.now() - h.lastConnected) / 60000)
                : null,
        },
        'health check'
    );
}

function getDirSizeMB(dir: string): number {
    let total = 0;
    try {
        for (const entry of readdirSync(dir)) {
            const full = resolve(dir, entry);
            const st = statSync(full);
            if (st.isDirectory()) total += getDirSizeMB(full);
            else total += st.size;
        }
    } catch { /* ignore */ }
    return total / 1024 / 1024;
}

export function getHealthSnapshot(): HealthState {
    return prune24h(loadHealth());
}
