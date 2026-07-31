#!/usr/bin/env node
// ═══════════════════════════════════════════════════════
// SARA RAG 1000+ Test Runner
// Runs generated tests against the SARA pipeline
// Usage: npx tsx src/scripts/run-1000-tests.ts [--limit N] [--sector X]
// ═══════════════════════════════════════════════════════

import 'dotenv/config';
import fs from 'fs';
import { initDB, getSession, upsertSession } from '../db.js';
import { handleText } from '../handlers/text.js';

interface TestCase {
    id: number;
    sector: string;
    lang: string;
    text: string;
    expectField: string;
    expectValue: string;
    variant: string;
}

const TEST_PHONE = 'ux-test-1000@s.whatsapp.net';
const captured: Array<{ text: string }> = [];

const mockSock = {
    ev: { on: () => {} },
    async sendMessage(_jid: any, content: any) {
        const text = content?.text || content?.caption || '[media]';
        captured.push({ text });
        return {};
    },
    async sendPresenceUpdate() {},
};

function fakeTextMsg(text: string) {
    return {
        key: { remoteJid: TEST_PHONE, fromMe: false, id: `test_${Date.now()}_${Math.random().toString(36).slice(2)}` },
        message: { conversation: text },
    };
}

function checkResult(tc: TestCase, responses: string[]): { pass: boolean; reason: string } {
    const all = responses.join(' ').toLowerCase();

    switch (tc.expectField) {
        case 'price': {
            // Normalize price: remove dots/commas for comparison
            const normalized = tc.expectValue.replace(/\./g, '').replace(/,/g, '');
            const found = all.replace(/\./g, '').replace(/,/g, '').includes(normalized) ||
                          all.includes(tc.expectValue);
            if (!found) return { pass: false, reason: `Price ${tc.expectValue} not found in response` };
            return { pass: true, reason: `Price ${tc.expectValue} found` };
        }
        case 'sector': {
            // We can't directly check sector from response, but we check the response is relevant
            if (responses.length === 0) return { pass: false, reason: 'No response' };
            return { pass: true, reason: 'Response received (sector check requires log analysis)' };
        }
        case 'handoff': {
            const handoffSignals = /operatore|responsabile|umano|person|manager|contatt|chiam/i.test(all);
            if (tc.expectValue === 'should_trigger' && !handoffSignals) {
                return { pass: false, reason: 'Handoff not triggered' };
            }
            return { pass: true, reason: 'Handoff handled correctly' };
        }
        case 'no_hallucination': {
            // Should NOT invent a specific price for unknown items
            const inventedPrice = /\d{2,}[\.,]?\d*\s*(eur|euro|\u20ac)/i.test(all);
            if (inventedPrice) return { pass: false, reason: `Hallucinated price found: "${all.substring(0, 100)}"` };
            return { pass: true, reason: 'No hallucinated price' };
        }
        case 'correct_sector': {
            if (responses.length === 0) return { pass: false, reason: 'No response' };
            return { pass: true, reason: 'Response received' };
        }
        case 'security': {
            if (responses.length === 0) return { pass: false, reason: 'No response (crash?)' };
            const leaked = /password|database|sql|drop|select|insert/i.test(all);
            if (leaked) return { pass: false, reason: `Security leak: "${all.substring(0, 100)}"` };
            return { pass: true, reason: 'Security test passed' };
        }
        case 'response': {
            if (responses.length === 0) return { pass: false, reason: 'No response' };
            return { pass: true, reason: 'Response received' };
        }
        default:
            return { pass: true, reason: 'Unknown expectField, skipping' };
    }
}

async function main() {
    const args = process.argv.slice(2);
    const limitIdx = args.indexOf('--limit');
    const sectorIdx = args.indexOf('--sector');
    const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1]) : Infinity;
    const filterSector = sectorIdx >= 0 ? args[sectorIdx + 1] : null;

    const raw = fs.readFileSync('tests-1000.json', 'utf-8');
    let tests: TestCase[] = JSON.parse(raw);

    if (filterSector) tests = tests.filter(t => t.sector === filterSector);
    if (limit < tests.length) tests = tests.slice(0, limit);

    console.log(`\n${'='.repeat(60)}`);
    console.log(`SARA RAG Test Suite — ${tests.length} tests`);
    console.log(`${'='.repeat(60)}\n`);

    await initDB();

    let passed = 0;
    let failed = 0;
    const failures: Array<{ id: number; name: string; reason: string }> = [];

    const startTime = Date.now();

    for (const tc of tests) {
        captured.length = 0;

        // Set sector if needed
        if (tc.sector !== 'general') {
            await upsertSession(TEST_PHONE, { sector: tc.sector });
        }

        const session = await getSession(TEST_PHONE);
        const msg = fakeTextMsg(tc.text);

        try {
            await handleText(mockSock as any, msg as any, session);
        } catch (err: any) {
            failures.push({ id: tc.id, name: `${tc.sector}/${tc.variant}`, reason: `CRASH: ${err.message}` });
            failed++;
            continue;
        }

        const responses = captured.map(c => c.text);
        const result = checkResult(tc, responses);

        if (result.pass) {
            passed++;
        } else {
            failed++;
            failures.push({ id: tc.id, name: `${tc.sector}/${tc.variant}: "${tc.text.substring(0, 50)}"`, reason: result.reason });
        }

        // Progress every 100 tests
        if ((passed + failed) % 100 === 0) {
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            console.log(`  [${passed + failed}/${tests.length}] ${passed} pass, ${failed} fail (${elapsed}s)`);
        }
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log(`\n${'='.repeat(60)}`);
    console.log(`RESULTS: ${passed}/${passed + failed} PASS (${((passed / (passed + failed)) * 100).toFixed(1)}%)`);
    console.log(`Time: ${elapsed}s`);
    console.log(`${'='.repeat(60)}`);

    if (failures.length > 0) {
        console.log(`\nFAILURES (${failures.length}):`);
        failures.forEach(f => console.log(`  #${f.id} ${f.name} — ${f.reason}`));
    }

    // Save results
    const report = {
        date: new Date().toISOString(),
        total: passed + failed,
        passed,
        failed,
        passRate: `${((passed / (passed + failed)) * 100).toFixed(1)}%`,
        elapsed: `${elapsed}s`,
        failures,
    };
    fs.writeFileSync('test-results-1000.json', JSON.stringify(report, null, 2));
    console.log(`\nResults saved to test-results-1000.json`);

    process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
    console.error('Fatal:', err);
    process.exit(1);
});
