import {useEffect, useRef} from 'react';
import {stockAnalysis, type DailyPrice} from '../../services/stockAnalysis';

export default function useStockPriceRefresh(symbol: string | undefined, seconds: number, enabled: boolean,
    onRows: (rows: DailyPrice[]) => void, manualRefreshVersion = 0) {
    const receive = useRef(onRows);
    receive.current = onRows;
    const lastManualRefresh = useRef(manualRefreshVersion);
    useEffect(() => {
        if (lastManualRefresh.current === manualRefreshVersion) return;
        lastManualRefresh.current = manualRefreshVersion;
        if (!symbol) return;
        const controller = new AbortController();
        void stockAnalysis.prices(symbol, controller.signal).then(rows => {
            if (!controller.signal.aborted && rows.length) receive.current(rows);
        }).catch(() => { /* Preserve the comparison if the manual request fails. */ });
        return () => controller.abort();
    }, [symbol, manualRefreshVersion]);
    useEffect(() => {
        if (!symbol || !enabled) return;
        const controller = new AbortController();
        let pending = false;
        let wasOpen = false;
        const refresh = async (initial = false) => {
            if (pending || document.visibilityState === 'hidden') return;
            pending = true;
            try {
                const status = await stockAnalysis.tradingStatus(symbol, controller.signal);
                const shouldFetch = !initial && (status.open || wasOpen);
                wasOpen = status.open;
                if (shouldFetch && !controller.signal.aborted) {
                    const rows = await stockAnalysis.prices(symbol, controller.signal);
                    if (!controller.signal.aborted && rows.length) receive.current(rows);
                }
            } catch {
                // Preserve the displayed chart and retry on the next interval.
            } finally {pending = false;}
        };
        void refresh(true);
        const timer = window.setInterval(() => {void refresh();}, seconds * 1000);
        return () => {controller.abort(); window.clearInterval(timer);};
    }, [symbol, seconds, enabled]);
}
