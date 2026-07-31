#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
// SARA Benchmark Runner v2.0 — 220 test cases
// ═══════════════════════════════════════════════════════════
// Tests: sector detection, price extraction, dual-role,
//        multi-language, security, edge cases
//
// Usage:
//   node run-benchmark-200.cjs                   # run all
//   node run-benchmark-200.cjs --sector immobiliare  # filter by sector
//   node run-benchmark-200.cjs --variant dual_role   # filter by variant
//   node run-benchmark-200.cjs --lang de             # filter by language
//   node run-benchmark-200.cjs --dry                 # dry run (no API calls)

const fs = require('fs');
const path = require('path');

const tests = JSON.parse(fs.readFileSync(path.join(__dirname, 'benchmark-200.json'), 'utf-8'));

// Parse CLI args
const args = process.argv.slice(2);
const filterSector = args.includes('--sector') ? args[args.indexOf('--sector') + 1] : null;
const filterVariant = args.includes('--variant') ? args[args.indexOf('--variant') + 1] : null;
const filterLang = args.includes('--lang') ? args[args.indexOf('--lang') + 1] : null;
const dryRun = args.includes('--dry');
const verbose = args.includes('--verbose') || args.includes('-v');

// Filter tests
let filtered = tests;
if (filterSector) filtered = filtered.filter(t => t.sector === filterSector);
if (filterVariant) filtered = filtered.filter(t => t.variant.includes(filterVariant));
if (filterLang) filtered = filtered.filter(t => t.lang === filterLang);

console.log('═══════════════════════════════════════════════════');
console.log('  SARA BENCHMARK v2.0 — 220 Test Cases');
console.log('═══════════════════════════════════════════════════');
console.log(`  Tests: ${filtered.length} / ${tests.length}`);
if (filterSector) console.log(`  Filter sector: ${filterSector}`);
if (filterVariant) console.log(`  Filter variant: ${filterVariant}`);
if (filterLang) console.log(`  Filter lang: ${filterLang}`);
console.log('═══════════════════════════════════════════════════');
console.log('');

if (dryRun) {
    console.log('[DRY RUN] Would test:', filtered.length, 'cases');
    // Show distribution
    const bySector = {};
    const byVariant = {};
    const byRole = {};
    for (const t of filtered) {
        bySector[t.sector] = (bySector[t.sector] || 0) + 1;
        byVariant[t.variant] = (byVariant[t.variant] || 0) + 1;
        byRole[t.role] = (byRole[t.role] || 0) + 1;
    }
    console.log('\nBy sector:', JSON.stringify(bySector, null, 2));
    console.log('\nBy variant:', JSON.stringify(byVariant, null, 2));
    console.log('\nBy role:', JSON.stringify(byRole, null, 2));
    process.exit(0);
}

// ─── Test Helpers ───

// Import the sector detection function
async function loadModules() {
    // We need tsx to import TypeScript
    const { detectSector } = await import('./src/sectors.js');
    return { detectSector };
}

// Evaluate a single test
function evaluateTest(test, sectorResult, aiResponse) {
    const { expectField, expectValue, variant } = test;
    const result = { pass: false, reason: '' };

    switch (expectField) {
        case 'correct_sector':
            result.pass = sectorResult === expectValue;
            result.reason = result.pass
                ? `sector=${sectorResult}`
                : `expected sector="${expectValue}", got="${sectorResult}"`;
            break;

        case 'price':
            if (!aiResponse) {
                result.pass = false;
                result.reason = 'no AI response (sector detection only mode)';
            } else {
                result.pass = aiResponse.includes(expectValue);
                result.reason = result.pass
                    ? `found "${expectValue}" in response`
                    : `"${expectValue}" not found in response: "${aiResponse.substring(0, 100)}..."`;
            }
            break;

        case 'response':
            if (expectValue === '') {
                // Just check we got any response
                result.pass = true;
                result.reason = 'response received (no specific value expected)';
            } else if (!aiResponse) {
                result.pass = false;
                result.reason = 'no AI response';
            } else {
                result.pass = aiResponse.toLowerCase().includes(expectValue.toLowerCase());
                result.reason = result.pass
                    ? `found "${expectValue}"`
                    : `"${expectValue}" not found in: "${aiResponse.substring(0, 100)}..."`;
            }
            break;

        case 'no_hallucination':
            if (expectValue === 'no_hallucinate') {
                // Should NOT invent data
                result.pass = true; // need AI response to verify
                result.reason = 'hallucination check (needs AI response)';
            } else {
                // Should mention the specific OS name
                if (!aiResponse) {
                    result.pass = false;
                    result.reason = 'no AI response';
                } else {
                    result.pass = aiResponse.includes(expectValue);
                    result.reason = result.pass
                        ? `found "${expectValue}"`
                        : `"${expectValue}" not found in: "${aiResponse.substring(0, 100)}..."`;
                }
            }
            break;

        case 'security':
            // These need AI response - just check sector detection doesn't crash
            result.pass = true;
            result.reason = 'security test (needs AI response for full check)';
            break;

        case 'handoff':
            // Check that complaint/escalation is detected
            result.pass = true;
            result.reason = 'handoff test (needs AI response for full check)';
            break;

        default:
            result.pass = false;
            result.reason = `unknown expectField: ${expectField}`;
    }

    return result;
}

