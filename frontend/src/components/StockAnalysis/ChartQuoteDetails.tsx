import {useTranslation} from 'react-i18next';
import type {DailyPrice, StockMarket} from '../../services/stockAnalysis';

export type QuoteDisplayMode = 'header' | 'tooltip';

export function quoteChange(value: number | null, previous: number | null | undefined): number | null {
    return value == null || previous == null || previous <= 0 ? null : (value / previous - 1) * 100;
}

export default function ChartQuoteDetails({quote, previous, market, detailed = false}: {
    quote: DailyPrice; previous?: DailyPrice; market: StockMarket; detailed?: boolean;
}) {
    const {t, i18n} = useTranslation('main');
    const weekday = new Intl.DateTimeFormat(i18n.resolvedLanguage, {weekday: 'short', timeZone: 'UTC'}).format(new Date(`${quote.day}T00:00:00Z`));
    const number = new Intl.NumberFormat(i18n.resolvedLanguage, {maximumFractionDigits: market === 'KR' ? 0 : 2});
    const percent = new Intl.NumberFormat(i18n.resolvedLanguage, {minimumFractionDigits: 2, maximumFractionDigits: 2, signDisplay: 'exceptZero'});
    const change = (value: number | null, base: number | null | undefined) => {
        const rate = quoteChange(value, base);
        return rate == null ? null : <span className="stock-quote-change" data-direction={rate === 0 ? 'flat' : rate > 0 ? 'up' : 'down'}>({percent.format(rate)}%)</span>;
    };
    return <dl className={`stock-price-chart-quote${detailed ? ' stock-price-chart-quote-detailed' : ''}`} data-market={market}>
        {!detailed && <div><dt>{t('stockAnalysis.day')}</dt><dd>{quote.day} ({weekday})</dd></div>}
        {(['open', 'high', 'low', 'close'] as const).map(key => <div key={key}>
            <dt>{t(`stockAnalysis.${key}`)}</dt><dd>{number.format(quote[key])}
                {(detailed || key === 'close') && change(quote[key], previous?.close)}
            </dd>
        </div>)}
        {quote.volume != null && (!detailed || quote.tradingValue == null) && <div><dt>{t('stockAnalysis.volume')}</dt><dd>
            {new Intl.NumberFormat(i18n.resolvedLanguage, {notation: detailed ? 'compact' : 'standard', maximumFractionDigits: 2}).format(quote.volume)}
            {detailed && change(quote.volume, previous?.volume)}
        </dd></div>}
        {quote.tradingValue != null && <div><dt>{t('stockAnalysis.history.tradingValue')}</dt><dd>
            {new Intl.NumberFormat(i18n.resolvedLanguage, {notation: detailed ? 'compact' : 'standard', maximumFractionDigits: 2}).format(quote.tradingValue)}
            {detailed && change(quote.tradingValue, previous?.tradingValue)}
        </dd></div>}
    </dl>;
}
