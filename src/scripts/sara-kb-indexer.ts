// ═══════════════════════════════════════════════════════════
// SARA KB Indexer — chunk markdown KB, embed, upsert into wa_rag_documents
// ═══════════════════════════════════════════════════════════
// Reads:
//   - ./src/data/sara-kb.md (primary)
//   - Optional additional .md files passed as argv
// Writes:
//   - wa_rag_documents rows with sector='sara-kb', title=chunk-id
// Usage:
//   node dist/scripts/sara-kb-indexer.js [extra-file-1.md] [extra-file-2.md]
// Cron (every 10 min):
//   */10 * * * * node dist/scripts/sara-kb-indexer.js >> logs/sara-kb-indexer.log 2>&1

import { readFileSync, statSync, existsSync } from 'fs';
import { Pool } from 'pg';
import { storeInRAG } from '../ai.js';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
pool.on('error', (err) => console.error('[pool] idle client error', err));

const PRIMARY_KB = process.env.SARA_KB_PATH || './src/data/sara-kb.md';
const SECTOR = 'sara-kb';

interface Chunk { id: string; text: string; }

/**
 * Split markdown into section chunks.
 * - Top-level split on `## §` (H2 with section marker)
 * - Inside each H2, keep H3 `### X.Y` subsections as sub-chunks when present
 * - Skip empty/placeholder sections containing only "_TBD_"
 */
function chunkMarkdown(source: string, sourceLabel: string): Chunk[] {
    const chunks: Chunk[] = [];
    // Split on H2 section markers
    const sections = source.split(/\n(?=## )/);

    for (const section of sections) {
        const h2Match = section.match(/^## (.+?)$/m);
        if (!h2Match) continue;
        const h2Title = h2Match[1].trim();

        // Check if this section has H3 subsections
        const h3Split = section.split(/\n(?=### )/);
        if (h3Split.length > 1) {
            // First piece is H2 intro (before first H3)
            const intro = h3Split[0].trim();
            if (intro.length > 100 && !/_TBD_\s*$/m.test(intro)) {
                chunks.push({
                    id: `${sourceLabel}|${h2Title}`,
                    text: intro,
                });
            }
            // Each H3 subsection is its own chunk
            for (let i = 1; i < h3Split.length; i++) {
                const sub = h3Split[i].trim();
                const h3Match = sub.match(/^### (.+?)$/m);
                if (!h3Match) continue;
                const h3Title = h3Match[1].trim();
                // Skip placeholder subsections
                const body = sub.replace(/^### .+$/m, '').trim();
                if (body.length < 30 || /^_TBD_?\s*$/m.test(body)) continue;
                chunks.push({
                    id: `${sourceLabel}|${h2Title}|${h3Title}`,
                    text: `## ${h2Title}\n### ${h3Title}\n${body}`,
                });
            }
        } else {
            // No H3 — the whole section is one chunk
            const body = section.replace(/^## .+$/m, '').trim();
            if (body.length < 50 || /^_TBD_?\s*$/m.test(body)) continue;
            chunks.push({
                id: `${sourceLabel}|${h2Title}`,
                text: section.trim(),
            });
        }
    }
    return chunks;
}

async function main(): Promise<void> {
    const startTime = Date.now();
    const files = [PRIMARY_KB, ...process.argv.slice(2)];
    console.log(`[KB-INDEXER] ${new Date().toISOString()} — sources: ${files.join(', ')}`);

    const allChunks: Chunk[] = [];
    for (const file of files) {
        if (!existsSync(file)) {
            console.warn(`[KB-INDEXER] skip missing: ${file}`);
            continue;
        }
        const stat = statSync(file);
        const source = readFileSync(file, 'utf-8');
        const label = file.split('/').pop() || file;
        const chunks = chunkMarkdown(source, label);
        console.log(`[KB-INDEXER] ${label}: ${chunks.length} chunks (file ${stat.size}B, mtime ${stat.mtime.toISOString()})`);
        allChunks.push(...chunks);
    }

    if (allChunks.length === 0) {
        console.error('[KB-INDEXER] no chunks produced — aborting to preserve existing index');
        await pool.end();
        process.exit(1);
    }

    // ── Atomic re-index via a STAGING sector ──────────────────────────────────
    // Previously this DELETEd the live sector then re-inserted while calling the
    // Mistral embedding API per chunk. If Mistral was down/rate-limited the inserts
    // produced nothing (storeInRAG swallows embedding failures and returns void), so
    // the live KB was left EMPTY until a fully-successful run — the "SARA answers
    // garbage / empty-RAG fallback" incident. Now we build into a staging sector and
    // only DELETE+promote the live sector if staging came out COMPLETE.
    const STAGING = `${SECTOR}__staging`;
    const expected = allChunks.filter(c => c.text.trim().length > 0).length;

    await pool.query('DELETE FROM wa_rag_documents WHERE sector=$1', [STAGING]); // clear any prior crashed run
    console.log(`[KB-INDEXER] embedding ${expected} chunks into staging...`);

    let ok = 0;
    let fail = 0;
    for (const chunk of allChunks) {
        try {
            await storeInRAG(chunk.text, STAGING, chunk.id);
            ok++;
        } catch (err: any) {
            console.error(`[KB-INDEXER] failed ${chunk.id}: ${err.message}`);
            fail++;
        }
    }

    // storeInRAG returns void even when the embedding API fails, so trust the DB, not `ok`.
    const staged = (await pool.query('SELECT COUNT(*)::int AS c FROM wa_rag_documents WHERE sector=$1', [STAGING])).rows[0].c;
    if (staged === 0 || staged < expected) {
        await pool.query('DELETE FROM wa_rag_documents WHERE sector=$1', [STAGING]);
        console.error(`[KB-INDEXER] ABORT: only ${staged}/${expected} chunks embedded (embedding API likely down) — LIVE KB left UNCHANGED`);
        await pool.end();
        process.exit(1);
    }

    // Staging is complete → atomically swap it in (delete live + promote staging).
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query('DELETE FROM wa_rag_documents WHERE sector=$1', [SECTOR]);
        await client.query('UPDATE wa_rag_documents SET sector=$1 WHERE sector=$2', [SECTOR, STAGING]);
        await client.query('COMMIT');
    } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        throw e;
    } finally {
        client.release();
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[KB-INDEXER] DONE — swapped ${staged} chunks live (${ok} ok / ${fail} fail) in ${elapsed}s`);
    await pool.end();
    process.exit(0);
}

main().catch(err => {
    console.error('[KB-INDEXER] fatal:', err);
    process.exit(2);
});
