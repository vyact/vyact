import {useEffect, useRef} from 'react';
import {STOCK_MARKETS, type StockMarket} from '../../services/stockAnalysis';

export default function useStockMarketShortcuts(onChange: (market: StockMarket) => void) {
    const onChangeRef = useRef(onChange);
    useEffect(() => {onChangeRef.current = onChange;});
    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.defaultPrevented || event.isComposing || !(event.metaKey || event.ctrlKey)
                || event.shiftKey || event.altKey) return;
            const digit = /^Digit([1-6])$/.exec(event.code)?.[1] ?? (/^[1-6]$/.test(event.key) ? event.key : undefined);
            if (!digit) return;
            // Consume before chat shortcuts, including Cmd+1 for a new conversation.
            event.preventDefault();
            if (event.repeat || document.querySelector('.app-modal-overlay')) return;
            onChangeRef.current(STOCK_MARKETS[Number(digit) - 1]);
        };
        window.addEventListener('keydown', handleKeyDown, true);
        return () => window.removeEventListener('keydown', handleKeyDown, true);
    }, []);
}
