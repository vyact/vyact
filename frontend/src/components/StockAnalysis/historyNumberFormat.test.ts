import {describe, expect, it} from 'vitest';
import {formatHistoryQuantity} from './historyNumberFormat';
const labels: Record<string, string> = {trillion: '조', hundredMillion: '억', million: '백만'};
const format = (value: number) => formatHistoryQuantity(value, 'ko-KR', key => labels[key]);

describe('Vyvow history unit formatting', () => {
    it('matches the reference volume and amount examples', () => {
        expect(format(35_516_270)).toBe('35.52백만');
        expect(format(160_012_000_000)).toBe('1,600.12억');
        expect(format(6_710_000_000_000)).toBe('6.71조');
    });
    it('preserves signs, small values, zero and exact units', () => {
        expect(format(-5_801_234)).toBe('-5.80백만');
        expect(format(858_557)).toBe('858,557');
        expect(format(-651_326)).toBe('-651,326');
        expect(format(0)).toBe('0');
        expect(format(1_000_000)).toBe('1백만');
    });
    it('uses translated locale unit scales', () => {
        expect(formatHistoryQuantity(35_516_270, 'en', key => ({million: 'M'})[key] ?? key)).toBe('35.52M');
        expect(formatHistoryQuantity(35_516_270, 'ja', key => ({tenThousand: '万'})[key] ?? key)).toBe('3,551.63万');
    });
});

it.each([
    ['ko', 12345, '12,345'],
    ['ja', 12345, '1.23<tenThousand>'],
    ['zh-CN', 12345, '1.23<tenThousand>'],
    ['en-US', 12345, '12.35<thousand>'],
    ['fr-FR', 12345, '12,35<thousand>'],
    ['es-ES', 12345, '12,35<thousand>'],
    ['th', 12345, '12.35<thousand>'],
    ['vi', 12345, '12,35<thousand>'],
    ['fr', -1234567890, '-1,23<billion>'],
    ['ja', 1234567890, '12.35<hundredMillion>'],
])('uses %s unit thresholds and number punctuation', (language, value, expected) => {
    expect(formatHistoryQuantity(value as number, language as string, key => `<${key}>`)).toBe(expected);
});
