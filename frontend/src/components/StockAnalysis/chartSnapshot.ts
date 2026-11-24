import type {ChartInterval} from './chartData';

export const MAX_CHAT_IMAGE_DIMENSION = 2048;
const CHAT_IMAGE_MAX_BYTES = 1024 * 1024;
const CHAT_PNG_OPTIMIZATION_BUDGET_MS = 1800;

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

export function drawChartIndicatorLegends(canvas: HTMLCanvasElement, chartElement: HTMLElement) {
    const legends = chartElement.querySelectorAll<HTMLElement>('.stock-indicator-legend');
    if (!legends.length) return;
    const bounds = chartElement.getBoundingClientRect();
    const context = canvas.getContext('2d');
    if (!context || !bounds.width || !bounds.height) return;

    // Chart screenshots use bitmap pixels, while legend positions use CSS pixels.
    context.save();
    context.scale(canvas.width / bounds.width, canvas.height / bounds.height);
    for (const legend of legends) {
        const {left, top, width, height} = legend.getBoundingClientRect();
        if (!width || !height) continue;
        const style = getComputedStyle(legend);
        context.save();
        context.beginPath();
        context.roundRect(left - bounds.left, top - bounds.top, width, height, parseFloat(style.borderRadius) || 0);
        context.fillStyle = style.backgroundColor;
        context.fill();
        context.clip();
        context.textAlign = 'left';
        context.textBaseline = 'middle';
        for (const label of legend.querySelectorAll<HTMLElement>(':scope > strong, :scope > span')) {
            const labelBounds = label.getBoundingClientRect();
            const labelStyle = getComputedStyle(label);
            context.fillStyle = labelStyle.color;
            context.font = `${labelStyle.fontWeight} ${labelStyle.fontSize} ${labelStyle.fontFamily}`;
            context.fillText(label.textContent ?? '', labelBounds.left - bounds.left,
                labelBounds.top - bounds.top + labelBounds.height / 2);
        }
        context.restore();
    }
    context.restore();
}

export function chartSnapshotPng(canvas: HTMLCanvasElement): Promise<Blob> {
    return new Promise((resolve, reject) => {
        canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('capture_failed')), 'image/png');
    });
}

function optimizeChatPng(png: Blob, timeBudget: number): Promise<Blob> {
    if (timeBudget <= 0) return Promise.resolve(png);
    return new Promise(resolve => {
        let worker: Worker;
        try {
            worker = new Worker(new URL('./chatPngOptimizer.worker.ts', import.meta.url), {type: 'module'});
        } catch {
            resolve(png);
            return;
        }
        const finish = (result: Blob) => {
            window.clearTimeout(timeout);
            worker.terminate();
            resolve(result);
        };
        const timeout = window.setTimeout(() => finish(png), timeBudget);
        worker.onmessage = ({data}: MessageEvent<Blob>) => {
            finish(data instanceof Blob && data.size > 0 && data.size < png.size ? data : png);
        };
        worker.onerror = () => finish(png);
        worker.postMessage(png);
    });
}

export async function chatSnapshotPng(source: HTMLCanvasElement): Promise<Blob> {
    const originalDimension = Math.max(source.width, source.height);
    let dimension = Math.min(originalDimension, MAX_CHAT_IMAGE_DIMENSION);
    const optimizeUntil = performance.now() + CHAT_PNG_OPTIMIZATION_BUDGET_MS;
    for (;;) {
        let output = source;
        if (dimension < originalDimension) {
            const scale = dimension / originalDimension;
            output = document.createElement('canvas');
            output.width = Math.max(1, Math.round(source.width * scale));
            output.height = Math.max(1, Math.round(source.height * scale));
            const context = output.getContext('2d');
            if (!context) throw new Error('capture_failed');
            context.imageSmoothingQuality = 'high';
            context.drawImage(source, 0, 0, output.width, output.height);
        }

        const encoded = await chartSnapshotPng(output);
        const png = await optimizeChatPng(encoded, optimizeUntil - performance.now());
        if (png.size <= CHAT_IMAGE_MAX_BYTES) return png;
        if (dimension <= 1) throw new Error('capture_failed');

        const scale = Math.min(0.85, Math.sqrt(CHAT_IMAGE_MAX_BYTES / png.size));
        dimension = Math.max(1, Math.floor(dimension * scale));
    }
}
