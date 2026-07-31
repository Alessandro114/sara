// ═══════════════════════════════════════════════════
// S.A.R.A. API-only mode — no WhatsApp bot, just REST API
// Used when SARA WA runs via WAHA bridge on DEV,
// but the customer-facing SOLO SARA APIs still need
// to be reachable from the backend on PROD.
// ═══════════════════════════════════════════════════
import 'dotenv/config';

// Start S.A.R.A. API bridge (runs on port 3006)
import './sara-api.js';

import { initDB } from './db.js';
import { restoreAllSessions } from './lib/multi-session.js';
import { initSectorEmbeddings } from './sectors.js';

async function main() {
    await initDB();
    await initSectorEmbeddings();

    // Restore SOLO SARA multi-sessions from WAHA
    restoreAllSessions().catch(err =>
        console.error('[SOLO-SESSION] restore failed (non-fatal):', err?.message)
    );

    console.log('[API-ONLY] SARA API-only mode active — no WA bot, WAHA handles messaging');
}

main().catch(err => { console.error('[FATAL]', err); process.exit(1); });
