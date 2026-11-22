import {expect, it} from 'vitest';
import {chartActivityFormatter, chartActivityScale} from './chartActivityFormat';

it('scales large aggregates without changing the relative bar sizes or displayed units', () => {
    const monthlyTotal = 94_853_721_545_993;
    const yearlyTotal = monthlyTotal * 12;
    expect(chartActivityScale([0, 1_000_000, null])).toBe(1);
    expect(chartActivityScale([monthlyTotal])).toBe(10);
    const scale = chartActivityScale([monthlyTotal, yearlyTotal, null]);
    expect(scale).toBe(100);
    expect(yearlyTotal / scale).toBeLessThan(Number.MAX_SAFE_INTEGER / 100);
    expect((yearlyTotal / scale) / (monthlyTotal / scale)).toBeCloseTo(12);
    const formatter = chartActivityFormatter('KR');
    expect(formatter.format((monthlyTotal / scale) * scale)).toBe(formatter.format(monthlyTotal));
});

it('uses the market units independently of the interface language', () => {
    expect(chartActivityFormatter('KR').format(5_460_505_591_000)).toBe('5.46조');
    expect(chartActivityFormatter('KR').format(4_228_927)).toBe('422.89만');
    expect(chartActivityFormatter('US').format(4_228_927)).toBe('4.23M');
    expect(chartActivityFormatter('JP').format(120_000_000)).toBe('1.2億');
    expect(chartActivityFormatter('CN').format(120_000_000)).toBe('1.2亿');
});
