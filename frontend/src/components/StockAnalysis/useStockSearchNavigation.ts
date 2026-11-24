import {useEffect, useRef, useState, type KeyboardEvent} from 'react';
import type {StockSymbol} from '../../services/stockAnalysis';

export default function useStockSearchNavigation(results: readonly StockSymbol[]) {
    const [activeSymbol, setActiveSymbol] = useState<string>();
    const activeOption = useRef<HTMLButtonElement>(null);
    const focusNextOption = useRef(false);
    const activeIndex = activeSymbol === undefined ? -1 : results.findIndex(stock => stock.symbol === activeSymbol);

    useEffect(() => {
        if (focusNextOption.current) {
            focusNextOption.current = false;
            activeOption.current?.focus({preventScroll: true});
        }
        activeOption.current?.scrollIntoView({block: 'nearest'});
    }, [activeIndex, activeSymbol]);

    const moveSelection = (event: KeyboardEvent<HTMLInputElement | HTMLButtonElement>) => {
        if (event.nativeEvent.isComposing || !results.length ||
            (event.key !== 'ArrowDown' && event.key !== 'ArrowUp')) return;
        event.preventDefault();
        const direction = event.key === 'ArrowDown' ? 1 : -1;
        const nextIndex = activeIndex < 0 ? (direction > 0 ? 0 : results.length - 1)
            : Math.min(results.length - 1, Math.max(0, activeIndex + direction));
        if (nextIndex === activeIndex) return;
        focusNextOption.current = event.currentTarget instanceof HTMLButtonElement;
        setActiveSymbol(results[nextIndex].symbol);
    };

    return {
        activeIndex, activeOption, moveSelection, selectSymbol: setActiveSymbol,
        selectedResult: results[Math.max(activeIndex, 0)],
        resetSelection: () => setActiveSymbol(undefined),
    };
}
