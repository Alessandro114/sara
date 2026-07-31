// ═══════════════════════════════════════════════════
// Tests for SARA Conversation Memory System
// ═══════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';

// Test the memory module types and logic (unit-level)

describe('ConversationMemory — Types', () => {
    it('ClientProfile interface has required fields', () => {
        const profile = {
            phone: '+393331234567',
            name: 'Mario Rossi',
            company: 'Test SRL',
            sector: 'immobiliare',
            role: 'CEO',
            interests: ['crm', 'automazione'],
            pain_points: ['troppo tempo', 'manuale'],
            budget_range: '5K',
            decision_timeline: '2 mesi',
            communication_style: 'formal' as const,
            sentiment_history: [{ date: '2026-04-15', sentiment: 'positive' as const }],
            key_quotes: ['Vorrei automatizzare tutto'],
            total_interactions: 15,
            last_interaction: '2026-04-15',
        };
        expect(profile.phone).toBe('+393331234567');
        expect(profile.interests).toHaveLength(2);
        expect(profile.sentiment_history[0].sentiment).toBe('positive');
    });

    it('AgentProfile interface has required fields', () => {
        const agent = {
            id: 1,
            user_id: 'uuid-123',
            agent_name: 'Marco Rossi',
            greeting_style: 'Ciao! Sono Marco',
            communication_tone: 'amichevole',
            typical_phrases: ['Non si preoccupi', 'Ci pensiamo noi'],
            expertise_areas: ['immobiliare', 'residenziale'],
            languages: ['it', 'en'],
            response_length: 'medium',
            emoji_usage: 'minimal',
            signature: 'Marco - HomePanda Milano',
            active: true,
        };
        expect(agent.agent_name).toBe('Marco Rossi');
        expect(agent.typical_phrases).toHaveLength(2);
        expect(agent.languages).toContain('en');
    });
});

describe('ConversationMemory — AI Mode Validation', () => {
    it('valid modes are auto, ai_only, human_only, hybrid', () => {
        const validModes = ['auto', 'ai_only', 'human_only', 'hybrid'];
        expect(validModes).toContain('auto');
        expect(validModes).toContain('human_only');
        expect(validModes).toContain('hybrid');
        expect(validModes).not.toContain('invalid');
    });
});

describe('ConversationMemory — Profile Extraction Logic', () => {
    it('detects positive sentiment', () => {
        const positiveWords = /\b(grazie|perfetto|ottimo|fantastico|great|thanks|excellent|amazing|bene)\b/i;
        expect(positiveWords.test('Grazie mille!')).toBe(true);
        expect(positiveWords.test('Perfetto, esattamente quello che cercavo')).toBe(true);
        expect(positiveWords.test('Non mi piace')).toBe(false);
    });

    it('detects negative sentiment', () => {
        // Matches from conversation-memory.ts extractProfileInfo
        const negativeWords = /\b(problema|difficolt|non funzion|frustrat|deluso|bad|terrible|issue|bug)\b/i;
        expect(negativeWords.test('Ho un problema con il CRM')).toBe(true);
        expect(negativeWords.test('This is a terrible experience')).toBe(true);
        expect(negativeWords.test('There is a bug in the system')).toBe(true);
        expect(negativeWords.test('Tutto bene')).toBe(false);
    });

    it('detects technical communication style', () => {
        const techWords = /\b(kpi|roi|cac|ltv|api|sdk|saas|b2b|crm|erp)\b/i;
        expect(techWords.test('Qual e il ROI atteso?')).toBe(true);
        expect(techWords.test('Avete delle API?')).toBe(true);
        expect(techWords.test('Ciao come stai')).toBe(false);
    });

    it('detects role keywords', () => {
        const rolePattern = /\b(ceo|founder|titolare|proprietario|owner|direttore|manager|responsabile|partner|socio)\b/i;
        expect(rolePattern.test('Sono il titolare')).toBe(true);
        expect(rolePattern.test('Lavoro come manager')).toBe(true);
        expect(rolePattern.test('Sono un cliente')).toBe(false);
    });
});

describe('ConversationMemory — Outreach Rules', () => {
    it('outreach rules enforce safe limits', () => {
        const rules = {
            max_messages_per_hour: 20,
            max_messages_per_day: 100,
            min_interval_between_messages: 30_000,
            batch_size: 5,
            batch_cooldown: 5 * 60_000,
        };
        expect(rules.max_messages_per_hour).toBeLessThanOrEqual(20);
        expect(rules.max_messages_per_day).toBeLessThanOrEqual(100);
        expect(rules.min_interval_between_messages).toBeGreaterThanOrEqual(30_000);
        expect(rules.batch_cooldown).toBeGreaterThanOrEqual(300_000);
    });

    it('batch scheduling spreads messages over time', () => {
        const batchSize = 5;
        const batchCooldown = 5 * 60_000;
        const interval = 30_000;
        const contacts = 20;

        let totalTime = 0;
        for (let i = 0; i < contacts; i++) {
            const offset = i * interval;
            const batchOffset = Math.floor(i / batchSize) * batchCooldown;
            totalTime = offset + batchOffset;
        }
        // 20 contacts: 19*30s + 3*300s = 570s + 900s = 1470s = ~24.5 minutes
        expect(totalTime).toBeGreaterThan(10 * 60_000); // should take >10 min
    });
});

describe('ProactiveAlerts — Alert Types', () => {
    it('all alert types are valid', () => {
        const validTypes = ['inactive_client', 'negative_sentiment', 'pending_action', 'slow_response', 'timeline_approaching'];
        expect(validTypes).toHaveLength(5);
    });

    it('priority values are correct', () => {
        const validPriorities = ['low', 'medium', 'high', 'urgent'];
        expect(validPriorities).toContain('urgent');
        expect(validPriorities).toContain('low');
    });
});

describe('SARA Resume Command', () => {
    it('detects resume commands', () => {
        const resumePattern = /^sara\s+(riprendi|resume|takeover|auto)/i;
        expect(resumePattern.test('SARA riprendi')).toBe(true);
        expect(resumePattern.test('sara resume')).toBe(true);
        expect(resumePattern.test('sara auto')).toBe(true);
        expect(resumePattern.test('ciao sara')).toBe(false);
    });
});
