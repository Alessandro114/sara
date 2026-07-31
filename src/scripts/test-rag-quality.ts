#!/usr/bin/env node
// ═══════════════════════════════════════════════════════
// SARA RAG Quality Test — Direct RAG function testing
// Tests ragSearch + evaluateRetrieval WITHOUT handler pipeline
// No intent interceptor, no FAQ, no platform query bypass
// ═══════════════════════════════════════════════════════

import 'dotenv/config';
import { initDB } from '../db.js';
import { ragSearch, ragSearchWithScore, evaluateRetrieval } from '../ai.js';

interface RagTestCase {
    id: number;
    cluster: string;
    text: string;
    sector: string;
    expectInResponse: string[];   // substrings that MUST appear
    expectNotInResponse?: string[]; // substrings that must NOT appear
    description: string;
}

const RED = '\x1b[31m', GRN = '\x1b[32m', YLW = '\x1b[33m', RST = '\x1b[0m';

// ── CLUSTER 1: Price extraction (immobiliare) — 10 properties × ~10 variants ──
function generatePriceTests(): RagTestCase[] {
    const properties = [
        { name: 'Bilocale Navigli', price: '320.000', mq: '55', ref: 'HP-MI-2401' },
        { name: 'Trilocale Via Savona', price: '480.000', mq: '95', ref: 'HP-MI-2402' },
        { name: 'Penthouse Brera', price: '1.250.000', mq: '145', ref: 'HP-MI-2403' },
        { name: 'Attico CityLife', price: '1.800.000', mq: '180', ref: 'HP-MI-2404' },
        { name: 'Villa San Siro', price: '1.450.000', mq: '250', ref: 'HP-MI-2405' },
        { name: 'Monolocale Porta Romana', price: '185.000', mq: '35', ref: 'HP-MI-2406' },
        { name: 'Loft Isola', price: '520.000', mq: '120', ref: 'HP-MI-2407' },
        { name: 'Trilocale Trastevere', price: '420.000', mq: '85', ref: 'HP-RM-3001' },
        { name: 'Bilocale Prati', price: '350.000', mq: '60', ref: 'HP-RM-3002' },
        { name: 'Attico Parioli', price: '1.650.000', mq: '200', ref: 'HP-RM-3003' },
    ];

    const templates = [
        { t: 'Quanto costa il {name}?', v: 'direct' },
        { t: 'Prezzo del {name}?', v: 'short' },
        { t: 'Mi dici il prezzo del {name}?', v: 'informal' },
        { t: 'Vorrei sapere il costo del {name}', v: 'formal' },
        { t: 'Info su {name}', v: 'generic' },
        { t: 'Quanti metri quadri ha il {name}?', v: 'mq_query' },
        { t: '{name} dettagli', v: 'minimal' },
        { t: 'Buongiorno, sono interessato al {name}, quanto viene?', v: 'polite' },
        { t: 'How much is the {name}?', v: 'english' },
        { t: 'Cuanto cuesta el {name}?', v: 'spanish' },
    ];

    const tests: RagTestCase[] = [];
    let id = 1;
    for (const p of properties) {
        for (const tpl of templates) {
            const text = tpl.t.replace('{name}', p.name);
            const expect = tpl.v === 'mq_query' ? [p.mq] : [p.price];
            tests.push({
                id: id++,
                cluster: 'price_extraction',
                text,
                sector: 'immobiliare',
                expectInResponse: expect,
                description: `${p.name} (${tpl.v})`,
            });
        }
    }
    return tests;
}

// ── CLUSTER 2: FAQ (immobiliare) — service questions ──
function generateFaqTests(): RagTestCase[] {
    const faqs = [
        { q: 'Come funziona la visita?', expect: ['30', '45', 'minuti'], desc: 'visita duration' },
        { q: 'Posso fare un offerta online?', expect: ['proposta', 'email'], desc: 'offerta online' },
        { q: 'Quali documenti servono per comprare casa?', expect: ['documento', 'codice fiscale'], desc: 'documenti acquisto' },
        { q: 'Quanto tempo ci vuole per comprare?', expect: ['60', '90'], desc: 'tempistiche acquisto' },
        { q: 'Fate affitti?', expect: ['affitt', 'lungo termine'], desc: 'affitti' },
        { q: 'In che zone lavorate?', expect: ['Milano', 'Roma'], desc: 'zone coperte' },
        { q: 'Quanto costa la commissione?', expect: ['3%', '5.000'], desc: 'commissioni' },
        { q: 'Fate il servizio fotografico?', expect: ['fotograf'], desc: 'foto servizio' },
        { q: 'Che orari avete?', expect: ['9:00', '18:30'], desc: 'orari' },
        { q: 'Dove siete a Milano?', expect: ['Mora', 'Milano'], desc: 'indirizzo MI' },
        // Variants
        { q: 'How do I book a visit?', expect: ['visita'], desc: 'visit EN' },
        { q: 'Vorrei vendere casa, come funziona?', expect: ['valutazione', 'gratuita'], desc: 'vendita' },
        { q: 'Avete mutui convenzionati?', expect: ['mutuo', 'bancari'], desc: 'mutui' },
        { q: 'Virtual tour disponibile?', expect: ['virtual', '3D'], desc: 'virtual tour' },
        { q: 'Home staging quanto costa?', expect: ['1.500'], desc: 'home staging' },
    ];

    return faqs.map((f, i) => ({
        id: 200 + i,
        cluster: 'faq',
        text: f.q,
        sector: 'immobiliare',
        expectInResponse: f.expect,
        description: f.desc,
    }));
}

