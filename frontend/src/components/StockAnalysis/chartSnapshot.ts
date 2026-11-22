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

export function chartSnapshotPng(canvas: HTMLCanvasElement, maxDimension = Infinity): Promise<Blob> {
    const ratio = Math.min(1, maxDimension / Math.max(canvas.width, canvas.height));
    let output = canvas;
    if (ratio < 1) {
        output = document.createElement('canvas');
        output.width = Math.max(1, Math.round(canvas.width * ratio));
        output.height = Math.max(1, Math.round(canvas.height * ratio));
        const context = output.getContext('2d');
        if (!context) return Promise.reject(new Error('capture_failed'));
        context.drawImage(canvas, 0, 0, output.width, output.height);
    }
    return new Promise((resolve, reject) => {
        output.toBlob(blob => blob ? resolve(blob) : reject(new Error('capture_failed')), 'image/png');
    });
}
