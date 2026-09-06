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

export const adjustModelContextBudgets = (profile: VyactModelProfile): VyactModelProfile => {
    const normalized = normalizeModelContext(profile);
    const limits = getModelProfileLimits(normalized);
    const availableBudget = getModelProfileLimits({...normalized, max_output_tokens: 0}).historyMax;
    const totalBudget = normalized.max_output_tokens + normalized.history_token_budget;
    const scale = totalBudget > availableBudget ? availableBudget / totalBudget : 1;
    const historyMinimum = normalized.history_token_budget > 0 ? 1 : 0;
    const max_output_tokens = Math.min(
        limits.outputMax,
        availableBudget - historyMinimum,
        Math.max(1, Math.floor(normalized.max_output_tokens * scale)),
    );
    const history_token_budget = Math.min(
        availableBudget - max_output_tokens,
        Math.max(historyMinimum, Math.floor(normalized.history_token_budget * scale)),
    );
    return {...normalized, max_output_tokens, history_token_budget};
};
