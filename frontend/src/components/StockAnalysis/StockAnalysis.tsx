import {useEffect, useState} from 'react';
import {localizeStockName} from '../../utils/stockDisplayName';
import {ArrowLeft, ChartCandlestick, RefreshCw, Search, Settings, Star} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import {stockSnapshotCache} from '../../services/stockSnapshotCache';
import {stockAnalysis, type DailyPrice, type StockMarket, type StockSymbol} from '../../services/stockAnalysis';
import WorkspaceExitButton from '../common/WorkspaceLayout/WorkspaceExitButton';
import WorkspaceLayout from '../common/WorkspaceLayout/WorkspaceLayout';
import {Tooltip} from '../common/Tooltip/Tooltip';
import CustomSelect from '../CustomSelect/CustomSelect';
import StockApiSettings from './StockApiSettings';
import StockLoadingIndicator from './StockLoadingIndicator';
import {getInitialMarket, saveMarketPreference} from './marketPreference';
import StockSectorMap from './StockSectorMap';
import StockPriceChart from './StockPriceChart';
import StockDiscussionSidebar from './StockDiscussionSidebar';
import useStockWatchlist from './useStockWatchlist';
import '../common/SettingsIconButton/SettingsIconButton.css';
import './StockAnalysis.css';
import './StockWatchlist.css';

const MARKETS: StockMarket[] = ['KR', 'US'];
const VISIBLE_SYMBOLS = 100;
export default function StockAnalysis({onClose}: {onClose: () => void}) {
    const [apiVersion, setApiVersion] = useState(0);
    return <StockAnalysisContent key={apiVersion} onClose={onClose} onApiSaved={() => {
        stockSnapshotCache.clear();
        setApiVersion(version => version + 1);
    }}/>;
}

