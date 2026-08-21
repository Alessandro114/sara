// ═══════════════════════════════════════════════════
// Tests for the text-classification patterns behind conversation memory —
// vanilla node:assert, same runner as every other test in this folder.
// Run: npx tsx src/__tests__/conversation-memory.test.ts
//
// These assert against the patterns the bot actually uses (imported from
// lib/text-patterns.ts). The previous version of this file re-declared its
// own copies of the regexes and asserted on those, so it stayed green while
// the real ones drifted — it was missing bravo|stupendo|wow, among others.
// ═══════════════════════════════════════════════════

import assert from 'node:assert/strict';
import {
    SENTIMENT_POSITIVE,
    SENTIMENT_NEGATIVE,
    STYLE_TECHNICAL,
    STYLE_FORMAL,
    ROLE_KEYWORDS,
    RESUME_COMMAND,
    detectSentiment,
    detectRole,
} from '../lib/text-patterns.js';

function testPositiveSentiment(): void {
    for (const msg of ['Grazie mille!', 'Perfetto, esattamente quello che cercavo', 'wow, stupendo', 'Thanks, excellent']) {
        assert.equal(detectSentiment(msg), 'positive', `expected positive for: ${msg}`);
    }
    assert.equal(SENTIMENT_POSITIVE.test('Non mi piace'), false);
    console.log('✅ testPositiveSentiment: 4 positive messages classified');
}

function testNegativeSentiment(): void {
    for (const msg of ['Ho un problema con il CRM', 'This is a terrible experience', 'There is a bug in the system', 'troppo caro']) {
        assert.equal(detectSentiment(msg), 'negative', `expected negative for: ${msg}`);
    }
    // "bene" is a positive keyword — must not be dragged into negative.
    assert.equal(SENTIMENT_NEGATIVE.test('Tutto bene'), false);
    console.log('✅ testNegativeSentiment: 4 negative messages classified');
}

function testNeutralAndPrecedence(): void {
    assert.equal(detectSentiment('Vorrei sapere gli orari'), 'neutral');
    // Documented precedence: a message carrying both reads as positive.
    assert.equal(detectSentiment('Grazie, ma ho un problema'), 'positive');
    console.log('✅ testNeutralAndPrecedence: neutral + positive-wins precedence');
}

function testCommunicationStyle(): void {
    assert.equal(STYLE_TECHNICAL.test('Qual e il ROI atteso?'), true);
    assert.equal(STYLE_TECHNICAL.test('Avete delle API?'), true);
    assert.equal(STYLE_TECHNICAL.test('come funziona il churn'), true);
    assert.equal(STYLE_TECHNICAL.test('Ciao come stai'), false);
    assert.equal(STYLE_FORMAL.test('Egregio Dottore, cordiali saluti'), true);
    assert.equal(STYLE_FORMAL.test('ciao raga'), false);
    console.log('✅ testCommunicationStyle: technical + formal detection');
}

function testRoleDetection(): void {
    assert.equal(detectRole('Sono il titolare'), 'titolare');
    assert.equal(detectRole('Lavoro come manager'), 'manager');
    assert.equal(detectRole('sono il CTO'), 'cto');
    assert.equal(detectRole('Sono un cliente'), null);
    assert.equal(ROLE_KEYWORDS.test('Sono un cliente'), false);
    console.log('✅ testRoleDetection: 3 roles extracted, non-role rejected');
}

function testResumeCommand(): void {
    assert.equal(RESUME_COMMAND.test('SARA riprendi'), true);
    assert.equal(RESUME_COMMAND.test('sara resume'), true);
    assert.equal(RESUME_COMMAND.test('sara auto'), true);
    // Must anchor at the start — a mention mid-sentence is not a command.
    assert.equal(RESUME_COMMAND.test('ciao sara'), false);
    console.log('✅ testResumeCommand: 3 commands matched, mention rejected');
}

function testNoGlobalFlag(): void {
    // A /g flag would make .test() stateful and every caller order-dependent.
    for (const [name, re] of Object.entries({ SENTIMENT_POSITIVE, SENTIMENT_NEGATIVE, STYLE_TECHNICAL, STYLE_FORMAL, ROLE_KEYWORDS, RESUME_COMMAND })) {
        assert.equal(re.global, false, `${name} must not carry the /g flag`);
    }
    console.log('✅ testNoGlobalFlag: 6 patterns are stateless');
}

testPositiveSentiment();
testNegativeSentiment();
testNeutralAndPrecedence();
testCommunicationStyle();
testRoleDetection();
testResumeCommand();
testNoGlobalFlag();

console.log('\n🎉 conversation-memory pattern tests passed');
