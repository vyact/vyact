import {useEffect, useMemo, useRef, useState} from 'react';
import {hierarchy, treemap, type HierarchyRectangularNode} from 'd3-hierarchy';
import {ArrowLeft} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import {stockSnapshotCache} from '../../services/stockSnapshotCache';
import {stockAnalysis, type MarketSector, type MarketSectorMap, type SectorStock, type StockMarket, type StockSymbol} from '../../services/stockAnalysis';
import StockLoadingIndicator from './StockLoadingIndicator';
import MarketIndexSummary from './MarketIndexSummary';
import MarketOpenCountdown from './MarketOpenCountdown';
import StockSparkline, {SPARKLINE_TRADING_DAYS, useSectorSparklines} from './StockSparkline';
import {isMarketWeekend} from './marketRefresh';
import StockRefreshInterval from './StockRefreshInterval';
import {DEFAULT_REFRESH_SECONDS} from './chartRefreshPreference';
import type {StockGroup} from './useStockGroups';
import useStockGroupQuotes from './useStockGroupQuotes';
import {buildGroupSectors, groupMapSymbols} from './groupMapData';
import {formatPremarketQuoteDate} from './premarketDisplay';
import './StockSectorMap.css';

type MapNode = {
    sector?: MarketSector;
    stock?: SectorStock;
    weight?: number;
    children?: MapNode[];
};

function tileStyle(node: HierarchyRectangularNode<MapNode>, width: number, height: number) {
    return {left: `${node.x0 / width * 100}%`, top: `${node.y0 / height * 100}%`,
        width: `${(node.x1 - node.x0) / width * 100}%`, height: `${(node.y1 - node.y0) / height * 100}%`};
}

function tileColor(change: number | null, market: StockMarket) {
    if (!change) return 'var(--stock-map-neutral)';
    const tone = Math.min(Math.abs(change) / (market === 'KR' ? 6 : 3), 1);
    const direction = change > 0 ? '--stock-map-up' : '--stock-map-down';
    return `color-mix(in srgb, var(${direction}) ${Math.round(24 + tone * 76)}%, var(--stock-map-neutral))`;
}

const PREVIEW_LIMIT = 15;
const SECTOR_HEADER_HEIGHT = 24;
const PREVIEW_PANEL_WIDTH = 440;
const PREVIEW_PANEL_MARGIN = 8;
const PREVIEW_PANEL_GAP = 12;

export function SectorPreview({sector, focused, market, day, premarket = false, customName = false}: {sector: MarketSector; focused?: SectorStock; market: StockMarket; day: string; premarket?: boolean; customName?: boolean}) {
    const {t, i18n} = useTranslation('main');
    const histories = useSectorSparklines(sector.stocks.map(stock => stock.symbol), day);
    const percent = new Intl.NumberFormat(i18n.resolvedLanguage, {
        style: 'percent', minimumFractionDigits: 2, maximumFractionDigits: 2, signDisplay: 'exceptZero',
    });
    const price = new Intl.NumberFormat(i18n.resolvedLanguage, {
        style: 'currency', currency: {US: 'USD', KR: 'KRW', JP: 'JPY'}[market], currencyDisplay: 'narrowSymbol',
        minimumFractionDigits: market === 'US' ? 2 : 0, maximumFractionDigits: market === 'KR' ? 0 : 2,
    });
    const sorted = [...sector.stocks].sort((a, b) => b.weight - a.weight);
    const entries = sorted.slice(0, PREVIEW_LIMIT);
    return <div className="stock-sector-preview" data-market={market}>
        <div className="stock-sector-preview-heading">
            {premarket && <span className="stock-sector-preview-session">{t('stockAnalysis.premarket.label')}</span>}
            <strong className="stock-sector-preview-title">{customName ? sector.name : t(`stockAnalysis.sectorNames.${sector.name}`, {defaultValue: sector.name, ...(market === 'US' ? {lng: 'en'} : {})})}</strong>
        </div>
        <small className="stock-sector-preview-period">{t('stockAnalysis.mapTrendDays', {count: SPARKLINE_TRADING_DAYS})}</small>
        {focused && <div className="stock-sector-preview-selected">
            <div className="stock-sector-preview-selected-quote">
                <strong className="stock-sector-preview-selected-symbol">{market === 'US' ? focused.symbol : focused.name}</strong>
                <StockSparkline closes={histories[focused.symbol]} change={premarket ? focused.regularChange : focused.change}/><span>{focused.price == null ? '—' : price.format(focused.price)}</span>
                <strong data-direction={focused.change == null || focused.change === 0 ? 'flat' : focused.change > 0 ? 'up' : 'down'}>
                    {focused.change == null ? '—' : percent.format(focused.change / 100)}
                </strong>
                {premarket && <>
                    <small className="stock-sector-preview-regular-price" aria-label={t('stockAnalysis.premarket.regularClose')} data-tooltip-disabled="">
                        {focused.regularPrice == null ? '—' : price.format(focused.regularPrice)}
                    </small>
                    <small className="stock-sector-preview-regular-change" aria-label={t('stockAnalysis.premarket.regularChange')} data-tooltip-disabled="">
                        {focused.regularChange == null ? '—' : percent.format(focused.regularChange / 100)}
                    </small>
                </>}
            </div>
            <span className="stock-sector-preview-selected-name">{market === 'US' ? focused.name : focused.symbol}</span>

        </div>}
        <ul style={{gridTemplateRows: `repeat(${PREVIEW_LIMIT}, minmax(0, 1fr))`}}>
            {entries.map(stock => <li key={stock.symbol} className={stock.symbol === focused?.symbol ? 'focused' : undefined}>
                <span className="stock-sector-preview-symbol">{market === 'US' ? stock.symbol : stock.name}</span>
                <StockSparkline closes={histories[stock.symbol]} change={premarket ? stock.regularChange : stock.change}/>
                <span>{stock.price == null ? '—' : price.format(stock.price)}</span>
                <strong data-direction={stock.change == null || stock.change === 0 ? 'flat' : stock.change > 0 ? 'up' : 'down'}>
                    {stock.change == null ? '—' : percent.format(stock.change / 100)}
                </strong>
            </li>)}
        </ul>
    </div>;
}

