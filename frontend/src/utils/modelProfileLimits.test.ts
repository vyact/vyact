import {describe, expect, it} from 'vitest';
import type {VyactModelProfile} from '../services/api';
import {getModelProfileLimits, normalizeModelContext, adjustModelContextBudgets} from './modelProfileLimits';
const profile = (value: Partial<VyactModelProfile>) => value as VyactModelProfile;
describe('model profile field limits', () => {
    it('reserves input and output before allowing history', () => {
        const limits = getModelProfileLimits(profile({context_size: 4096, max_output_tokens: 1024}));
        expect(limits.outputMax).toBe(3072);
        expect(limits.historyMax).toBe(2048);
        expect(limits.contextMin).toBe(4096);
    });
    it('honors a model output ceiling smaller than the general floor', () => {
        const limits = getModelProfileLimits(profile({context_size: 4096, max_output_tokens: 64,
            limits: {context_min: 4096, context_max: 8192, output_min: 64, output_max: 64, context_reserve: 1024, cpu_threads_max: 12}}));
        expect(limits.outputMin).toBe(64);
        expect(limits.outputMax).toBe(64);
        expect(limits.contextMax).toBe(8192);
        expect(limits.cpuThreadsMax).toBe(12);
    });
    it('does not impose the old fixed 32K output ceiling', () => {
        expect(getModelProfileLimits(profile({context_size: 131072, max_output_tokens: 65536})).outputMax).toBe(130048);
    });
});


describe('context normalization on blur', () => {
    it('only changes context, preserving independent user budgets', () => {
        const original = profile({context_size: 999999, max_output_tokens: 999999, history_token_budget: 999999,
            limits: {context_min: 4096, context_max: 131072, output_min: 256, output_max: null, context_reserve: 1024, cpu_threads_max: 8}});
        expect(normalizeModelContext(original)).toEqual({...original, context_size: 131072});
        expect(original.context_size).toBe(999999);
    });
    it('does not invent a missing metadata ceiling', () => {
        const original = profile({context_size: 999999, max_output_tokens: 4096});
        expect(normalizeModelContext(original)).toEqual(original);
    });
});

describe('context budget adjustment', () => {
    it('reduces overflowing budgets to fit the context reserve', () => {
        const result = adjustModelContextBudgets(profile({context_size: 32768, max_output_tokens: 130560, history_token_budget: 130560}));
        expect(result.max_output_tokens).toBe(15872);
        expect(result.history_token_budget).toBe(15872);
        expect(result.context_size).toBe(32768);
    });
    it('preserves budgets that already fit when context grows', () => {
        const result = adjustModelContextBudgets(profile({context_size: 65536, max_output_tokens: 4096, history_token_budget: 16384}));
        expect(result.max_output_tokens).toBe(4096);
        expect(result.history_token_budget).toBe(16384);
    });
});

it('keeps the previous budget ratio when shrinking', () => {
    const result = adjustModelContextBudgets(profile({context_size: 32768, max_output_tokens: 32768, history_token_budget: 98304}));
    expect(result.max_output_tokens).toBe(7936);
    expect(result.history_token_budget).toBe(23808);
});
it('preserves explicitly disabled history', () => {
    const result = adjustModelContextBudgets(profile({context_size: 32768, max_output_tokens: 130560, history_token_budget: 0}));
    expect(result.max_output_tokens).toBe(31744);
    expect(result.history_token_budget).toBe(0);
});
it('keeps positive history even with a very large output budget', () => {
    const result = adjustModelContextBudgets(profile({context_size: 4096, max_output_tokens: 130560, history_token_budget: 1}));
    expect(result.history_token_budget).toBe(1);
    expect(result.max_output_tokens + result.history_token_budget).toBeLessThanOrEqual(3072);
});
