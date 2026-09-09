import {describe, expect, it} from 'vitest';
import type {VyactModelProfile} from '../services/api';
import {getModelProfileLimits, normalizeModelContext, isModelTokenBudgetValid, getModelTokenBudgetStatus} from './modelProfileLimits';
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

it('accepts automatic token caps without changing them', () => {
    const original = profile({context_size: 4096, max_output_tokens: null, history_token_budget: null});
    expect(normalizeModelContext(original)).toEqual(original);
    expect(getModelProfileLimits(original).historyMax).toBe(3072);
});

describe('manual token budget validation', () => {
    it.each([
        [32768, 2000, false], [null, null, true], [128, null, true],
        [null, 2000, true], [30720, 1024, true], [30720, 1025, false],
        [null, 31744, false], [null, 31743, true], [128, 0, true],
    ])('validates output %s and history %s', (output, history, valid) => {
        expect(isModelTokenBudgetValid(profile({context_size: 32768,
            max_output_tokens: output, history_token_budget: history}))).toBe(valid);
    });
    it('revalidates after context is reduced', () => {
        expect(isModelTokenBudgetValid(profile({context_size: 4096,
            max_output_tokens: 2048, history_token_budget: 2048}))).toBe(false);
    });
    it('honors the model output limit', () => {
        expect(isModelTokenBudgetValid(profile({context_size: 32768,
            max_output_tokens: 1025, history_token_budget: 0,
            limits: {output_max: 1024} as VyactModelProfile['limits']}))).toBe(false);
    });
});

it('reports the exact reduction for the displayed overflowing history', () => {
    expect(getModelTokenBudgetStatus(profile({context_size: 32768, max_output_tokens: 1000,
        history_token_budget: 259768}))).toMatchObject({limit: 31744, total: 260768, excess: 229024, outputExcess: 0});
});
it('reports an output-only overflow independently of the combined budget', () => {
    expect(getModelTokenBudgetStatus(profile({context_size: 32768, max_output_tokens: 2000,
        history_token_budget: 0, limits: {output_max: 1024} as VyactModelProfile['limits']})))
        .toMatchObject({excess: 0, outputExcess: 976});
});

it('reports both reductions when output and history each equal context', () => {
    expect(getModelTokenBudgetStatus(profile({context_size: 32768, max_output_tokens: 32768,
        history_token_budget: 32768}))).toMatchObject({limit: 31744, total: 65536, excess: 33792, outputExcess: 1024});
});