// ─── Main Runner ───
async function runBenchmark() {
    let modules;
    try {
        modules = await loadModules();
    } catch (err) {
        console.error('Failed to load modules. Make sure to build first: npx tsc');
        console.error(err.message);
        // Fallback: run sector detection tests only using the compiled JS
        console.log('\nFalling back to compiled JS...');
        try {
            const { detectSector } = await import('./dist/sectors.js');
            modules = { detectSector };
        } catch (err2) {
            console.error('Also failed to load compiled JS:', err2.message);
            process.exit(1);
        }
    }

    const { detectSector } = modules;

    const results = {
        total: 0,
        passed: 0,
        failed: 0,
        skipped: 0,
        bySector: {},
        byVariant: {},
        byLang: {},
        byRole: {},
        failures: [],
    };

    for (const test of filtered) {
        results.total++;
        const { id, sector, lang, text, variant, role } = test;

        // Run sector detection
        const detectedSector = detectSector(text);

        // Evaluate
        const evalResult = evaluateTest(test, detectedSector, null);

        // Track results
        if (!results.bySector[sector]) results.bySector[sector] = { pass: 0, fail: 0 };
        if (!results.byVariant[variant]) results.byVariant[variant] = { pass: 0, fail: 0 };
        if (!results.byLang[lang]) results.byLang[lang] = { pass: 0, fail: 0 };
        if (!results.byRole[role]) results.byRole[role] = { pass: 0, fail: 0 };

        if (test.expectField === 'correct_sector') {
            if (evalResult.pass) {
                results.passed++;
                results.bySector[sector].pass++;
                results.byVariant[variant].pass++;
                results.byLang[lang].pass++;
                results.byRole[role].pass++;
                if (verbose) console.log(`  ✅ #${id} [${sector}/${lang}] ${text.substring(0, 50)}...`);
            } else {
                results.failed++;
                results.bySector[sector].fail++;
                results.byVariant[variant].fail++;
                results.byLang[lang].fail++;
                results.byRole[role].fail++;
                results.failures.push({ id, sector, lang, text: text.substring(0, 60), variant, reason: evalResult.reason });
                console.log(`  ❌ #${id} [${sector}/${lang}] ${evalResult.reason}`);
            }
        } else {
            // Non-sector-detection tests need AI response — skip in offline mode
            results.skipped++;
            if (verbose) console.log(`  ⏭ #${id} [${sector}/${lang}] ${variant} (needs AI response)`);
        }
    }

    // Print results
    console.log('');
    console.log('═══════════════════════════════════════════════════');
    console.log('  RESULTS');
    console.log('═══════════════════════════════════════════════════');
    console.log(`  Total:   ${results.total}`);
    console.log(`  Passed:  ${results.passed} ✅`);
    console.log(`  Failed:  ${results.failed} ❌`);
    console.log(`  Skipped: ${results.skipped} ⏭ (need AI response)`);
    console.log(`  Rate:    ${results.passed > 0 ? ((results.passed / (results.passed + results.failed)) * 100).toFixed(1) : 0}%`);
    console.log('');

    // Sector breakdown
    console.log('  BY SECTOR:');
    for (const [s, v] of Object.entries(results.bySector).sort((a, b) => b[1].fail - a[1].fail)) {
        const icon = v.fail > 0 ? '❌' : '✅';
        console.log(`    ${icon} ${s}: ${v.pass}/${v.pass + v.fail}`);
    }
    console.log('');

    // Language breakdown
    console.log('  BY LANGUAGE:');
    for (const [l, v] of Object.entries(results.byLang).sort((a, b) => b[1].fail - a[1].fail)) {
        const icon = v.fail > 0 ? '❌' : '✅';
        console.log(`    ${icon} ${l}: ${v.pass}/${v.pass + v.fail}`);
    }
    console.log('');

    // Failures detail
    if (results.failures.length > 0) {
        console.log('  FAILURES:');
        for (const f of results.failures) {
            console.log(`    #${f.id} [${f.sector}/${f.lang}] ${f.variant}: ${f.reason}`);
            console.log(`      text: "${f.text}"`);
        }
    }

    console.log('═══════════════════════════════════════════════════');

    // Save results
    const output = {
        date: new Date().toISOString(),
        total: results.total,
        passed: results.passed,
        failed: results.failed,
        skipped: results.skipped,
        passRate: `${results.passed > 0 ? ((results.passed / (results.passed + results.failed)) * 100).toFixed(1) : 0}%`,
        bySector: results.bySector,
        byVariant: results.byVariant,
        byLang: results.byLang,
        byRole: results.byRole,
        failures: results.failures,
    };

    fs.writeFileSync(
        path.join(__dirname, 'benchmark-200-results.json'),
        JSON.stringify(output, null, 2)
    );
    console.log('\nResults saved to benchmark-200-results.json');

    process.exit(results.failed > 0 ? 1 : 0);
}

runBenchmark().catch(err => {
    console.error('Benchmark failed:', err.message);
    process.exit(1);
});
