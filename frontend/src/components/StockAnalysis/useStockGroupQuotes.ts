import {useEffect, useState} from 'react';
import {stockAnalysis, type StockQuote} from '../../services/stockAnalysis';

const QUOTE_BATCH_SIZE = 100;
export default function useStockGroupQuotes(symbols: string[], refreshSeconds: number) {
    const key = [...new Set(symbols)].sort().join(',');
    const [state, setState] = useState<{key: string; quotes: StockQuote[]; loading: boolean; failed: boolean}>({key: '', quotes: [], loading: false, failed: false});
    useEffect(() => {
        if (!key) return;
        const controller = new AbortController();
        let busy = false;
        const refresh = async () => {
            if (busy) return;
            busy = true;
            const requested = key.split(',');
            try {
                const quotes: StockQuote[] = [];
                for (let start = 0; start < requested.length; start += QUOTE_BATCH_SIZE) {
                    quotes.push(...await stockAnalysis.groupQuotes(requested.slice(start, start + QUOTE_BATCH_SIZE), controller.signal));
                }
                if (!controller.signal.aborted) setState({key, quotes, loading: false, failed: false});
            } catch {
                if (!controller.signal.aborted) setState(current => ({key, quotes: current.key === key ? current.quotes : [], loading: false, failed: true}));
            } finally {busy = false;}
        };
        void refresh();
        const interval = window.setInterval(() => {void refresh();}, refreshSeconds * 1000);
        return () => {controller.abort(); window.clearInterval(interval);};
    }, [key, refreshSeconds]);
    return state.key === key ? state : {key, quotes: [], loading: !!key, failed: false};
}
