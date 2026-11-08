import {useEffect, useState} from 'react';
import {stockAnalysis, type StockMarket, type StockSymbol} from '../../services/stockAnalysis';
import {stockSnapshotCache} from '../../services/stockSnapshotCache';

export default function useStockDirectory(market: StockMarket, language: string, enabled: boolean, localMarket: StockMarket, localDirectory: StockSymbol[]) {
    const [remote, setRemote] = useState<{market: StockMarket; language: string; rows: StockSymbol[]}>();
    const [error, setError] = useState(false);
    const [retry, setRetry] = useState(0);
    const rows = market === localMarket ? localDirectory : remote?.market === market && remote.language === language ? remote.rows : stockSnapshotCache.readSymbols(market, language);
    useEffect(() => {
        if (!enabled || market === localMarket) return;
        const controller = new AbortController();
        setError(false);
        stockAnalysis.symbols(market, controller.signal, language).then(result => {
            if (controller.signal.aborted) return;
            stockSnapshotCache.writeSymbols(market, result, language);
            setRemote({market, language, rows: result});
        }).catch(() => {if (!controller.signal.aborted) setError(true);});
        return () => controller.abort();
    }, [enabled, market, language, localMarket, retry]);
    return {rows, error, reload: () => setRetry(value => value + 1)};
}