export default function StockSectorMap({market, onOpen, directory = [], stockGroups}: {market: StockMarket; onOpen: (item: StockSymbol) => void; directory?: StockSymbol[]; stockGroups?: StockGroup[]}) {
    const {t, i18n} = useTranslation('main');
    const [snapshot, setSnapshot] = useState<MarketSectorMap | undefined>(() => stockSnapshotCache.readMap(market, i18n.resolvedLanguage));
    const [failed, setFailed] = useState(false);
    const [attempt, setAttempt] = useState(0);
    const [nextRegularOpen, setNextRegularOpen] = useState<number>();
    const [refreshSeconds, setRefreshSeconds] = useState<number>(DEFAULT_REFRESH_SECONDS);
    const [selectedSector, setSelectedSector] = useState<MarketSector>();
    const [preview, setPreview] = useState<{sectorName: string; symbol?: string}>();
    const [size, setSize] = useState({width: 0, height: 0});
    const surface = useRef<HTMLDivElement>(null);
    const loadedMarket = useRef<StockMarket | undefined>(undefined);
    const previewTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    useEffect(() => () => clearTimeout(previewTimer.current), []);
    const {width, height} = size;
    const format = new Intl.NumberFormat(i18n.resolvedLanguage, {
        style: 'percent', minimumFractionDigits: 2, maximumFractionDigits: 2, signDisplay: 'exceptZero',
    });
    const changeText = (change: number | null) => change === null ? '—' : format.format(change / 100);

    useEffect(() => {
        setPreview(undefined);
        const cached = stockSnapshotCache.readMap(market, i18n.resolvedLanguage);
        loadedMarket.current = cached ? market : undefined;
        setSnapshot(cached);
        setSelectedSector(undefined);
        setFailed(false);
    }, [market, attempt, i18n.resolvedLanguage]);

    useEffect(() => {
        const controller = new AbortController();
        let refreshing = false;
        const refresh = (initial = false) => {
            if (isMarketWeekend(market) && (!initial || loadedMarket.current === market)) return;
            if (refreshing) return;
            refreshing = true;
            return stockAnalysis.sectorMap(market, controller.signal, i18n.resolvedLanguage ?? i18n.language).then(result => {
            if (!controller.signal.aborted) {
                stockSnapshotCache.writeMap(market, result, i18n.resolvedLanguage);
                loadedMarket.current = market;
                setSnapshot(result);
                setSelectedSector(current => current ? result.sectors.find(sector => sector.name === current.name) : undefined);
                setFailed(false);
            }
        }).catch(() => {
            if (!controller.signal.aborted) setFailed(true);
        }).finally(() => { refreshing = false; });
        };
        void refresh(true);
        const interval = window.setInterval(() => {void refresh();}, refreshSeconds * 1000);
        return () => {
            controller.abort();
            window.clearInterval(interval);
        };
    }, [market, attempt, refreshSeconds, i18n.resolvedLanguage, i18n.language]);

    useEffect(() => {
        const node = surface.current;
        if (!node) return;
        const observer = new ResizeObserver(([entry]) => {
            const {width, height} = entry.contentRect;
            setSize({width, height});
        });
        observer.observe(node);
        return () => observer.disconnect();
    }, []);

    const groupSymbols = [...new Set(stockGroups?.flatMap(group => groupMapSymbols(group)) ?? [])];
    const groupQuoteState = useStockGroupQuotes(groupSymbols, refreshSeconds);
    const missingGroupQuotes = groupSymbols.filter(symbol => !groupQuoteState.quotes.some(quote => quote.symbol === symbol && quote.marketCap > 0));
    const localizedSectors = useMemo(() => {
        const names = new Map(directory.map(item => [item.symbol, item.name]));
        if (stockGroups) return buildGroupSectors(stockGroups, groupQuoteState.quotes, directory);
        return snapshot?.sectors.map(sector => ({...sector, stocks: sector.stocks.map(stock =>
            ({...stock, name: names.get(stock.symbol) ?? stock.name}))}));
    }, [snapshot, directory, stockGroups, groupQuoteState.quotes]);
    const sectorName = (name: string) => stockGroups ? name : t(`stockAnalysis.sectorNames.${name}`, {defaultValue: name, ...(market === 'US' ? {lng: 'en'} : {})});
    const layout = useMemo(() => {
        if (!localizedSectors || width <= 0 || height <= 0) return;
        const stockNodes = (sector: MarketSector): MapNode[] => (localizedSectors?.find(item => item.name === sector.name) ?? sector).stocks.map(stock => ({stock, weight: stock.weight}));
        const children = selectedSector ? stockNodes(selectedSector) : localizedSectors.map((sector): MapNode =>
            ({sector, children: stockNodes(sector)}));
        const root = hierarchy<MapNode>({children}).sum(node => node.weight ?? 0)
            .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
        return treemap<MapNode>().size([width, height]).round(true).paddingInner(2)
            .paddingTop(node => !selectedSector && node.depth === 1 ? SECTOR_HEADER_HEIGHT : 0)(root);
    }, [localizedSectors, selectedSector, width, height]);

    const previewSector = localizedSectors?.find(sector => sector.name === preview?.sectorName);
    const previewStock = previewSector?.stocks.find(stock => stock.symbol === preview?.symbol);
    const showPreview = (sector: MarketSector, stock?: SectorStock) => {
        clearTimeout(previewTimer.current);
        previewTimer.current = setTimeout(() => {
            setPreview({sectorName: sector.name, symbol: stock?.symbol});
        }, 70);
    };
    const previewAnchor = selectedSector
        ? layout?.leaves().find(node => node.data.stock?.symbol === preview?.symbol)
        : layout?.children?.find(node => node.data.sector?.name === preview?.sectorName);
    const previewWidth = Math.max(0, Math.min(PREVIEW_PANEL_WIDTH, width - PREVIEW_PANEL_MARGIN * 2));
    const rightSpace = width - (previewAnchor?.x1 ?? width);
    const leftSpace = previewAnchor?.x0 ?? 0;
    const placeOnRight = rightSpace >= previewWidth + PREVIEW_PANEL_GAP
        || (leftSpace < previewWidth + PREVIEW_PANEL_GAP && rightSpace >= leftSpace);
    const preferredLeft = placeOnRight
        ? (previewAnchor?.x1 ?? 0) + PREVIEW_PANEL_GAP
        : (previewAnchor?.x0 ?? width) - previewWidth - PREVIEW_PANEL_GAP;
    const previewLeft = Math.max(PREVIEW_PANEL_MARGIN,
        Math.min(preferredLeft, width - previewWidth - PREVIEW_PANEL_MARGIN));

    const premarket = market === 'US' && !stockGroups && snapshot?.session === 'premarket';
    const title = selectedSector ? sectorName(selectedSector.name) : stockGroups ? t('stockAnalysis.groups.all') : t({KR: 'stockAnalysis.mapKorea', US: 'stockAnalysis.mapUs', JP: 'stockAnalysis.mapJapan'}[market]);
    const dateFormat = new Intl.DateTimeFormat(i18n.resolvedLanguage, {dateStyle: 'medium', timeZone: 'UTC'});
    const formatDay = (day: string) => dateFormat.format(new Date(day));

    return <section className="stock-sector-map" data-market={market} aria-label={title}>
        <header className="stock-sector-map-heading">
            {selectedSector && <button type="button" className="modal-action-cancel" onClick={() => setSelectedSector(undefined)}>
                <ArrowLeft size={14} aria-hidden="true"/>{t(stockGroups ? 'stockAnalysis.groups.tab' : 'stockAnalysis.sectorMap')}
            </button>}
            <h1>{title}</h1>
            {!stockGroups && <MarketOpenCountdown opening={nextRegularOpen}/>}
            <div className="stock-sector-map-controls">
            {(stockGroups ? !!groupQuoteState.quotes.length : !!snapshot) && <div className="stock-sector-map-dates">
                <span>{premarket ? snapshot?.quoteTime ? t('stockAnalysis.premarket.asOf', {date: formatPremarketQuoteDate(snapshot.quoteTime, i18n.resolvedLanguage)}) : t('stockAnalysis.premarket.unavailable') : t(stockGroups ? 'stockAnalysis.mapQuoteDate' : 'stockAnalysis.sectorMapQuoteDate', {date: formatDay(stockGroups ? groupQuoteState.quotes.map(quote => quote.date).sort().slice(-1)[0] : snapshot!.quoteDate ?? snapshot!.date)})}</span>
            </div>}
            <StockRefreshInterval seconds={refreshSeconds} onChange={setRefreshSeconds}/>
            </div>
        </header>
        {!stockGroups && <MarketIndexSummary key={market} market={market} refreshSeconds={refreshSeconds} onOpen={onOpen} onOpeningChange={setNextRegularOpen}/>}
        {stockGroups && !groupQuoteState.loading && missingGroupQuotes.length > 0 && <p className="stock-analysis-caption" role="status">{t('stockAnalysis.groups.missingCaps', {count: missingGroupQuotes.length})}</p>}
        <div className="stock-sector-map-surface" ref={surface} onMouseLeave={() => {clearTimeout(previewTimer.current); setPreview(undefined);}}
             onKeyDown={event => {if (event.key === 'Escape' && preview) {event.stopPropagation(); setPreview(undefined);}}}
             aria-busy={stockGroups ? groupQuoteState.loading : !snapshot && !failed}>
            {stockGroups && groupQuoteState.loading && <StockLoadingIndicator title={title}/>}
            {stockGroups && groupQuoteState.failed && <div className="stock-sector-map-error" role="alert"><p>{t('stockAnalysis.mapError')}</p></div>}
            {!stockGroups && !snapshot && !failed && <StockLoadingIndicator title={title}/>}
            {!stockGroups && failed && !snapshot && <div className="stock-sector-map-error" role="alert">
                <p>{t('stockAnalysis.mapError')}</p>
                <button type="button" className="modal-action-cancel" onClick={() => {
                    setFailed(false);
                    setAttempt(value => value + 1);
                }}>{t('stockAnalysis.retry')}</button>
            </div>}
            <div className="stock-sector-map-tiles">
            {!selectedSector && layout?.children?.map(node => {
                const sector = node.data.sector;
                if (!sector || node.y1 - node.y0 < 34) return null;
                return <button key={sector.name} type="button" className="stock-sector-map-group" style={{...tileStyle(node, width, height), height: SECTOR_HEADER_HEIGHT}}
                            onMouseEnter={() => showPreview(sector)}
                            onFocus={() => showPreview(sector)}
                            onBlur={() => {clearTimeout(previewTimer.current); setPreview(undefined);}}
                            onClick={() => {clearTimeout(previewTimer.current); setPreview(undefined); if (!stockGroups) setSelectedSector(sector);}}>{sectorName(sector.name)}</button>;
            })}
            {layout?.leaves().map(node => {
                const {sector, stock} = node.data;
                const item = sector ?? stock;
                if (!item || node.x1 <= node.x0 || node.y1 <= node.y0) return null;
                const tileWidth = node.x1 - node.x0;
                const tileHeight = node.y1 - node.y0;
                const label = market === 'US' && stock ? stock.symbol : item.name;
                const detail = changeText(item.change);
                const key = stock ? `${node.parent?.data.sector?.name ?? ''}:${stock.symbol}` : item.name;
                const previewSector = sector ?? selectedSector ?? node.parent?.data.sector;
                return <button key={key} type="button" className="stock-sector-map-tile" aria-label={`${item.name} · ${detail}`}
                            style={{...tileStyle(node, width, height), background: tileColor(item.change, market),
                                fontSize: Math.min(23, Math.max(10, Math.min(tileWidth / 7, tileHeight / 3.5)))}}
                            onMouseEnter={() => {if (previewSector) showPreview(previewSector, stock);}}
                            onFocus={() => {if (previewSector) showPreview(previewSector, stock);}}
                            onBlur={() => {clearTimeout(previewTimer.current); setPreview(undefined);}}
                            onClick={() => {clearTimeout(previewTimer.current); setPreview(undefined); if (stock) onOpen(stock); else if (sector && !stockGroups) setSelectedSector(sector);}}>
                        {tileWidth >= 37 && tileHeight >= 17 && <strong>{label}</strong>}
                        {tileWidth >= 47 && tileHeight >= 34 && <span>{detail}</span>}
                    </button>;
            })}
            </div>
            {previewSector && preview && <aside className="stock-sector-map-preview-panel" style={{left: previewLeft, width: previewWidth}}
                aria-label={previewSector.name}>
                <SectorPreview premarket={premarket} customName={!!stockGroups} sector={previewSector} focused={previewStock} market={market} day={snapshot?.quoteDate ?? snapshot?.date ?? ''}/>
            </aside>}
        </div>
    </section>;
}
