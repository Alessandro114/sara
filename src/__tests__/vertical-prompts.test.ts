// ═══════════════════════════════════════════════════
// Vertical prompts — vanilla node:assert, same runner as the rest.
// Run: npx tsx src/__tests__/vertical-prompts.test.ts
//
// The prompts are data now (prompts/vertical.<lang>.json), so the thing worth
// guarding is the shape of that data: a language file that forgets a vertical
// would silently serve Italian to those customers, and nothing would say so.
// ═══════════════════════════════════════════════════

import assert from 'node:assert/strict';
import {
    getVerticalPrompt,
    ANTI_HALLUCINATION_FOOTER,
    AVAILABLE_LANGS,
    VERTICAL_KEYS,
} from '../vertical-prompts.js';

const SECTORS = [
    'turismo', 'beauty', 'bellezza', 'pulizie', 'clean', 'dermatologia', 'dermaly',
    'ristorante', 'dine', 'automotive', 'motor', 'network', 'legale', 'commercialista',
    'praxis', 'immobiliare', 'property', 'studio', 'studioos', 'agenzia', 'marketing',
    'agency', 'general', 'scala_user', 'landiq', 'terreni', 'investimento',
    'costruttore', 'builder',
];

function testLanguagesAreSymmetric(): void {
    // The point of the JSON split: adding a language is a data change. This is
    // what makes it safe — a file missing a vertical fails here instead of
    // quietly falling back to Italian in front of a customer.
    assert.ok(AVAILABLE_LANGS.includes('it'), 'Italian is the reference language');
    assert.ok(AVAILABLE_LANGS.length >= 2, 'expected more than one language file');

    for (const lang of AVAILABLE_LANGS) {
        const missing = VERTICAL_KEYS.filter(k => !getVerticalPrompt(k, lang));
        assert.deepEqual(missing, [], `${lang} has no prompt for: ${missing.join(', ')}`);
    }
    console.log(`✅ testLanguagesAreSymmetric: ${AVAILABLE_LANGS.length} languages × ${VERTICAL_KEYS.length} verticals`);
}

function testEveryLanguageHasItsOwnText(): void {
    // Symmetry alone would pass if a language file were a copy of Italian.
    // For a vertical that exists in every file, the text must actually differ.
    for (const lang of AVAILABLE_LANGS.filter(l => l !== 'it')) {
        const it = getVerticalPrompt('ristorante', 'it');
        const other = getVerticalPrompt('ristorante', lang);
        assert.notEqual(other, it, `${lang} returns the Italian text for 'ristorante'`);
        assert.ok(other.length > 200, `${lang} prompt for 'ristorante' is suspiciously short`);
    }
    console.log(`✅ testEveryLanguageHasItsOwnText: ${AVAILABLE_LANGS.length - 1} translations distinct from Italian`);
}

function testEverySectorResolves(): void {
    for (const sector of SECTORS) {
        const p = getVerticalPrompt(sector);
        assert.ok(p.length > 200, `sector '${sector}' resolved to a ${p.length}-char prompt`);
    }
    console.log(`✅ testEverySectorResolves: ${SECTORS.length} sector aliases`);
}

function testFallbacks(): void {
    const general = getVerticalPrompt('general', 'it');

    // Unknown sector falls back to 'general'.
    assert.equal(getVerticalPrompt('SETTORE_INESISTENTE', 'it'), general);
    assert.equal(getVerticalPrompt('', 'it'), general);

    // Unsupported language falls back to Italian, it does not return empty.
    assert.equal(getVerticalPrompt('ristorante', 'de'), getVerticalPrompt('ristorante', 'it'));

    // Regional variants resolve to their base language.
    assert.equal(getVerticalPrompt('ristorante', 'en-US'), getVerticalPrompt('ristorante', 'en'));
    assert.equal(getVerticalPrompt('ristorante', 'pt-BR'), getVerticalPrompt('ristorante', 'pt'));

    // Case is not significant.
    assert.equal(getVerticalPrompt('ristorante', 'EN'), getVerticalPrompt('ristorante', 'en'));

    console.log('✅ testFallbacks: unknown sector, unknown language, regional variants, case');
}

function testAntiHallucinationFooter(): void {
    assert.ok(ANTI_HALLUCINATION_FOOTER.includes('ANTI-ALLUCINAZIONE'));
    assert.ok(ANTI_HALLUCINATION_FOOTER.length > 100);
    // The footer is appended separately by the AI layer; it must not already
    // be baked into the prompts or every reply would carry it twice.
    for (const lang of AVAILABLE_LANGS) {
        for (const key of VERTICAL_KEYS) {
            assert.ok(
                !getVerticalPrompt(key, lang).includes('ANTI-ALLUCINAZIONE'),
                `${lang}/${key} already contains the footer`
            );
        }
    }
    console.log('✅ testAntiHallucinationFooter: present once, never baked into a prompt');
}

testLanguagesAreSymmetric();
testEveryLanguageHasItsOwnText();
testEverySectorResolves();
testFallbacks();
testAntiHallucinationFooter();

console.log('\n🎉 vertical-prompts tests passed');
