import type {VyactModelProfile} from '../services/api';

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
