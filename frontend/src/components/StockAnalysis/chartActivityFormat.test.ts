import {expect, it} from 'vitest';
import {chartActivityFormatter} from './chartActivityFormat';

it('uses the market units independently of the interface language', () => {
    expect(chartActivityFormatter('KR').format(5_460_505_591_000)).toBe('5.46조');
    expect(chartActivityFormatter('KR').format(4_228_927)).toBe('422.89만');
    expect(chartActivityFormatter('US').format(4_228_927)).toBe('4.23M');
    expect(chartActivityFormatter('JP').format(120_000_000)).toBe('1.2億');
    expect(chartActivityFormatter('CN').format(120_000_000)).toBe('1.2亿');
});
