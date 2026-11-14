import type {ChartInterval} from './chartData';

export interface ChartSnapshotContext {
    symbol: string;
    name: string;
    interval: ChartInterval;
    captured_at: string;
    comparison_mode?: 'price' | 'return';
    visible_from: string | null;
    visible_to: string | null;
    moving_averages: {period: number; color: string}[];
    indicators: {name: string; settings: Record<string, number>}[];
    comparisons: {symbol: string; name: string; shift: number}[];
}
export interface ChartSnapshot {canvas: HTMLCanvasElement; context: ChartSnapshotContext}
