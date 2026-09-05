import {describe, expect, it, vi} from 'vitest';
vi.mock('../i18n', () => ({default: {t: (key: string) => key, exists: () => false}}));
import {median, selectBenchmarkSettings} from './modelBenchmark';
import type {VyactModelProfile} from './api';

describe('benchmark settings selection', () => {
    it('preserves context, sampling, threads and GPU allocation', () => {
        const current = {context_size: 32768, cpu_threads: 3, gpu_split_percentages: [60, 40], temperature: 0.4, seed: 42, max_output_tokens: 2048} as VyactModelProfile;
        const candidate = {...current, context_size: 8192, cpu_threads: 8, temperature: 0, performance_mode: 'memory', kv_cache_precision: 'none', mtp_enabled: true} as VyactModelProfile;
        const selected = selectBenchmarkSettings(current, candidate);
        expect(selected).toEqual({...current, performance_mode: 'memory', kv_cache_precision: 'none', cache_quantization: false, mtp_enabled: true});
    });
    it('shows unavailable values instead of inventing measurements', () => {
        expect(median([null, null])).toBeNull();
        expect(median([1, 9, 3])).toBe(3);
        expect(median([1, 3])).toBe(2);
    });
});