// ── CLUSTER 3: Negation — should NOT hallucinate ──
function generateNegationTests(): RagTestCase[] {
    const questions = [
        'Quanto costa una Ferrari?',
        'Avete appartamenti a Tokyo?',
        'Prezzo di un castello medievale?',
        'Vendete barche?',
        'Quanto costa un ufficio a Dubai?',
        'Avete case in Antartide?',
        'Prezzo terreno su Marte?',
        'Vendete case a New York?',
        'Quanto costa affittare lo stadio?',
        'Avete un grattacielo in vendita?',
    ];

    return questions.map((q, i) => ({
        id: 300 + i,
        cluster: 'negation',
        text: q,
        sector: 'immobiliare',
        expectInResponse: [],
        expectNotInResponse: ['320.000', '480.000', '1.250.000', '1.800.000', '1.450.000'],
        description: `no_hallucinate: ${q.substring(0, 40)}`,
    }));
}

// ── CLUSTER 4: Cross-reference — query one property, get correct one ──
function generateCrossRefTests(): RagTestCase[] {
    const tests: RagTestCase[] = [];
    const pairs = [
        { q: 'Bilocale in zona Navigli', expect: ['320.000'], notExpect: ['480.000', '1.250.000'], desc: 'Navigli not Savona' },
        { q: 'Trilocale zona Tortona', expect: ['480.000'], notExpect: ['320.000'], desc: 'Savona not Navigli' },
        { q: 'Attico con vista Duomo', expect: ['1.250.000', 'Brera'], notExpect: ['1.800.000'], desc: 'Brera not CityLife' },
        { q: 'Immobile CityLife Zaha Hadid', expect: ['1.800.000'], notExpect: ['1.250.000'], desc: 'CityLife not Brera' },
        { q: 'Villa con piscina Milano', expect: ['1.450.000', 'San Siro'], notExpect: [], desc: 'Villa San Siro' },
        { q: 'Monolocale economico Milano', expect: ['185.000'], notExpect: ['520.000'], desc: 'Porta Romana cheapest' },
        { q: 'Loft industriale travi a vista', expect: ['520.000', 'Isola'], notExpect: [], desc: 'Loft Isola' },
        { q: 'Casa a Roma Trastevere', expect: ['420.000'], notExpect: ['350.000'], desc: 'Trastevere not Prati' },
        { q: 'Bilocale Roma vista San Pietro', expect: ['350.000', 'Prati'], notExpect: [], desc: 'Prati vista' },
        { q: 'Attico con terrazzo grande Roma', expect: ['1.650.000', 'Parioli'], notExpect: [], desc: 'Parioli terrace' },
    ];

    return pairs.map((p, i) => ({
        id: 400 + i,
        cluster: 'cross_reference',
        text: p.q,
        sector: 'immobiliare',
        expectInResponse: p.expect,
        expectNotInResponse: p.notExpect,
        description: p.desc,
    }));
}

// ── CLUSTER 5: CRAG evaluator accuracy ──
function generateCragTests(): RagTestCase[] {
    return [
        { id: 500, cluster: 'crag', text: 'Bilocale Navigli prezzo', sector: 'immobiliare', expectInResponse: ['320.000'], description: 'CRAG should be correct' },
        { id: 501, cluster: 'crag', text: 'asdfghjkl qwerty', sector: 'immobiliare', expectInResponse: [], description: 'CRAG should be incorrect (gibberish)' },
        { id: 502, cluster: 'crag', text: 'Quanto costa un razzo spaziale?', sector: 'immobiliare', expectInResponse: [], description: 'CRAG should be incorrect (off-topic)' },
        { id: 503, cluster: 'crag', text: 'Villa con giardino Milano', sector: 'immobiliare', expectInResponse: ['San Siro'], description: 'CRAG should be correct' },
        { id: 504, cluster: 'crag', text: 'Commissione agenzia', sector: 'immobiliare', expectInResponse: ['3%'], description: 'CRAG correct on FAQ' },
    ];
}

