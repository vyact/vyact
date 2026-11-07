import {createSeriesMarkers, LineSeries, type IChartApi, type ISeriesApi, type MouseEventParams, type SeriesMarker, type Time} from 'lightweight-charts';
import type {DailyPrice} from '../../services/stockAnalysis';

type Point = {day: string; value: number; index: number};
type Measurement = {line: ISeriesApi<'Line'>; markers: SeriesMarker<Time>[]; end: Point; label: HTMLSpanElement};

export function chartDay(time: Time | undefined): string | undefined {
    if (typeof time === 'string') return time;
    if (typeof time === 'object') {
        return [time.year, String(time.month).padStart(2, '0'), String(time.day).padStart(2, '0')].join('-');
    }
}

export function attachChartRuler(
    chart: IChartApi, candles: ISeriesApi<'Candlestick'>, rows: DailyPrice[],
    formatResult: (change: number, periods: number) => string, colors: {rise: string; fall: string},
) {
    let enabled = false;
    let updatingPreview = false;
    let start: Point | undefined;
    let key: string | undefined;
    const measurements: Measurement[] = [];
    const element = chart.chartElement();
    const RULER_COLOR = getComputedStyle(element).getPropertyValue('--info').trim() || '#60a5fa';
    const scale = chart.timeScale();
    let labelFrame = 0;
    const positionLabels = () => {
        if (labelFrame || !measurements.length) return;
        labelFrame = requestAnimationFrame(() => {
            labelFrame = 0;
            const {width, height} = chart.paneSize(0);
            for (const {end, label} of measurements) {
                const x = scale.timeToCoordinate(end.day);
                const y = candles.priceToCoordinate(end.value);
                label.hidden = x === null || y === null || x < 0 || x >= width || y < 0 || y >= height;
                if (label.hidden || x === null || y === null) continue;
                const half = label.offsetWidth / 2;
                label.style.left = `${Math.max(half, Math.min(width - half, x))}px`;
                label.style.top = `${Math.max(label.offsetHeight + 6, y)}px`;
            }
        });
    };
    let pointerStart: {x: number; y: number} | undefined;
    const byDay = new Map(rows.map((row, index) => [row.day, {row, index}]));
    const markerPlugin = createSeriesMarkers(candles, [], {autoScale: false});
    const createLine = () => chart.addSeries(LineSeries, {
        color: RULER_COLOR, lineWidth: 2, lastValueVisible: false,
        priceLineVisible: false, crosshairMarkerVisible: false,
    });
    const preview = createLine();
    const dot = (point: Point): SeriesMarker<Time> => ({
        time: point.day, price: point.value, position: 'atPriceMiddle', shape: 'circle', color: RULER_COLOR,
    });
    const updateMarkers = () => markerPlugin.setMarkers([
        ...measurements.flatMap(measurement => measurement.markers), ...(start ? [dot(start)] : []),
    ].sort((left, right) => String(left.time).localeCompare(String(right.time))));
    const getPoint = (time: Time | undefined): Point | undefined => {
        const day = chartDay(time);
        const match = day ? byDay.get(day) : undefined;
        if (!match) return;
        const {row, index} = match;
        const value = key === 'KeyH' ? row.high : key === 'KeyL' ? row.low : key === 'KeyO' ? row.open : row.close;
        return {day: row.day, value, index};
    };
    const setLine = (line: ISeriesApi<'Line'>, first: Point, last: Point) => {
        line.setData([{time: first.day, value: first.value}, {time: last.day, value: last.value}]);
    };
    const onMove = (event: MouseEventParams) => {
        if (!enabled || !start || updatingPreview) return;
        const end = event.paneIndex === 0 && event.point ? getPoint(event.time) : undefined;
        // Updating a series can synchronously emit another crosshair event.
        updatingPreview = true;
        try {
            if (!end || end.index === start.index) {
                preview.setData([]);
                return;
            }
            const [first, last] = start.index < end.index ? [start, end] : [end, start];
            setLine(preview, first, last);
        } finally {
            updatingPreview = false;
        }
    };
    const onPointerDown = (event: PointerEvent) => {
        pointerStart = {x: event.clientX, y: event.clientY};
    };
    // The chart can suppress a second click during its double-click window.
    const onClick = (event: MouseEvent) => {
        if (!enabled || !pointerStart || Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) > 5) return;
        const bounds = element.getBoundingClientRect();
        const x = event.clientX - bounds.left;
        const y = event.clientY - bounds.top;
        const pane = chart.paneSize(0);
        if (x < 0 || x >= pane.width || y < 0 || y >= pane.height) return;
        const end = getPoint(chart.timeScale().coordinateToTime(x) ?? undefined);
        if (!end) return;
        if (!start) {
            start = end;
            updateMarkers();
            return;
        }
        if (start.index === end.index) return;
        const [first, last] = start.index < end.index ? [start, end] : [end, start];
        const line = createLine();
        setLine(line, first, last);
        const change = (last.value - first.value) / first.value;
        const text = formatResult(change, last.index - first.index);
        const label = document.createElement('span');
        label.className = 'stock-chart-ruler-label';
        label.textContent = text;
        label.style.color = change < 0 ? colors.fall : colors.rise;
        label.hidden = true;
        element.appendChild(label);
        measurements.push({line, markers: [dot(first), dot(last)], end: last, label});
        positionLabels();
        start = undefined;
        preview.setData([]);
        updateMarkers();
    };
    const keyDown = (event: KeyboardEvent) => {
        if (!enabled || event.metaKey || event.ctrlKey || event.altKey || event.isComposing ||
            (event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable="true"], .app-modal-overlay'))) return;
        if (event.code === 'KeyH' || event.code === 'KeyL' || event.code === 'KeyO') key = event.code;
    };
    const keyUp = (event: KeyboardEvent) => {if (key === event.code) key = undefined;};
    const resetKey = () => {key = undefined;};

    element.addEventListener('pointerdown', onPointerDown);
    element.addEventListener('click', onClick);
    chart.subscribeCrosshairMove(onMove);
    chart.subscribeCrosshairMove(positionLabels);
    scale.subscribeVisibleLogicalRangeChange(positionLabels);
    const observer = new ResizeObserver(positionLabels);
    observer.observe(element);
    window.addEventListener('keydown', keyDown);
    window.addEventListener('keyup', keyUp);
    window.addEventListener('blur', resetKey);

    return {
        setEnabled(value: boolean) {
            enabled = value;
            if (!value) {
                key = undefined;
                start = undefined;
                preview.setData([]);
                updateMarkers();
            }
        },
        undo() {
            const previous = measurements.pop();
            if (previous) {
                chart.removeSeries(previous.line);
                previous.label.remove();
            }
            updateMarkers();
        },
        clear() {
            start = undefined;
            preview.setData([]);
            for (const {line, label} of measurements.splice(0)) {
                chart.removeSeries(line);
                label.remove();
            }
            updateMarkers();
        },
        dispose() {
            element.removeEventListener('pointerdown', onPointerDown);
            element.removeEventListener('click', onClick);
            chart.unsubscribeCrosshairMove(onMove);
            chart.unsubscribeCrosshairMove(positionLabels);
            scale.unsubscribeVisibleLogicalRangeChange(positionLabels);
            observer.disconnect();
            cancelAnimationFrame(labelFrame);
            for (const {label} of measurements) label.remove();
            window.removeEventListener('keydown', keyDown);
            window.removeEventListener('keyup', keyUp);
            window.removeEventListener('blur', resetKey);
        },
    };
}
