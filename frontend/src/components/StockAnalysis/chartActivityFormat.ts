import type {StockMarket} from '../../services/stockAnalysis';

const MARKET_NUMBER_LOCALES: Record<StockMarket, string> = {
    KR: 'ko-KR', US: 'en-US', JP: 'ja-JP', TW: 'zh-TW', HK: 'zh-HK', CN: 'zh-CN',
};

export function chartActivityFormatter(market: StockMarket): Intl.NumberFormat {
    return new Intl.NumberFormat(MARKET_NUMBER_LOCALES[market], {notation: 'compact', maximumFractionDigits: 2});
}