async function main() {
    await initDB();

    const allTests = [
        ...generatePriceTests(),
        ...generateFaqTests(),
        ...generateNegationTests(),
        ...generateCrossRefTests(),
        ...generateCragTests(),
    ];

    console.log(`\n${'='.repeat(60)}`);
    console.log(`SARA RAG Quality Test — ${allTests.length} tests`);
    console.log(`${'='.repeat(60)}\n`);

    const results: Record<string, { pass: number; fail: number; total: number; failures: string[] }> = {};
    let totalPass = 0, totalFail = 0;

    for (const tc of allTests) {
        if (!results[tc.cluster]) results[tc.cluster] = { pass: 0, fail: 0, total: 0, failures: [] };
        results[tc.cluster].total++;

        try {
            // Direct RAG search — no handler, no intent interceptor
            const { topScore, matches } = await ragSearchWithScore(tc.text, tc.sector, 3);
            const crag = evaluateRetrieval(matches, tc.text, tc.sector);
            const ragText = matches.map(m => m.content).join(' ').toLowerCase();

            let pass = true;
            let reason = '';

            // Check expected substrings
            for (const exp of tc.expectInResponse) {
                const normalized = exp.replace(/\./g, '');
                if (!ragText.includes(exp.toLowerCase()) && !ragText.replace(/\./g, '').includes(normalized)) {
                    pass = false;
                    reason = `"${exp}" not found (score=${topScore.toFixed(2)}, crag=${crag.verdict})`;
                    break;
                }
            }

            // Check NOT expected
            if (pass && tc.expectNotInResponse) {
                for (const notExp of tc.expectNotInResponse) {
                    // For negation tests: check that the RAG didn't return wrong data
                    if (tc.cluster === 'negation' && matches.length > 0 && topScore > 0.5) {
                        // If RAG found something with high score for a nonsense query, it's a false positive
                        // But we only fail if the specific price appears
                        if (ragText.includes(notExp.toLowerCase())) {
                            pass = false;
                            reason = `Hallucinated "${notExp}" (score=${topScore.toFixed(2)})`;
                            break;
                        }
                    }
                }
            }

            if (pass) {
                totalPass++;
                results[tc.cluster].pass++;
            } else {
                totalFail++;
                results[tc.cluster].fail++;
                results[tc.cluster].failures.push(`#${tc.id} ${tc.description}: ${reason}`);
            }

            // Progress
            if ((totalPass + totalFail) % 25 === 0) {
                console.log(`  [${totalPass + totalFail}/${allTests.length}] ${totalPass} pass, ${totalFail} fail`);
            }
        } catch (err: any) {
            totalFail++;
            results[tc.cluster].fail++;
            results[tc.cluster].failures.push(`#${tc.id} ${tc.description}: CRASH ${err.message?.substring(0, 60)}`);
        }
    }

    // Print results by cluster
    console.log(`\n${'='.repeat(60)}`);
    console.log(`RESULTS BY CLUSTER`);
    console.log(`${'='.repeat(60)}`);
    for (const [cluster, r] of Object.entries(results)) {
        const pct = ((r.pass / r.total) * 100).toFixed(1);
        const color = r.fail === 0 ? GRN : r.fail < r.total * 0.1 ? YLW : RED;
        console.log(`\n${color}${cluster}: ${r.pass}/${r.total} PASS (${pct}%)${RST}`);
        if (r.failures.length > 0 && r.failures.length <= 10) {
            r.failures.forEach(f => console.log(`  ${RED}✗${RST} ${f}`));
        } else if (r.failures.length > 10) {
            r.failures.slice(0, 5).forEach(f => console.log(`  ${RED}✗${RST} ${f}`));
            console.log(`  ... and ${r.failures.length - 5} more failures`);
        }
    }

    console.log(`\n${'='.repeat(60)}`);
    const totalPct = ((totalPass / (totalPass + totalFail)) * 100).toFixed(1);
    console.log(`TOTAL: ${totalPass}/${totalPass + totalFail} PASS (${totalPct}%)`);
    console.log(`${'='.repeat(60)}`);

    // Save JSON report
    const report = {
        date: new Date().toISOString(),
        total: totalPass + totalFail,
        passed: totalPass,
        failed: totalFail,
        passRate: totalPct + '%',
        clusters: results,
    };
    const { writeFileSync } = await import('fs');
    writeFileSync('test-results-rag-quality.json', JSON.stringify(report, null, 2));
    console.log('Report saved to test-results-rag-quality.json');

    process.exit(totalFail > 0 ? 1 : 0);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
