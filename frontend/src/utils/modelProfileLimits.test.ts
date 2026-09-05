import {describe, expect, it} from 'vitest';
import type {VyactModelProfile} from '../services/api';
import {getModelProfileLimits, normalizeModelContext} from './modelProfileLimits';
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
