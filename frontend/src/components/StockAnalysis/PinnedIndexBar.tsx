import {useEffect, useState, type DragEvent} from 'react';
import {X} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import type {StockMarket, StockSymbol} from '../../services/stockAnalysis';
import {DEFAULT_REFRESH_SECONDS} from './chartRefreshPreference';
import usePinnedIndexPreferences from './usePinnedIndexPreferences';
import useMarketIndexQuotes from './useMarketIndexQuotes';
import {MARKET_INDEX_LABELS, INDEX_FUTURE_LABELS} from './marketIndexLabels';
import {INDEX_DRAG_TYPE, parseIndexDrag, pinnedIndexId, movePinnedIndex} from './pinnedIndexPreferences';
import './PinnedMarketIndices.css';

export default function PinnedIndexBar({onOpen}: {onOpen: (market: StockMarket, item: StockSymbol) => void}) {
    const {t, i18n} = useTranslation('main');
    const {items, setItems, failed, retry} = usePinnedIndexPreferences();
    const [dragging, setDragging] = useState(false);
    const [overHeader, setOverHeader] = useState(false);
    const [target, setTarget] = useState<{id: string; after: boolean}>();
    const indices = useMarketIndexQuotes(items.map(item => item.market), DEFAULT_REFRESH_SECONDS);
    useEffect(() => {
        const supported = (event: globalThis.DragEvent) => event.dataTransfer?.types.includes(INDEX_DRAG_TYPE);
        const reset = () => {setDragging(false); setOverHeader(false); setTarget(undefined);};
        const start = (event: globalThis.DragEvent) => {if (supported(event)) setDragging(true);};
        const over = (event: globalThis.DragEvent) => {
            if (supported(event)) event.preventDefault();
        };
        const drop = (event: globalThis.DragEvent) => {
            if (!supported(event)) return;
            const item = parseIndexDrag(event.dataTransfer!.getData(INDEX_DRAG_TYPE));
            if (item?.pinned && !(event.target instanceof Element && event.target.closest('.stock-pinned-indices'))) {
                event.preventDefault();
                setItems(current => current.filter(entry => pinnedIndexId(entry) !== pinnedIndexId(item)));
            }
            reset();
        };
        window.addEventListener('dragstart', start);
        window.addEventListener('dragover', over);
        window.addEventListener('drop', drop, true);
        window.addEventListener('dragend', reset);
        return () => {
            window.removeEventListener('dragstart', start);
            window.removeEventListener('dragover', over);
            window.removeEventListener('drop', drop, true);
            window.removeEventListener('dragend', reset);
        };
    }, []);
    const price = new Intl.NumberFormat(i18n.resolvedLanguage, {maximumFractionDigits: 2});
    const percent = new Intl.NumberFormat(i18n.resolvedLanguage, {style: 'percent', minimumFractionDigits: 2, maximumFractionDigits: 2, signDisplay: 'exceptZero'});
    const dragOver = (event: DragEvent<HTMLDivElement>) => {
        if (!event.dataTransfer.types.includes(INDEX_DRAG_TYPE)) return;
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = 'move';
        setOverHeader(true);
        const card = (event.target as Element).closest<HTMLElement>('[data-pinned-index]');
        const rect = card?.getBoundingClientRect();
        setTarget(card && rect ? {id: card.dataset.pinnedIndex!, after: event.clientX > rect.left + rect.width / 2} : undefined);
    };
    return <div className="stock-pinned-indices" data-drag-active={dragging} data-drag-over={overHeader} aria-label={t('stockAnalysis.pinnedIndices.label')}
        onDragOver={dragOver} onDragLeave={event => {if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {setTarget(undefined); setOverHeader(false);}}}
        onDrop={event => {
            const item = parseIndexDrag(event.dataTransfer.getData(INDEX_DRAG_TYPE));
            if (!item) return;
            event.preventDefault(); event.stopPropagation();
            setItems(current => movePinnedIndex(current, {market: item.market, symbol: item.symbol}, target?.id, target?.after));
            setDragging(false); setOverHeader(false); setTarget(undefined);
        }}>
        {failed && <button type="button" className="stock-pinned-indices-retry" onClick={retry}>{t('stockAnalysis.pinnedIndices.syncFailed')}</button>}
        {items.map(item => {
            const id = pinnedIndexId(item);
            const quote = indices.find(index => (index.indexSymbol ?? index.symbol) === item.symbol);
            const label = MARKET_INDEX_LABELS[item.market].find(label => label.symbol === item.symbol)!;
            const name = t(`stockAnalysis.${INDEX_FUTURE_LABELS[quote?.symbol ?? ''] ?? label.key}`);
            return <div className="stock-pinned-index" key={id} data-market={item.market} data-pinned-index={id}
                data-drop={target?.id === id ? target.after ? 'after' : 'before' : undefined}
                data-direction={!quote?.changePercent ? 'flat' : quote.changePercent > 0 ? 'up' : 'down'} draggable
                onDragStart={event => {
                    event.dataTransfer.effectAllowed = 'move';
                    event.dataTransfer.setData(INDEX_DRAG_TYPE, JSON.stringify({...item, pinned: true}));
                }}>
                <button className="stock-pinned-index-open" type="button" onClick={() => onOpen(item.market, {symbol: quote?.symbol ?? item.symbol, name})}>
                    <span>{name}</span><strong>{quote?.price == null ? '—' : price.format(quote.price)}</strong>
                    <small>{quote?.changePercent == null ? '—' : percent.format(quote.changePercent / 100)}</small>
                </button>
                <button className="stock-pinned-index-remove" type="button" aria-label={t('stockAnalysis.pinnedIndices.remove', {name})}
                    onClick={() => setItems(current => current.filter(entry => pinnedIndexId(entry) !== id))}><X size={11} aria-hidden="true"/></button>
            </div>;
        })}
        {dragging && <span className="stock-pinned-indices-hint">{t('stockAnalysis.pinnedIndices.dropHint')}</span>}
    </div>;
}
