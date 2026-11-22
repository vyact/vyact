import type {StockMarket} from '../../services/stockAnalysis';

const MARKET_NUMBER_LOCALES: Record<StockMarket, string> = {
    KR: 'ko-KR', US: 'en-US', JP: 'ja-JP', TW: 'zh-TW', HK: 'zh-HK', CN: 'zh-CN',
};

// Lightweight Charts validates series values against this limit.
const MAX_CHART_VALUE = Number.MAX_SAFE_INTEGER / 100;

export function chartActivityScale(values: readonly (number | null | undefined)[]): number {
    let scale = 1;
    for (const value of values) {
        if (value == null || !Number.isFinite(value)) continue;
        while (Math.abs(value) / scale > MAX_CHART_VALUE) scale *= 10;
    }
    return scale;
}

export function chartActivityFormatter(market: StockMarket): Intl.NumberFormat {
    return new Intl.NumberFormat(MARKET_NUMBER_LOCALES[market], {notation: 'compact', maximumFractionDigits: 2});
}
