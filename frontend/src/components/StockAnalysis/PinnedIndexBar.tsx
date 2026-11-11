import {movedDragBounds, overlapArea, type DragBounds} from './indexDragGeometry';
import {MoonStar} from 'lucide-react';
import {Tooltip} from '../common/Tooltip/Tooltip';
import {useEffect, useRef, useState} from 'react';
import ModalCloseButton from '../common/ModalOverlay/ModalCloseButton';
import {useTranslation} from 'react-i18next';
import type {StockMarket, StockSymbol} from '../../services/stockAnalysis';
import {DEFAULT_REFRESH_SECONDS} from './chartRefreshPreference';
import usePinnedIndexPreferences from './usePinnedIndexPreferences';
import useMarketIndexQuotes from './useMarketIndexQuotes';
import {MARKET_INDEX_LABELS, INDEX_FUTURE_LABELS} from './marketIndexLabels';
import {MAX_PINNED_INDICES, INDEX_DRAG_TYPE, parseIndexDrag, pinnedIndexId, appendPinnedIndex, reorderPinnedIndex} from './pinnedIndexPreferences';
import './PinnedMarketIndices.css';

export default function PinnedIndexBar({onOpen}: {onOpen: (market: StockMarket, item: StockSymbol) => void}) {
    const {t, i18n} = useTranslation('main');
    const {items, setItems, failed, retry} = usePinnedIndexPreferences();
    const [draggingPinned, setDraggingPinned] = useState(false);
    const [draggedId, setDraggedId] = useState<string>();
    const [dragging, setDragging] = useState(false);
    const [overHeader, setOverHeader] = useState(false);
    const [target, setTarget] = useState<string>();
    const surface = useRef<HTMLDivElement>(null);
    const preferences = useRef({items, setItems});
    useEffect(() => {preferences.current = {items, setItems};});
    const indices = useMarketIndexQuotes(items.map(item => item.market), DEFAULT_REFRESH_SECONDS);
    useEffect(() => {
        let source: {item: NonNullable<ReturnType<typeof parseIndexDrag>>; bounds: DragBounds; grabX: number; grabY: number} | undefined;
        const supported = (event: globalThis.DragEvent) => event.dataTransfer?.types.includes(INDEX_DRAG_TYPE);
        const reset = () => {source = undefined; setDraggingPinned(false); setDraggedId(undefined); setDragging(false); setOverHeader(false); setTarget(undefined);};
        const hit = (event: globalThis.DragEvent) => {
            if (!source || !surface.current) return {inside: false, targetId: undefined};
            const bounds = movedDragBounds(source.bounds, source.grabX, source.grabY, event.clientX, event.clientY);
            const inside = overlapArea(bounds, surface.current.getBoundingClientRect()) > 0;
            let targetId: string | undefined;
            let largestOverlap = 0;
            if (inside && source.item.pinned) for (const card of surface.current.querySelectorAll<HTMLElement>('[data-pinned-index]')) {
                const id = card.dataset.pinnedIndex;
                if (id === pinnedIndexId(source.item)) continue;
                const area = overlapArea(bounds, card.getBoundingClientRect());
                if (area > largestOverlap) {largestOverlap = area; targetId = id;}
            }
            if (inside && !targetId && source.item.pinned) {
                const own = Array.from(surface.current.querySelectorAll<HTMLElement>('[data-pinned-index]'))
                    .find(card => card.dataset.pinnedIndex === pinnedIndexId(source!.item));
                if (own && overlapArea(bounds, own.getBoundingClientRect()) > 0) targetId = pinnedIndexId(source.item);
            }
            return {inside, targetId};
        };
        const start = (event: globalThis.DragEvent) => {
            if (!supported(event)) return;
            const item = parseIndexDrag(event.dataTransfer!.getData(INDEX_DRAG_TYPE));
            const card = event.target instanceof Element ? event.target.closest<HTMLElement>('.stock-market-index-card, [data-pinned-index]') : null;
            if (!item || !card) return;
            const bounds = card.getBoundingClientRect();
            source = {item, bounds, grabX: event.clientX - bounds.left, grabY: event.clientY - bounds.top};
            setDraggingPinned(item.pinned === true);
            setDraggedId(pinnedIndexId(item));
            setDragging(true);
        };
        const over = (event: globalThis.DragEvent) => {
            if (!supported(event) || !source) return;
            event.preventDefault();
            const result = hit(event);
            const full = preferences.current.items.length >= MAX_PINNED_INDICES
                && !preferences.current.items.some(item => pinnedIndexId(item) === pinnedIndexId(source!.item));
            event.dataTransfer!.dropEffect = full ? 'none' : 'move';
            setOverHeader(result.inside && !full);
            setTarget(source.item.pinned && result.targetId !== pinnedIndexId(source.item) ? result.targetId : undefined);
        };
        const drop = (event: globalThis.DragEvent) => {
            if (!supported(event) || !source) return;
            event.preventDefault(); event.stopPropagation();
            const {item} = source;
            const result = hit(event);
            if (result.inside) {
                preferences.current.setItems(current => item.pinned
                    ? reorderPinnedIndex(current, item, result.targetId)
                    : appendPinnedIndex(current, {market: item.market, symbol: item.symbol}));
            } else if (item.pinned) {
                preferences.current.setItems(current => current.filter(entry => pinnedIndexId(entry) !== pinnedIndexId(item)));
            }
            reset();
        };
        const enter = (event: globalThis.DragEvent) => {if (supported(event)) event.preventDefault();};
        window.addEventListener('dragenter', enter, true);
        window.addEventListener('dragstart', start);
        window.addEventListener('dragover', over, true);
        window.addEventListener('drop', drop, true);
        window.addEventListener('dragend', reset, true);
        return () => {
            window.removeEventListener('dragstart', start);
            window.removeEventListener('dragover', over, true);
            window.removeEventListener('drop', drop, true);
            window.removeEventListener('dragend', reset, true);
            window.removeEventListener('dragenter', enter, true);
        };
    }, []);
    const price = new Intl.NumberFormat(i18n.resolvedLanguage, {minimumFractionDigits: 2, maximumFractionDigits: 2});
    const percent = new Intl.NumberFormat(i18n.resolvedLanguage, {style: 'percent', minimumFractionDigits: 2, maximumFractionDigits: 2, signDisplay: 'exceptZero'});
    const atLimit = items.length >= MAX_PINNED_INDICES && !items.some(item => pinnedIndexId(item) === draggedId);
    return <div ref={surface} className="stock-pinned-indices" data-drag-active={dragging && !draggingPinned} data-drag-over={overHeader && !draggingPinned} aria-label={t('stockAnalysis.pinnedIndices.label')}>
        <div className="stock-pinned-indices-track">
        {failed && <button type="button" className="stock-pinned-indices-retry" onClick={retry}>{t('stockAnalysis.pinnedIndices.syncFailed')}</button>}
        {items.map(item => {
            const id = pinnedIndexId(item);
            const quote = indices.find(index => (index.indexSymbol ?? index.symbol) === item.symbol);
            const label = MARKET_INDEX_LABELS[item.market].find(label => label.symbol === item.symbol)!;
            const futures = !!INDEX_FUTURE_LABELS[quote?.symbol ?? ''];
            const shortName = t(`stockAnalysis.${quote?.symbol === 'NQ=F' ? 'indexNasdaq100' : label.key}`);
            const name = t(`stockAnalysis.${INDEX_FUTURE_LABELS[quote?.symbol ?? ''] ?? label.key}`);
            return <div className="stock-pinned-index" key={id} data-market={item.market} data-pinned-index={id}
                data-drop={target === id && draggedId !== id ? 'before' : undefined}
                data-direction={!quote?.changePercent ? 'flat' : quote.changePercent > 0 ? 'up' : 'down'} draggable
                onDragStart={event => {
                    event.dataTransfer.effectAllowed = 'move';
                    event.dataTransfer.setData(INDEX_DRAG_TYPE, JSON.stringify({...item, pinned: true}));
                }}>
                <button className="stock-pinned-index-open" type="button" aria-label={name} onClick={() => onOpen(item.market, {symbol: quote?.symbol ?? item.symbol, name})}>
                    <span className="stock-pinned-index-label">
                        {futures && <Tooltip content={name} placement="below"><span className="stock-pinned-index-session"><MoonStar size={11} aria-hidden="true"/></span></Tooltip>}
                        <span className="stock-pinned-index-name">{shortName}</span>
                    </span><strong>{quote?.price == null ? '—' : price.format(quote.price)}</strong>
                    <small>{quote?.changePercent == null ? '—' : percent.format(quote.changePercent / 100)}</small>
                </button>
                <ModalCloseButton className="stock-pinned-index-remove" aria-label={t('stockAnalysis.pinnedIndices.remove', {name})}
                    onClick={() => setItems(current => current.filter(entry => pinnedIndexId(entry) !== id))}/>
            </div>;
        })}
        </div>
        {dragging && !draggingPinned && <span className="stock-pinned-indices-hint">{t(atLimit ? 'stockAnalysis.pinnedIndices.limitHint' : 'stockAnalysis.pinnedIndices.dropHint', {count: MAX_PINNED_INDICES})}</span>}
    </div>;
}
