import {useEffect} from 'react';
import {useTranslation} from 'react-i18next';
import {type StockSymbol, type StockMarket} from '../../services/stockAnalysis';
import useMarketIndexQuotes from './useMarketIndexQuotes';
import {INDEX_DRAG_TYPE} from './pinnedIndexPreferences';
import StockSparkline from './StockSparkline';

import {MARKET_INDEX_LABELS, INDEX_FUTURE_LABELS, CASH_INDEX_CHART_LABELS} from './marketIndexLabels';

export default function MarketIndexSummary({market, refreshSeconds, onOpen, onOpeningChange, refreshVersion = 0}: {refreshVersion?: number; onOpeningChange?: (opening: number | undefined) => void; market: StockMarket; refreshSeconds: number; onOpen: (item: StockSymbol) => void}) {
    const labels = MARKET_INDEX_LABELS[market];
    const {t, i18n} = useTranslation('main');
    const indices = useMarketIndexQuotes([market], refreshSeconds, refreshVersion);
    const nextOpening = indices.find(index => INDEX_FUTURE_LABELS[index.symbol])?.nextRegularOpen;
    useEffect(() => {onOpeningChange?.(nextOpening);}, [nextOpening, onOpeningChange]);
    const price = new Intl.NumberFormat(i18n.resolvedLanguage, {minimumFractionDigits: 2, maximumFractionDigits: 2});
    const signed = new Intl.NumberFormat(i18n.resolvedLanguage, {minimumFractionDigits: 2, maximumFractionDigits: 2, signDisplay: 'exceptZero'});
    return <div className="stock-market-indices" data-market={market} aria-label={t('stockAnalysis.marketIndices')}>
        {labels.map(({symbol, key}) => {
            const index = indices.find(item => (item.indexSymbol ?? item.symbol) === symbol);
            const displaySymbol = index?.symbol ?? symbol;
            const displayKey = INDEX_FUTURE_LABELS[displaySymbol] ?? key;
            const direction = !index?.change ? 'flat' : index.change > 0 ? 'up' : 'down';
            return <div className="stock-market-index-card" key={symbol} draggable
                onDragStart={event => {
                    event.dataTransfer.effectAllowed = 'copyMove';
                    event.dataTransfer.setData(INDEX_DRAG_TYPE, JSON.stringify({market, symbol}));
                }}>
                <button type="button" className="stock-market-index" data-direction={direction}
                onClick={() => onOpen({symbol: displaySymbol, name: t(`stockAnalysis.${displayKey}`)})}>
                <span className="stock-market-index-values">
                    <strong className="stock-market-index-name">{t(`stockAnalysis.${displayKey}`)}</strong>
                    <span className="stock-market-index-price">{index?.price == null ? '—' : price.format(index.price)}</span>
                    <span className="stock-market-index-change">
                        {index?.change == null ? '—' : signed.format(index.change)}
                        <strong>{index?.changePercent == null ? '—' : `${signed.format(index.changePercent)}%`}</strong>
                    </span>

                </span>
                <span className="stock-market-index-chart">
                    <StockSparkline closes={index?.closes} change={index?.change}/>
                </span>
                </button>
                {INDEX_FUTURE_LABELS[displaySymbol] && <button type="button" className="stock-market-index-cash"
                    aria-label={t('stockAnalysis.openIndexChart', {name: t(`stockAnalysis.${key}`)})}
                    onClick={() => onOpen({symbol, name: t(`stockAnalysis.${key}`)})}>
                    {t(`stockAnalysis.${CASH_INDEX_CHART_LABELS[symbol]}`)}
                </button>}
            </div>;
        })}
    </div>;
}
