import {useEffect, useRef, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {stockAnalysis, type MarketIndex, type StockSymbol} from '../../services/stockAnalysis';
import {stockSnapshotCache} from '../../services/stockSnapshotCache';
import StockSparkline from './StockSparkline';
import {isMarketWeekend} from './marketRefresh';

const INDEX_LABELS = [
    {symbol: '^GSPC', key: 'indexSp500'},
    {symbol: '^IXIC', key: 'indexNasdaq'},
    {symbol: '^RUT', key: 'indexRussell2000'},
] as const;

export default function MarketIndexSummary({refreshSeconds, onOpen}: {refreshSeconds: number; onOpen: (item: StockSymbol) => void}) {
    const {t, i18n} = useTranslation('main');
    const [indices, setIndices] = useState<MarketIndex[]>(() => stockSnapshotCache.readIndices() ?? []);
    const loaded = useRef(indices.some(index => index.price != null));
    useEffect(() => {
        const controller = new AbortController();
        let pending = false;
        const refresh = async () => {
            if (pending || (loaded.current && isMarketWeekend('US'))) return;
            pending = true;
            try {
                const result = await stockAnalysis.marketIndices(controller.signal);
                if (!controller.signal.aborted) {
                    const valid = result.filter(index => index.price != null);
                    if (valid.length) {
                        stockSnapshotCache.writeIndices(valid);
                        setIndices(current => INDEX_LABELS.map(({symbol}) =>
                            valid.find(index => index.symbol === symbol) ?? current.find(index => index.symbol === symbol)
                        ).filter((index): index is MarketIndex => Boolean(index)));
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
    }, [refreshSeconds]);
    const price = new Intl.NumberFormat(i18n.resolvedLanguage, {minimumFractionDigits: 2, maximumFractionDigits: 2});
    const signed = new Intl.NumberFormat(i18n.resolvedLanguage, {minimumFractionDigits: 2, maximumFractionDigits: 2, signDisplay: 'exceptZero'});
    return <div className="stock-market-indices" aria-label={t('stockAnalysis.marketIndices')}>
        {INDEX_LABELS.map(({symbol, key}) => {
            const index = indices.find(item => item.symbol === symbol);
            const direction = !index?.change ? 'flat' : index.change > 0 ? 'up' : 'down';
            return <button type="button" className="stock-market-index" key={symbol} data-direction={direction}
                onClick={() => onOpen({symbol, name: t(`stockAnalysis.${key}`)})}>
                <span className="stock-market-index-values">
                    <strong className="stock-market-index-name">{t(`stockAnalysis.${key}`)}</strong>
                    <span className="stock-market-index-price">{index?.price == null ? '—' : price.format(index.price)}</span>
                    <span className="stock-market-index-change">
                        {index?.change == null ? '—' : signed.format(index.change)}
                        <strong>{index?.changePercent == null ? '—' : `${signed.format(index.changePercent)}%`}</strong>
                    </span>

                </span>
                <span className="stock-market-index-chart">
                    <StockSparkline closes={index?.closes} change={index?.change}/>
                </span>
            </button>;
        })}
    </div>;
}
