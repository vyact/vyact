import {LineSeries, type IChartApi, type ISeriesApi, type IPriceLine, type MouseEventParams} from 'lightweight-charts';
import type {DailyPrice} from '../../services/stockAnalysis';
import {chartDay} from './chartRuler';

export type DrawingMode = 'horizontal' | 'trend' | null;
type DrawingPoint = {day: string; value: number};
type Drawing = {kind: 'horizontal'; value: number} | {kind: 'trend'; start: DrawingPoint; end: DrawingPoint};
const MAX_DRAWINGS = 100;

export function attachChartDrawings(chart: IChartApi, candles: ISeriesApi<'Candlestick'>, initialRows: DailyPrice[], onDrawingChange?: (active: boolean) => void) {
    let drawings: Drawing[] = [];
    let rows = initialRows;
    let mode: DrawingMode = null;
    let start: DrawingPoint | undefined;
    let updating = false;
    let snapField: 'high' | 'low' | 'open' | 'close' | undefined;
    const snapFields = {KeyH: 'high', KeyL: 'low', KeyO: 'open', KeyC: 'close'} as const;
    const element = chart.chartElement();
    const color = getComputedStyle(element).getPropertyValue('--warn').trim() || '#f59e0b';
    const lines: ISeriesApi<'Line'>[] = [];
    const levels: IPriceLine[] = [];
    const makeLine = (preview = false) => chart.addSeries(LineSeries, {color, lineWidth: 2, lineStyle: preview ? 2 : 0,
        lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false,
        autoscaleInfoProvider: () => null});
    const preview = makeLine(true);
    const mappedDay = (day: string) => {
        if (!rows.length || day < rows[0].day) return undefined;
        for (let index = rows.length - 1; index >= 0; index--) if (rows[index].day <= day) return rows[index].day;
    };
    const points = (first: DrawingPoint, last: DrawingPoint) => {
        const from = mappedDay(first.day), to = mappedDay(last.day);
        if (!from || !to || from === to) return [];
        return [{time: from, value: first.value}, {time: to, value: last.value}].sort((a, b) => a.time.localeCompare(b.time));
    };
    const render = () => {
        lines.splice(0).forEach(line => chart.removeSeries(line));
        levels.splice(0).forEach(line => candles.removePriceLine(line));
        drawings.forEach(drawing => {
            if (drawing.kind === 'horizontal') levels.push(candles.createPriceLine({price: drawing.value, color, lineWidth: 2, lineStyle: 0, axisLabelVisible: true, title: ''}));
            else {const line = makeLine(); line.setData(points(drawing.start, drawing.end)); lines.push(line);}
        });
    };
    render();
    const getPoint = (x: number, y: number): DrawingPoint | undefined => {
        const pane = chart.paneSize(0);
        if (x < 0 || y < 0 || x >= pane.width || y >= pane.height) return;
        const day = chartDay(chart.timeScale().coordinateToTime(x) ?? undefined);
        const row = snapField ? rows.find(row => row.day === day) : undefined;
        const value = snapField ? row?.[snapField] : candles.coordinateToPrice(y);
        if (day && value !== null && value !== undefined && Number.isFinite(value)) return {day, value};
    };
    let pointer: {x: number; y: number} | undefined;
    const down = (event: PointerEvent) => {pointer = {x: event.clientX, y: event.clientY};};
    const click = (event: MouseEvent) => {
        if (!mode || !pointer || Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) > 5) return;
        const bounds = element.getBoundingClientRect();
        const point = getPoint(event.clientX - bounds.left, event.clientY - bounds.top);
        if (!point) return;
        if (mode === 'horizontal') drawings.push({kind: 'horizontal', value: point.value});
        else if (!start) {start = point; onDrawingChange?.(true); return;}
        else {
            if (start.day === point.day) return;
            drawings.push({kind: 'trend', start, end: point});
            start = undefined;
            onDrawingChange?.(false);
        }
        drawings = drawings.slice(-MAX_DRAWINGS);
        preview.setData([]); render();
    };
    let hoverPoint: {x: number; y: number} | undefined;
    const updatePreview = () => {
        if (!mode || updating) return;
        updating = true;
        try {
            const end = hoverPoint ? getPoint(hoverPoint.x, hoverPoint.y) : undefined;
            if (end) chart.setCrosshairPosition(end.value, end.day, candles);
            if (start) preview.setData(end ? points(start, end) : []);
        } finally {updating = false;}
    };
    const move = (event: MouseEventParams) => {
        if (updating) return;
        if (event.paneIndex !== 0 || !event.point) {hoverPoint = undefined; return;}
        updatePreview();
    };
    const pointerMove = (event: MouseEvent) => {
        const bounds = element.getBoundingClientRect();
        hoverPoint = {x: event.clientX - bounds.left, y: event.clientY - bounds.top};
        updatePreview();
    };
    const pointerLeave = () => {hoverPoint = undefined;};
    const cancel = () => {start = undefined; onDrawingChange?.(false); preview.setData([]);};
    const resetSnap = () => {snapField = undefined; updatePreview();};
    const keydown = (event: KeyboardEvent) => {
        if (!mode || event.metaKey || event.ctrlKey || event.altKey || event.isComposing ||
            (event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable="true"], .app-modal-overlay'))) return;
        if (event.key === 'Escape') cancel();
        if (event.code in snapFields) {
            snapField = snapFields[event.code as keyof typeof snapFields];
            updatePreview();
        }
    };
    const keyup = (event: KeyboardEvent) => {
        if (event.code in snapFields && snapField === snapFields[event.code as keyof typeof snapFields]) resetSnap();
    };
    element.addEventListener('mousemove', pointerMove, true);
    element.addEventListener('mouseleave', pointerLeave);
    element.addEventListener('pointerdown', down);
    element.addEventListener('click', click);
    window.addEventListener('keydown', keydown);
    window.addEventListener('keyup', keyup);
    window.addEventListener('blur', resetSnap);
    chart.subscribeCrosshairMove(move);
    return {
        setMode(value: DrawingMode) {mode = value; resetSnap(); cancel();},
        setRows(value: DailyPrice[]) {rows = value; cancel(); render();},
        undo() {cancel(); drawings.pop(); render();},
        clear() {cancel(); drawings = []; render();},
        dispose() {
            onDrawingChange?.(false);
            element.removeEventListener('mousemove', pointerMove, true);
            element.removeEventListener('mouseleave', pointerLeave);
            element.removeEventListener('pointerdown', down); element.removeEventListener('click', click);
            window.removeEventListener('keydown', keydown);
            window.removeEventListener('keyup', keyup);
            window.removeEventListener('blur', resetSnap);
            chart.unsubscribeCrosshairMove(move);
        },
    };
}
