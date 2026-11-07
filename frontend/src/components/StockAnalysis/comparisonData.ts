import type {DailyPrice} from '../../services/stockAnalysis';
import {aggregatePrices, periodKey, type ChartInterval} from './chartData';

export function comparisonDailyChange(rows: DailyPrice[], sourceDay: string): number | null {
    const index = rows.findIndex(row => row.day === sourceDay);
    const previous = rows[index - 1]?.close;
    return index < 1 || previous == null || previous <= 0 ? null : (rows[index].close / previous - 1) * 100;
}

export function comparisonPoints(base: DailyPrice[], rows: DailyPrice[], interval: ChartInterval, shift: number) {
    const slots = new Map(base.map((row, index) => [periodKey(row.day, interval), index]));
    const closingDays = new Map(rows.map(row => [periodKey(row.day, interval), row.day]));
    return aggregatePrices(rows, interval).flatMap(row => {
        const index = slots.get(periodKey(row.day, interval));
        if (index === undefined || !base[index + shift]) return [];
        return [{time: base[index + shift].day, value: row.close, sourceDay: closingDays.get(periodKey(row.day, interval))!}];
    });
}
