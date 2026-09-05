import {describe, expect, it} from 'vitest';
import type {VyactModelProfile} from '../services/api';
import {getModelProfileLimits} from './modelProfileLimits';
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
