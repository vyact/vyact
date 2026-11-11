import {useEffect, useState} from 'react';
import {stockAnalysis, STOCK_MARKETS, type StockMarket, type MarketIndex} from '../../services/stockAnalysis';
import {stockSnapshotCache} from '../../services/stockSnapshotCache';
import {MARKET_INDEX_LABELS} from './marketIndexLabels';
import {isMarketWeekend} from './marketRefresh';

export default function useMarketIndexQuotes(markets: StockMarket[], refreshSeconds: number, refreshVersion = 0) {
    const key = STOCK_MARKETS.filter(market => markets.includes(market)).join(',');
    const [indices, setIndices] = useState<MarketIndex[]>(() => stockSnapshotCache.readIndices() ?? []);
    useEffect(() => {
        if (!key) return;
        const requested = key.split(',') as StockMarket[];
        const controller = new AbortController();
        let pending = false;
        const refresh = async (initial = false) => {
            if (pending) return;
            pending = true;
            await Promise.allSettled(requested.map(async market => {
                if (!initial && isMarketWeekend(market)) return;
                const result = await stockAnalysis.marketIndices(controller.signal, market);
                if (controller.signal.aborted || !result.some(item => item.price != null)) return;
                stockSnapshotCache.writeIndices(result);
                const belongs = (item: MarketIndex) => MARKET_INDEX_LABELS[market].some(label => label.symbol === (item.indexSymbol ?? item.symbol));
                setIndices(current => [...current.filter(item => !belongs(item)), ...result]);
            }));
            pending = false;
        };
        void refresh(true);
        const timer = window.setInterval(() => {void refresh();}, refreshSeconds * 1000);
        return () => {controller.abort(); window.clearInterval(timer);};
    }, [key, refreshSeconds, refreshVersion]);
    return indices.filter(item => markets.some(market => MARKET_INDEX_LABELS[market]
        .some(label => label.symbol === (item.indexSymbol ?? item.symbol))));
}
