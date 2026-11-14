import type {DailyPrice} from '../../services/stockAnalysis';
import {aggregatePrices, periodKey, type ChartInterval} from './chartData';

export function comparisonPeriodChange(rows: DailyPrice[], sourceDay: string, interval: ChartInterval = 'day'): number | null {
    const periods = aggregatePrices(rows, interval);
    const key = periodKey(sourceDay, interval);
    const index = periods.findIndex(row => periodKey(row.day, interval) === key);
    const previous = periods[index - 1]?.close;
    return index < 1 || previous == null || previous <= 0 ? null : (periods[index].close / previous - 1) * 100;
}

export function comparisonPoints(base: DailyPrice[], rows: DailyPrice[], interval: ChartInterval, shift: number) {
    const days = base.map(row => row.day);
    if (days.length && shift > 0) {
        const date = new Date(`${days[days.length - 1]}T00:00:00Z`);
        for (let index = 0; index < shift; index++) {
            if (interval === 'day') {
                do {date.setUTCDate(date.getUTCDate() + 1);} while (date.getUTCDay() === 0 || date.getUTCDay() === 6);
            } else if (interval === 'week') {
                date.setUTCDate(date.getUTCDate() + 7);
            } else {
                date.setUTCDate(1);
                if (interval === 'month') date.setUTCMonth(date.getUTCMonth() + 1);
                else date.setUTCFullYear(date.getUTCFullYear() + 1, 0, 1);
            }
            days.push(date.toISOString().slice(0, 10));
        }
    }
    const slots = new Map(base.map((row, index) => [periodKey(row.day, interval), index]));
    const closingDays = new Map(rows.map(row => [periodKey(row.day, interval), row.day]));
    return aggregatePrices(rows, interval).flatMap(row => {
        const index = slots.get(periodKey(row.day, interval));
        if (index === undefined || !days[index + shift]) return [];
        return [{time: days[index + shift], value: row.close, sourceDay: closingDays.get(periodKey(row.day, interval))!}];
    });
}

/** Rebase both instruments on their first shared session at or after the visible start. */
export function comparisonReturns(base: DailyPrice[], points: ReturnType<typeof comparisonPoints>, visibleFrom?: string) {
    const byDay = new Map(base.map(row => [row.day, row.close]));
    const anchor = points.find(point => (!visibleFrom || point.time >= visibleFrom) && point.value > 0 && (byDay.get(point.time) ?? 0) > 0);
    if (!anchor) return {base: [], comparison: []};
    const basePrice = byDay.get(anchor.time)!;
    return {
        base: base.filter(row => row.day >= anchor.time).map(row => ({time: row.day, value: (row.close / basePrice - 1) * 100})),
        comparison: points.filter(point => point.time >= anchor.time).map(point => ({time: point.time, value: (point.value / anchor.value - 1) * 100})),
    };
}
