import type {VyactModelProfile} from '../services/api';

// Application input guards, not model capability limits.
export const MODEL_SETTING_INPUT_MAX = {
    tokens: 16777216,
    temperature: 10,
    topK: 1048576,
    cpuThreads: 1024,
    seed: 2147483647,
} as const;

export const getModelProfileLimits = (profile: VyactModelProfile) => {
    const limits = profile.limits;
    const contextMin = limits?.context_min ?? 4096;
    const reserve = Math.min(limits?.context_reserve ?? 1024, Math.floor(profile.context_size / 2));
    const outputMax = Math.max(1, Math.min(limits?.output_max ?? profile.context_size, profile.context_size - reserve));
    return {
        contextMin,
        contextMax: limits?.context_max ?? undefined,
        outputMin: Math.min(limits?.output_min ?? 256, outputMax),
        outputMax,
        historyMax: Math.max(0, profile.context_size - profile.max_output_tokens - reserve),
        cpuThreadsMax: limits?.cpu_threads_max ?? 1,
    };
};

export const normalizeModelContext = (profile: VyactModelProfile): VyactModelProfile => {
    const {contextMin, contextMax} = getModelProfileLimits(profile);
    const value = Number.isFinite(profile.context_size) ? Math.trunc(profile.context_size) : contextMin;
    return {...profile, context_size: Math.min(contextMax ?? MODEL_SETTING_INPUT_MAX.tokens, Math.max(contextMin, value))};
};
