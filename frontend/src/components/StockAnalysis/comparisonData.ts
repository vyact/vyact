import type {DailyPrice} from '../../services/stockAnalysis';
import {aggregatePrices, periodKey, type ChartInterval} from './chartData';

export function comparisonDailyChange(rows: DailyPrice[], sourceDay: string): number | null {
    const index = rows.findIndex(row => row.day === sourceDay);
    const previous = rows[index - 1]?.close;
    return index < 1 || previous == null || previous <= 0 ? null : (rows[index].close / previous - 1) * 100;
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
