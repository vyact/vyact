import {useEffect, useRef, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {stockAnalysis, type MarketIndex, type StockSymbol, type StockMarket} from '../../services/stockAnalysis';
import {stockSnapshotCache} from '../../services/stockSnapshotCache';
import StockSparkline from './StockSparkline';
import {isMarketWeekend} from './marketRefresh';

import {MARKET_INDEX_LABELS, US_INDEX_FUTURE_LABELS, CASH_INDEX_CHART_LABELS} from './marketIndexLabels';

export default function MarketIndexSummary({market, refreshSeconds, onOpen, onOpeningChange}: {onOpeningChange?: (opening: number | undefined) => void; market: StockMarket; refreshSeconds: number; onOpen: (item: StockSymbol) => void}) {
    const labels = MARKET_INDEX_LABELS[market];
    const {t, i18n} = useTranslation('main');
    const [indices, setIndices] = useState<MarketIndex[]>(() => stockSnapshotCache.readIndices()?.filter(index => labels.some(label => label.symbol === (index.indexSymbol ?? index.symbol))) ?? []);
    const nextOpening = market === 'US' ? indices.find(index => US_INDEX_FUTURE_LABELS[index.symbol])?.nextRegularOpen : undefined;
    useEffect(() => {onOpeningChange?.(nextOpening);}, [nextOpening, onOpeningChange]);
    const loaded = useRef(indices.some(index => index.price != null));
    useEffect(() => {
        const controller = new AbortController();
        let pending = false;
        const refresh = async () => {
            if (pending || (loaded.current && market === 'KR' && isMarketWeekend(market))) return;
            pending = true;
            try {
                const result = await stockAnalysis.marketIndices(controller.signal, market);
                if (!controller.signal.aborted) {
                    const valid = result.filter(index => index.price != null);
                    if (valid.length) {
                        stockSnapshotCache.writeIndices(valid);
                        setIndices(result);
                        loaded.current = true;
                    }
                }
            } catch {
                // Keep the last valid index snapshot when a refresh fails.
            } finally {
                pending = false;
            }
        };
        void refresh();
        const timer = window.setInterval(() => {void refresh();}, refreshSeconds * 1000);
        return () => {controller.abort(); window.clearInterval(timer);};
    }, [refreshSeconds, market, labels]);
    const price = new Intl.NumberFormat(i18n.resolvedLanguage, {minimumFractionDigits: 2, maximumFractionDigits: 2});
    const signed = new Intl.NumberFormat(i18n.resolvedLanguage, {minimumFractionDigits: 2, maximumFractionDigits: 2, signDisplay: 'exceptZero'});
    return <div className="stock-market-indices" data-market={market} aria-label={t('stockAnalysis.marketIndices')}>
        {labels.map(({symbol, key}) => {
            const index = indices.find(item => (item.indexSymbol ?? item.symbol) === symbol);
            const displaySymbol = index?.symbol ?? symbol;
            const displayKey = US_INDEX_FUTURE_LABELS[displaySymbol] ?? key;
            const direction = !index?.change ? 'flat' : index.change > 0 ? 'up' : 'down';
            return <div className="stock-market-index-card" key={symbol}>
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
                {US_INDEX_FUTURE_LABELS[displaySymbol] && <button type="button" className="stock-market-index-cash"
                    aria-label={t('stockAnalysis.openIndexChart', {name: t(`stockAnalysis.${key}`)})}
                    onClick={() => onOpen({symbol, name: t(`stockAnalysis.${key}`)})}>
                    {t(`stockAnalysis.${CASH_INDEX_CHART_LABELS[symbol]}`)}
                </button>}
            </div>;
        })}
    </div>;
}