function StockAnalysisContent({onClose, onApiSaved}: {onClose: () => void; onApiSaved: () => void}) {
    const {t, i18n} = useTranslation('main');
    const tr = (key: string, options?: Record<string, unknown>) => t(`stockAnalysis.${key}`, options);
    const [apiSettingsOpen, setApiSettingsOpen] = useState(false);
    const [market, setMarket] = useState<StockMarket>(() => getInitialMarket(i18n.resolvedLanguage ?? i18n.language));
    useEffect(() => {saveMarketPreference(market);}, [market]);
    const [symbols, setSymbols] = useState<StockSymbol[]>(() => stockSnapshotCache.readSymbols(market, i18n.resolvedLanguage) ?? []);
    const [query, setQuery] = useState('');
    const [comparisonTarget, setComparisonTarget] = useState<HTMLDivElement | null>(null);
    const [watchlistOnly, setWatchlistOnly] = useState(false);
    const watchlist = useStockWatchlist();
    const [active, setActive] = useState<StockSymbol | null>(null);
    const [rows, setRows] = useState<DailyPrice[] | null>(null);
    const [directoryState, setDirectoryState] = useState<'loading' | 'ready' | 'error'>(() => symbols.length ? 'ready' : 'loading');
    const [directoryVersion, setDirectoryVersion] = useState(0);
    const [priceError, setPriceError] = useState(false);
    const [loading, setLoading] = useState(false);
    const [refreshVersion, setRefreshVersion] = useState(0);
    const activeSymbol = active?.symbol;
    const watchlistCount = symbols.filter(item => watchlist.contains(market, item.symbol)).length;
    const filtered = symbols.filter(({symbol, name}) => (!watchlistOnly || watchlist.contains(market, symbol))
        && `${symbol} ${name}`.toLowerCase().includes(query.trim().toLowerCase()));

    useEffect(() => {
        const controller = new AbortController();
        const cached = stockSnapshotCache.readSymbols(market, i18n.resolvedLanguage);
        setSymbols(cached ?? []);
        setDirectoryState(cached ? 'ready' : 'loading');
        stockAnalysis.symbols(market, controller.signal, i18n.resolvedLanguage ?? i18n.language).then(result => {
            if (controller.signal.aborted) return;
            stockSnapshotCache.writeSymbols(market, result, i18n.resolvedLanguage);
            setSymbols(result);
            setDirectoryState('ready');
        }).catch(() => {
            if (!controller.signal.aborted && !cached) setDirectoryState('error');
        });
        return () => controller.abort();
    }, [market, directoryVersion, i18n.resolvedLanguage, i18n.language]);

    useEffect(() => {
        if (!activeSymbol) return;
        const controller = new AbortController();
        stockAnalysis.prices(activeSymbol, controller.signal, refreshVersion > 0).then(result => {
            if (controller.signal.aborted) return;
            if (!result.length && refreshVersion > 0) {
                setPriceError(true);
                return;
            }
            setRows(result);
        }).catch(() => {
            if (!controller.signal.aborted) setPriceError(true);
        }).finally(() => {
            if (!controller.signal.aborted) setLoading(false);
        });
        return () => controller.abort();
    }, [activeSymbol, refreshVersion]);

    const changeMarket = (value: string) => {
        if (value === market) return;
        if (value !== 'KR' && value !== 'US') return;
        setMarket(value);
        saveMarketPreference(value);
        setSymbols([]);
        setDirectoryState('loading');
        setQuery('');
        setActive(null);
        setRows(null);
        setPriceError(false);
        setLoading(false);
        setRefreshVersion(0);
    };

    const openSymbol = (item: StockSymbol) => {
        if (item.symbol === activeSymbol) return;
        const name = localizeStockName(item.name, i18n.resolvedLanguage ?? i18n.language);
        setActive({...item, name: item.preferred ? `${name} · ${tr('preferredShare')}` : name});
        setRows(null);
        setPriceError(false);
        setLoading(true);
        setRefreshVersion(0);
    };

    const header = <>
        <div className="stock-analysis-title"><ChartCandlestick size={20} aria-hidden="true"/><strong>{tr('title')}</strong></div>
        <WorkspaceExitButton className="stock-analysis-exit" onClick={onClose}/>
    </>;

    const sidebar = <div className="stock-analysis-sidebar">
        <section className="stock-analysis-market-section" aria-label={tr('market')}>
        <CustomSelect options={MARKETS.map(value => ({value, label: tr(value)}))} value={market}
                      onChange={changeMarket} ariaLabel={tr('market')} portal/>
        <button type="button" className="settings-icon-button" aria-label={tr('api.title')} onClick={() => setApiSettingsOpen(true)}><Settings size={16} aria-hidden="true"/></button>
        </section>
        <div className="stock-watchlist-switch" role="group" aria-label={tr('listView')}>
            <button type="button" aria-pressed={!watchlistOnly} onClick={() => setWatchlistOnly(false)}><span className="stock-watchlist-label">{tr('allStocks')}</span></button>
            <button type="button" aria-pressed={watchlistOnly} onClick={() => setWatchlistOnly(true)}>
                <span className="stock-watchlist-label">{tr('watchlist')}</span><span className="stock-watchlist-count">{new Intl.NumberFormat(i18n.resolvedLanguage).format(watchlistCount)}</span>
            </button>
        </div>
        <label className="stock-analysis-search">
            <Search size={16} aria-hidden="true"/>
            <input type="search" aria-label={tr('search')} placeholder={tr('search')} value={query}
                   onChange={event => setQuery(event.target.value)}/>
        </label>
        {directoryState === 'loading' && <p role="status">{tr('loading')}</p>}
        {directoryState === 'error' && <>
            <p role="alert">{tr('directoryError')}</p>
            <button className="modal-action-cancel" onClick={() => {
                setDirectoryState('loading');
                setDirectoryVersion(value => value + 1);
            }}>{tr('retry')}</button>
        </>}
        {directoryState === 'ready' && <>
            <p className="stock-analysis-caption">{tr('results', {shown: new Intl.NumberFormat(i18n.resolvedLanguage).format(Math.min(filtered.length, VISIBLE_SYMBOLS)), total: new Intl.NumberFormat(i18n.resolvedLanguage).format(filtered.length)})}</p>
            <ul className="stock-analysis-symbols">
                {filtered.slice(0, VISIBLE_SYMBOLS).map(item => <li key={item.symbol}>
                    <button aria-pressed={item.symbol === activeSymbol} onClick={() => openSymbol(item)}>
                        <strong className="stock-symbol-code">{item.symbol}
                            {market === 'KR' && item.exchange && <Tooltip content={tr(item.exchange === 'KOSPI' ? 'indexKospi' : 'indexKosdaq')}>
                                <small className="stock-symbol-exchange" data-exchange={item.exchange === 'KOSPI' ? 'kospi' : 'kosdaq'}
                                    aria-label={tr(item.exchange === 'KOSPI' ? 'indexKospi' : 'indexKosdaq')}>
                                    {tr(item.exchange === 'KOSPI' ? 'exchangeBadgeKospi' : 'exchangeBadgeKosdaq')}
                                </small>
                            </Tooltip>}
                        </strong><span>{item.name}{item.preferred && <small className="stock-symbol-preferred">{tr('preferredShare')}</small>}</span>
                    </button>
                    <button type="button" className="stock-watchlist-star" aria-pressed={watchlist.contains(market, item.symbol)}
                        aria-label={tr(watchlist.contains(market, item.symbol) ? 'removeFromRadar' : 'addToRadar', {name: item.name})}
                        onClick={() => watchlist.toggle(market, item.symbol)}><Star size={15} strokeWidth={1.5} aria-hidden="true"/></button>
                </li>)}
            </ul>
            {watchlistOnly && !filtered.length && <div className="stock-watchlist-empty">
                <Star size={24} strokeWidth={1.5} aria-hidden="true"/>
                <strong>{tr(watchlistCount ? 'radarNoResults' : 'radarEmpty')}</strong>
                <p>{tr(watchlistCount ? 'radarSearchHint' : 'radarEmptyHint')}</p>
            </div>}
        </>}
    </div>;

    return <>
    {apiSettingsOpen && <StockApiSettings market={market} onClose={() => setApiSettingsOpen(false)} onSaved={onApiSaved}/>}
    <WorkspaceLayout className="stock-analysis" label={tr('title')} header={header} sidebar={sidebar}>
        <div className={`stock-analysis-inner${active ? " has-discussion" : ""}`}><main className="stock-analysis-content">
            {!active && <StockSectorMap key={`${market}:${i18n.resolvedLanguage}`} market={market} onOpen={openSymbol} directory={symbols}/>}
            {active && <div className="stock-analysis-heading">
                <div className="stock-analysis-chart-title"><button type="button" className="stock-analysis-back" aria-label={tr('sectorMap')} onClick={() => {
                    setActive(null);
                    setRows(null);
                    setLoading(false);
                    setPriceError(false);
                    setRefreshVersion(0);
                }}><ArrowLeft size={16} aria-hidden="true"/></button>
                    <h1>{active.name}</h1><p>{active.symbol}</p></div>
                <div className="stock-analysis-header-actions">
                <div className="stock-analysis-comparison-action" ref={setComparisonTarget}/>
                {active && <button type="button" className="modal-action-cancel stock-analysis-refresh" aria-label={tr('refresh')} disabled={loading} onClick={() => {
                    setLoading(true);
                    setPriceError(false);
                    setRefreshVersion(value => value + 1);
                }}><RefreshCw size={16} aria-hidden="true"/></button>}
                </div>
            </div>}
            {active && <div className="stock-analysis-chart-stage" aria-busy={loading}>
            {loading && <StockLoadingIndicator title={active.name} overlay={!!rows?.length} iconOnly/>}
            {priceError && <p role="alert">{tr('historyError')}</p>}
            {rows?.length === 0 && !loading && !priceError && <p>{tr('noPrices')}</p>}
            {active && !!rows?.length && <StockPriceChart key={active.symbol} symbol={active.symbol} name={active.name} rows={rows} market={market} directory={symbols} comparisonTarget={comparisonTarget} label={tr('dailyPrices')}/>}
            </div>}
            {active && <footer className="stock-chart-attribution stock-analysis-caption">
                <span>{tr('source')}</span>
                <a href="https://www.tradingview.com/" target="_blank" rel="noreferrer">TradingView Lightweight Charts™ · © 2025 TradingView, Inc.</a>
            </footer>}
        </main>
        {active && <StockDiscussionSidebar key={`${market}:${active.symbol}`} stock={active} market={market} directory={symbols}/>}
        </div>
    </WorkspaceLayout></>;
}
