import {useEffect, useId, useRef, useState} from 'react';
import {Search} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import type {StockSymbol} from '../../services/stockAnalysis';
import ModalOverlay from '../common/ModalOverlay/ModalOverlay';
import ModalCloseButton from '../common/ModalOverlay/ModalCloseButton';
import './StockGroups.css';
import './StockMapSearchDialog.css';

export default function StockMapSearchDialog({stocks, onSelect, onClose}: {
    stocks: StockSymbol[];
    onSelect: (symbol: string) => void;
    onClose: () => void;
}) {
    const {t} = useTranslation('main');
    const id = useId();
    const listId = `${id}-results`;
    const [query, setQuery] = useState('');
    const [activeSymbol, setActiveSymbol] = useState<string>();
    const activeOption = useRef<HTMLButtonElement>(null);
    const search = query.trim().toLocaleLowerCase();
    const results = stocks.filter(stock => `${stock.symbol} ${stock.name}`.toLocaleLowerCase().includes(search));
    const activeIndex = results.findIndex(stock => stock.symbol === activeSymbol);

    useEffect(() => {
        activeOption.current?.scrollIntoView({block: 'nearest'});
    }, [activeIndex, activeSymbol]);

    return <ModalOverlay onClose={onClose} closeOnBackdrop captureEscape aria-labelledby={id}>
        <form className="stock-group-dialog stock-map-search-dialog" onSubmit={event => {
            event.preventDefault();
            const stock = results[Math.max(activeIndex, 0)];
            if (stock) onSelect(stock.symbol);
        }}>
            <header><h2 id={id}>{t('stockAnalysis.mapSearch')}</h2><ModalCloseButton onClick={onClose}/></header>
            <div className="stock-analysis-search stock-group-search">
                <Search size={16} aria-hidden="true"/>
                <input type="search" role="combobox" aria-autocomplete="list" aria-expanded={results.length > 0}
                    aria-controls={listId} aria-activedescendant={activeIndex < 0 ? undefined : `${listId}-${activeIndex}`}
                    autoFocus value={query} onChange={event => {
                        setQuery(event.target.value);
                        setActiveSymbol(undefined);
                    }}
                    onKeyDown={event => {
                        if (event.nativeEvent.isComposing || !results.length ||
                            (event.key !== 'ArrowDown' && event.key !== 'ArrowUp')) return;
                        event.preventDefault();
                        const direction = event.key === 'ArrowDown' ? 1 : -1;
                        const nextIndex = activeIndex < 0 ? (direction > 0 ? 0 : results.length - 1)
                            : Math.min(results.length - 1, Math.max(0, activeIndex + direction));
                        setActiveSymbol(results[nextIndex].symbol);
                    }}
                    aria-label={t('stockAnalysis.search')} placeholder={t('stockAnalysis.search')}/>
            </div>
            <ul id={listId} role="listbox" aria-labelledby={id} className="stock-group-search-results" hidden={!results.length}>
                {results.map((stock, index) => <li key={stock.symbol} role="presentation">
                    <button type="button" role="option" tabIndex={-1} id={`${listId}-${index}`}
                        aria-selected={index === activeIndex} ref={index === activeIndex ? activeOption : undefined}
                        onMouseDown={event => event.preventDefault()} onClick={() => onSelect(stock.symbol)}>
                        <span><strong>{stock.name}</strong><small>{stock.symbol}</small></span>
                    </button>
                </li>)}
            </ul>
            {!results.length && <div className="stock-group-search-results stock-map-search-empty" role="status">
                {t('stockAnalysis.groups.noResults')}
            </div>}
        </form>
    </ModalOverlay>;
}
