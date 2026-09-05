import type {VyactModelProfile} from './api';
import {assertOk} from '../utils/apiError';

export type BenchmarkSample = {prefill_s: number | null; prefill_tps: number | null; ttft_s: number | null; decode_tps: number | null; total_s: number; cached_tokens: number | null; input_tokens: number | null; output_tokens: number | null; finish_reason: string};
export type BenchmarkRow = {id: string; profile: VyactModelProfile; error: string | null; samples: Record<string, BenchmarkSample[]>};
export type BenchmarkJob = {id: string; model_path: string; status: string; phase: string; rows: BenchmarkRow[]; completed: number; total: number; selected_cases: Array<{id: string; profile: VyactModelProfile}>; cases_completed: number; cases_total: number; current?: string; created_at: string; recommended: string | null; base_profile: VyactModelProfile; mtp_supported: boolean; estimated_remaining_s: number | null};
export type BenchmarkState = {job: BenchmarkJob | null; last_completed: BenchmarkJob | null; busy: boolean; stale: boolean};
const endpoint = '/api/vyact/models/benchmark';
async function json<T>(url: string, init?: RequestInit): Promise<T> {
    const response = await fetch(url, init);
    await assertOk(response);
    return response.json();
}
export const modelBenchmark = {
    read: (modelPath: string) => json<BenchmarkState>(`${endpoint}?${new URLSearchParams({model_path: modelPath})}`),
    plan: (profile: VyactModelProfile) => json<{plan_id: string; cases: Array<{id: string; profile: VyactModelProfile}>; mtp_supported: boolean}>(`${endpoint}/plan`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(profile)}),
    start: (profile: VyactModelProfile, selected_case_ids: string[], plan_id: string) => json<BenchmarkJob>(endpoint, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({...profile, selected_case_ids, plan_id})}),
    stop: () => json(`${endpoint}/stop`, {method: 'POST'}),
    save: () => json(`${endpoint}/save`, {method: 'POST'}),
};
export function selectBenchmarkSettings(current: VyactModelProfile, result: VyactModelProfile): VyactModelProfile {
    return {...current, ...(current.runtime === 'mlx' ? {} : {performance_mode: result.performance_mode,
        kv_cache_precision: result.kv_cache_precision, cache_quantization: result.kv_cache_precision !== 'none'}), mtp_enabled: result.mtp_enabled};
}
export function benchmarkConditionsMatch(current: VyactModelProfile, tested: VyactModelProfile): boolean {
    return (['model_path', 'runtime', 'context_size', 'max_output_tokens', 'history_token_budget', 'temperature', 'top_k', 'top_p', 'seed', 'cpu_threads', 'gpu_split_percentages', 'gpu_manual_split_enabled'] as const)
        .every(key => JSON.stringify(current[key] ?? null) === JSON.stringify(tested[key] ?? null));
}
export function median(values: Array<number | null>): number | null {
    const sorted = values.filter((value): value is number => value !== null && Number.isFinite(value)).sort((a, b) => a - b);
    if (!sorted.length) return null;
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

// Match the server's recommendation score: TTFT + time for 256 output tokens.
const BENCHMARK_SCORE_OUTPUT_TOKENS = 256;
export function benchmarkRowScore(row: BenchmarkRow): number {
    if (row.error) return Infinity;
    let score = 0;
    for (const workload of ['short', 'long', 'followup']) {
        const samples = row.samples[workload];
        if (!samples?.length || samples.some(sample => sample.ttft_s === null
            || !Number.isFinite(sample.ttft_s) || !sample.decode_tps || !Number.isFinite(sample.decode_tps) || sample.decode_tps < 0)) return Infinity;
        score += median(samples.map(sample => sample.ttft_s! + BENCHMARK_SCORE_OUTPUT_TOKENS / sample.decode_tps!))!;
    }
    return score;
}

export function orderBenchmarkRows(rows: BenchmarkRow[], running: boolean): BenchmarkRow[] {
    if (running) return rows;
    return rows.map(row => ({row, score: benchmarkRowScore(row)}))
        .sort((a, b) => a.score === b.score ? 0 : a.score - b.score)
        .map(({row}) => row);
}
