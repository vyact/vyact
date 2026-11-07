import {useEffect, useMemo, useState, type RefObject} from 'react';
import type {IChartApi, ISeriesApi} from 'lightweight-charts';
import type {DailyPrice, StockMemo} from '../../services/stockAnalysis';
import {periodKey, type ChartInterval} from './chartData';

type Marker = {memo: StockMemo; x: number; y: number};

export default function useStockMemoMarkers(
    chart: RefObject<IChartApi | null>, candles: RefObject<ISeriesApi<'Candlestick'> | null>,
    bars: DailyPrice[], interval: ChartInterval, memos: StockMemo[], chartRevision: unknown,
) {
    const [markers, setMarkers] = useState<Marker[]>([]);
    const groups = useMemo(() => {
        const byPeriod = new Map<string, StockMemo[]>();
        for (const memo of memos) {
            const key = periodKey(memo.day, interval);
            const group = byPeriod.get(key) ?? [];
            group.push(memo);
            byPeriod.set(key, group);
        }
        return bars.flatMap(bar => {
            const group = byPeriod.get(periodKey(bar.day, interval));
            return group ? [{bar, group}] : [];
        });
    }, [bars, interval, memos]);

    useEffect(() => {
        const instance = chart.current;
        const series = candles.current;
        if (!instance || !series) return;
        const scale = instance.timeScale();
        const element = instance.chartElement();
        let frame = 0;
        const update = () => {
            if (frame) return;
            frame = requestAnimationFrame(() => {
                frame = 0;
                const {width, height} = instance.paneSize(0);
                const next = groups.flatMap(({bar, group}) => {
                    const x = scale.timeToCoordinate(bar.day);
                    const y = series.priceToCoordinate(bar.high);
                    if (x === null || y === null || x < 0 || x >= width || y < 0 || y >= height) return [];
                    return group.map((memo, index) => ({
                        memo, x: Math.min(width - 10, Math.max(10, x)),
                        y: Math.max(10 + (group.length - 1) * 22, y - 13) - index * 22,
                    }));
                });
                setMarkers(previous => previous.length === next.length && previous.every((marker, index) =>
                    marker.memo === next[index].memo && marker.x === next[index].x && marker.y === next[index].y) ? previous : next);
            });
        };
        scale.subscribeVisibleLogicalRangeChange(update);
        instance.subscribeCrosshairMove(update);
        const observer = new ResizeObserver(update);
        observer.observe(element);
        update();
        return () => {
            cancelAnimationFrame(frame);
            observer.disconnect();
            if (element.isConnected) {
                scale.unsubscribeVisibleLogicalRangeChange(update);
                instance.unsubscribeCrosshairMove(update);
            }
        };
    }, [chart, candles, groups, chartRevision]);

    return markers;
}
