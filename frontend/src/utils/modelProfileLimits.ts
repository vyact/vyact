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
        tokenBudget: Math.max(0, profile.context_size - reserve),
        contextMin,
        contextMax: limits?.context_max ?? undefined,
        outputMin: Math.min(limits?.output_min ?? 256, outputMax),
        outputMax,
        historyMax: Math.max(0, profile.context_size - (profile.max_output_tokens ?? 0) - reserve),
        cpuThreadsMax: limits?.cpu_threads_max ?? 1,
    };
};

export const normalizeModelContext = (profile: VyactModelProfile): VyactModelProfile => {
    const {contextMin, contextMax} = getModelProfileLimits(profile);
    const value = Number.isFinite(profile.context_size) ? Math.trunc(profile.context_size) : contextMin;
    return {...profile, context_size: Math.min(contextMax ?? MODEL_SETTING_INPUT_MAX.tokens, Math.max(contextMin, value))};
};

export const getModelTokenBudgetStatus = (profile: VyactModelProfile) => {
    const {tokenBudget, outputMax} = getModelProfileLimits(profile);
    const output = profile.max_output_tokens ?? 1;
    const history = profile.history_token_budget ?? 0;
    const total = output + history;
    return {
        total, limit: tokenBudget, excess: Math.max(0, total - tokenBudget),
        output, outputLimit: outputMax, outputExcess: Math.max(0, output - outputMax),
        valid: Number.isInteger(output) && output >= 1 && output <= outputMax
            && Number.isInteger(history) && history >= 0 && total <= tokenBudget,
    };
};

export const isModelTokenBudgetValid = (profile: VyactModelProfile): boolean => getModelTokenBudgetStatus(profile).valid;
