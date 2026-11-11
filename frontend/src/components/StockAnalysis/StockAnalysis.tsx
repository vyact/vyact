import './StockSymbolLabel.css';
import type {ChartSnapshot} from './chartSnapshot';
import {useEffect, useRef, useState} from 'react';
import {localizeStockName} from '../../utils/stockDisplayName';
import {ArrowLeft, ChartCandlestick, RefreshCw, Search, Settings, Star, Plus, Pencil, Trash2, LayoutGrid, FolderOpen, ChevronDown, ChevronLeft, ChevronRight} from 'lucide-react';
import {Trans, useTranslation} from 'react-i18next';
import {stockSnapshotCache} from '../../services/stockSnapshotCache';
import {stockAnalysis, type DailyPrice, type StockMarket, type StockSymbol} from '../../services/stockAnalysis';
import WorkspaceExitButton from '../common/WorkspaceLayout/WorkspaceExitButton';
import WorkspaceLayout from '../common/WorkspaceLayout/WorkspaceLayout';
import PanelResizer from '../common/PanelResizer/PanelResizer';
import StockMarketSelect from './StockMarketSelect';
import StockFinancialCollection from './StockFinancialCollection';
import StockApiSettings from './StockApiSettings';
import StockLoadingIndicator from './StockLoadingIndicator';
import {getInitialMarket, saveMarketPreference} from './marketPreference';
import StockSectorMap from './StockSectorMap';
import StockPriceChart from './StockPriceChart';
import useStockPriceRefresh from './useStockPriceRefresh';
import StockHistory from './StockHistory';
import StockFinancials from './StockFinancials';
import ModalTabs from '../common/ModalTabs/ModalTabs';
import StockDiscussionPanel from './StockDiscussionPanel';
import useStockGroupDrag from './useStockGroupDrag';
import useStockGroups, {type StockGroup} from './useStockGroups';
import StockGroupDialog from './StockGroupDialog';
import ConfirmModal from '../common/ConfirmModal/ConfirmModal';
import StockRefreshInterval from './StockRefreshInterval';
import {readChartRefreshSeconds, saveChartRefreshSeconds} from './chartRefreshPreference';
import './StockGroups.css';
import useStockWatchlist from './useStockWatchlist';
import '../common/SettingsIconButton/SettingsIconButton.css';
import './StockAnalysis.css';
import './StockWatchlist.css';

const VISIBLE_SYMBOLS = 100;
const SIDEBAR_WIDTH_KEY = 'vyact:stock-analysis:sidebar-width';
const DEFAULT_SIDEBAR_WIDTH = 248;
const MIN_SIDEBAR_WIDTH = 180;
const MAX_SIDEBAR_WIDTH = DEFAULT_SIDEBAR_WIDTH * 2;
const MIN_CHART_WIDTH = 320;
function readSidebarWidth(): number {
    try {
        const value = Number(localStorage.getItem(SIDEBAR_WIDTH_KEY));
        if (Number.isFinite(value) && value >= MIN_SIDEBAR_WIDTH && value <= MAX_SIDEBAR_WIDTH) return value;
    } catch { /* Use the default width. */ }
    return DEFAULT_SIDEBAR_WIDTH;
}
const SIDEBAR_COLLAPSED_KEY = 'vyact:stock-analysis:sidebar-collapsed';
function readSidebarCollapsed(): boolean {
    try {return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === 'true';} catch {return false;}
}
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
    const [sidebarWidth, setSidebarWidth] = useState(readSidebarWidth);
    const updateSidebarWidth = (width: number) => {
        setSidebarWidth(width);
        try {localStorage.setItem(SIDEBAR_WIDTH_KEY, String(width));} catch { /* Keep session state. */ }
    };
    const [sidebarCollapsed, setSidebarCollapsed] = useState(readSidebarCollapsed);
    const toggleSidebar = () => {
        const next = !sidebarCollapsed;
        setSidebarCollapsed(next);
        try {localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(next));} catch { /* Keep session state. */ }
    };
    const [detailTab, setDetailTab] = useState<'chart' | 'history' | 'financials'>('chart');
    const [apiSettingsOpen, setApiSettingsOpen] = useState(false);
    const [market, setMarket] = useState<StockMarket>(() => getInitialMarket(i18n.resolvedLanguage ?? i18n.language));
    useEffect(() => {saveMarketPreference(market);}, [market]);
    const [symbols, setSymbols] = useState<StockSymbol[]>(() => stockSnapshotCache.readSymbols(market, i18n.resolvedLanguage) ?? []);
    const [query, setQuery] = useState('');
    const captureChart = useRef<(() => ChartSnapshot) | null>(null);
    const [comparisonTarget, setComparisonTarget] = useState<HTMLDivElement | null>(null);
    const [listView, setListView] = useState<'all' | 'watchlist' | 'groups'>('all');
    const stockGroups = useStockGroups();
    const [selectedGroupId, setSelectedGroupId] = useState<string>('');
    const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
    const [editingGroup, setEditingGroup] = useState<StockGroup | 'new' | null>(null);
    const [deletingGroup, setDeletingGroup] = useState<StockGroup | null>(null);
    const marketGroups = stockGroups.groups.filter(group => group.market === market);
    const selectedGroup = marketGroups.find(group => group.id === selectedGroupId) ?? marketGroups[0];
    const groupSymbols = new Set(marketGroups.flatMap(group => group.symbols));
    const dragProps = useStockGroupDrag((source, target) => {
        if (source.symbol && target.symbol) stockGroups.reorderStock(source.groupId, source.symbol, target.symbol, target.after);
        else stockGroups.reorder(market, source.groupId, target.groupId, target.after);
    });
    const watchlistOnly = listView === 'watchlist';
    const changeListView = (view: typeof listView) => {setListView(view); setActive(null);};
    const watchlist = useStockWatchlist();
    const [active, setActive] = useState<StockSymbol | null>(null);
    const [rows, setRows] = useState<DailyPrice[] | null>(null);
    const [directoryState, setDirectoryState] = useState<'loading' | 'ready' | 'error'>(() => symbols.length ? 'ready' : 'loading');
    const [directoryVersion, setDirectoryVersion] = useState(0);
    const [priceError, setPriceError] = useState(false);
    const [loading, setLoading] = useState(false);
    const [refreshVersion, setRefreshVersion] = useState(0);
    const [chartRefreshSeconds, setChartRefreshSeconds] = useState(readChartRefreshSeconds);
    const changeChartRefreshSeconds = (seconds: number) => {
        setChartRefreshSeconds(seconds);
        saveChartRefreshSeconds(seconds);
    };
    const chartVisible = detailTab === 'chart';
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
        let pending = false;
        const refresh = async () => {
            if (pending) return;
            pending = true;
            try {
                const result = await stockAnalysis.prices(activeSymbol, controller.signal);
                if (controller.signal.aborted) return;
                if (!result.length) {setPriceError(true); return;}
                setRows(result);
                setPriceError(false);
            } catch {
                if (!controller.signal.aborted) setPriceError(true);
            } finally {
                pending = false;
                if (!controller.signal.aborted) setLoading(false);
            }
        };
        void refresh();
        return () => {controller.abort();};
    }, [activeSymbol, refreshVersion]);
    useStockPriceRefresh(activeSymbol, chartRefreshSeconds, chartVisible && !loading, result => {
        setRows(result);
        setPriceError(false);
    });

    const changeMarket = (value: string) => {
        if (value === market) return;
        if (value !== 'KR' && value !== 'US' && value !== 'JP') return;
        setSelectedGroupId('');
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
        setDetailTab('chart');
        setActive({...item, name: item.preferred ? `${name} · ${tr('preferredShare')}` : name});
        setRows(null);
        setPriceError(false);
        setLoading(true);
        setRefreshVersion(0);
    };

    const sidebarToggle = <>
        {!sidebarCollapsed && <PanelResizer className="stock-analysis-sidebar-resizer" onWidthChange={updateSidebarWidth}
            onReset={() => updateSidebarWidth(DEFAULT_SIDEBAR_WIDTH)} getWidth={(event, resizer) => {
                const layout = resizer.closest('.workspace-layout-body')!;
                const bounds = layout.getBoundingClientRect();
                const discussionWidth = layout.querySelector('.stock-discussion-container')?.getBoundingClientRect().width ?? 0;
                const maximum = Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, bounds.width - discussionWidth - MIN_CHART_WIDTH));
                return Math.max(MIN_SIDEBAR_WIDTH, Math.min(maximum, event.clientX - bounds.left));
            }}/>}
        <button type="button" className="stock-analysis-sidebar-toggle" onClick={toggleSidebar}
            aria-expanded={!sidebarCollapsed} aria-label={tr(sidebarCollapsed ? 'expandSidebar' : 'collapseSidebar')}
            data-tooltip-disabled="">
            {sidebarCollapsed ? <ChevronRight size={17}/> : <ChevronLeft size={17}/>}
        </button>
    </>;
    const header = <>

        <div className="stock-analysis-title"><ChartCandlestick size={20} aria-hidden="true"/><strong>{tr('title')}</strong></div>
        <div className="stock-analysis-header-actions">
            <StockFinancialCollection market={market} directory={symbols}/>
            <WorkspaceExitButton className="stock-analysis-exit" onClick={onClose}/>
        </div>
    </>;

    const sidebar = <div className="stock-analysis-sidebar">
        <section className="stock-analysis-market-section" aria-label={tr('market')}>
        <StockMarketSelect value={market} onChange={changeMarket}/>
        <button type="button" className="settings-icon-button" aria-label={tr('api.title')} onClick={() => setApiSettingsOpen(true)}><Settings size={16} aria-hidden="true"/></button>
        </section>
        <div className="stock-watchlist-switch stock-list-tabs" role="group" aria-label={tr('listView')}>
            <button type="button" aria-label={tr('allStocks')} aria-pressed={listView === 'all'} onClick={() => changeListView('all')}><LayoutGrid size={17} aria-hidden="true"/></button>
            <button type="button" aria-label={tr('watchlist')} aria-pressed={watchlistOnly} onClick={() => changeListView('watchlist')}>
                <span className="stock-watchlist-tab-icon"><Star size={17} aria-hidden="true"/><span className="stock-watchlist-count">{new Intl.NumberFormat(i18n.resolvedLanguage).format(watchlistCount)}</span></span>
            </button>
            <button type="button" aria-label={tr('groups.tab')} aria-pressed={listView === 'groups'} onClick={() => changeListView('groups')}>
                <span className="stock-watchlist-tab-icon"><FolderOpen size={17} aria-hidden="true"/><span className="stock-watchlist-count">{new Intl.NumberFormat(i18n.resolvedLanguage).format(marketGroups.length)}</span></span>
            </button>
        </div>
        {listView === 'groups' && <div className="stock-group-list">
            <button type="button" className="modal-action-cancel stock-group-create" onClick={() => setEditingGroup('new')}><Plus size={14} aria-hidden="true"/>{tr('groups.create')}</button>
            {marketGroups.map(group => <div className="stock-group-entry" key={group.id}>
                <div className="stock-group-list-row" data-selected={selectedGroup?.id === group.id} {...dragProps({groupId: group.id})}>
                    <button type="button" className="stock-group-toggle" aria-pressed={selectedGroup?.id === group.id}
                        aria-expanded={selectedGroup?.id === group.id && !collapsedGroups[group.id]} aria-controls={`stock-group-members-${group.id}`}
                        onClick={() => {
                            setCollapsedGroups(current => ({...current, [group.id]: selectedGroup?.id === group.id ? !current[group.id] : false}));
                            setSelectedGroupId(group.id);
                            setActive(null);
                        }}><ChevronDown size={14} aria-hidden="true"/><span>{group.name}</span></button>
                    <button type="button" aria-label={tr('groups.editNamed', {name: group.name})} onClick={() => setEditingGroup(group)}><Pencil size={13}/></button>
                    <button type="button" className="stock-group-delete" aria-label={tr('groups.deleteNamed', {name: group.name})} onClick={() => setDeletingGroup(group)}><Trash2 size={13}/></button>
                </div>
                <div className="stock-group-members-collapse" data-expanded={selectedGroup?.id === group.id && !collapsedGroups[group.id]}
                    inert={selectedGroup?.id !== group.id || !!collapsedGroups[group.id]} aria-hidden={selectedGroup?.id !== group.id || !!collapsedGroups[group.id]}
                    id={`stock-group-members-${group.id}`}>
                    <div className="stock-group-members-clip"><ul className="stock-group-members">
                    {group.symbols.map(symbol => {
                        const stock = symbols.find(item => item.symbol === symbol) ?? {symbol, name: symbol};
                        return <li key={symbol} data-selected={activeSymbol === symbol} {...dragProps({groupId: group.id, symbol})}>
                            <button type="button" className="stock-group-member-open" aria-pressed={activeSymbol === symbol} onClick={() => openSymbol(stock)}>
                                <strong>{stock.name}</strong><small>{symbol}</small>
                            </button>
                            <button type="button" className="stock-watchlist-star" aria-pressed={watchlist.contains(market, symbol)}
                                aria-label={tr(watchlist.contains(market, symbol) ? 'removeFromRadar' : 'addToRadar', {name: stock.name})}
                                onClick={() => watchlist.toggle(market, symbol)}><Star size={15} strokeWidth={1.5} aria-hidden="true"/></button>
                            <button type="button" className="stock-group-member-remove" aria-label={tr('groups.removeStock', {name: stock.name})}
                                onClick={() => stockGroups.removeStock(group.id, symbol)}><Trash2 size={13} aria-hidden="true"/></button>
                        </li>;
                    })}
                    {!group.symbols.length && <li className="stock-group-members-empty">{tr('groups.stocks', {count: 0})}</li>}
                    </ul></div>
                </div>
            </div>)}
        </div>}
        {listView !== 'groups' && <label className="stock-analysis-search">
            <Search size={16} aria-hidden="true"/>
            <input type="search" aria-label={tr('search')} placeholder={tr('search')} value={query}
                   onChange={event => setQuery(event.target.value)}/>
        </label>}
        {directoryState === 'loading' && <p role="status">{tr('loading')}</p>}
        {directoryState === 'error' && <>
            <p role="alert">{tr('directoryError')}</p>
            <button className="modal-action-cancel" onClick={() => {
                setDirectoryState('loading');
                setDirectoryVersion(value => value + 1);
            }}>{tr('retry')}</button>
        </>}
        {listView !== 'groups' && directoryState === 'ready' && <>
            <p className="stock-analysis-results" role="status">
                <Trans t={t} i18nKey="stockAnalysis.results" values={{
                    shown: new Intl.NumberFormat(i18n.resolvedLanguage).format(Math.min(filtered.length, VISIBLE_SYMBOLS)),
                    total: new Intl.NumberFormat(i18n.resolvedLanguage).format(filtered.length),
                }} components={{total: <strong className="stock-analysis-result-total"/>, shown: <strong className="stock-analysis-result-shown"/>}}/>
            </p>
            <ul className="stock-analysis-symbols">
                {filtered.slice(0, VISIBLE_SYMBOLS).map(item => <li key={item.symbol}>
                    <button aria-pressed={item.symbol === activeSymbol} onClick={() => openSymbol(item)}>
                        <strong className="stock-symbol-code">{item.symbol}
                            {market === 'KR' && item.exchange && <small className="stock-symbol-exchange" data-exchange={item.exchange === 'KOSPI' ? 'kospi' : 'kosdaq'}
                                    aria-label={tr(item.exchange === 'KOSPI' ? 'indexKospi' : 'indexKosdaq')}>
                                    {tr(item.exchange === 'KOSPI' ? 'exchangeBadgeKospi' : 'exchangeBadgeKosdaq')}
                                </small>}
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
    {editingGroup && <StockGroupDialog group={editingGroup === 'new' ? undefined : editingGroup} market={market} directory={symbols} existingGroups={marketGroups}
        onClose={() => setEditingGroup(null)} onSave={group => {stockGroups.save(group); setSelectedGroupId(group.id); setActive(null);}}/>}
    {deletingGroup && <ConfirmModal title={tr('groups.deleteNamed', {name: deletingGroup.name})}
        description={tr('groups.deleteDescription')} actionLayout="horizontal"
        options={[{value: 'cancel', label: t('common:cancel')}, {value: 'delete', label: t('common:delete'), variant: 'danger'}]}
        onClose={() => setDeletingGroup(null)} onSelect={value => {
            if (value === 'delete') {stockGroups.remove(deletingGroup.id); if (selectedGroupId === deletingGroup.id) setSelectedGroupId('');}
            setDeletingGroup(null);
        }}/>}
    {apiSettingsOpen && <StockApiSettings market={market} onClose={() => setApiSettingsOpen(false)} onSaved={onApiSaved}/>}
    <WorkspaceLayout sidebarWidth={sidebarWidth} sidebarToggle={sidebarToggle} sidebarCollapsed={sidebarCollapsed} className="stock-analysis" label={tr('title')} header={header} sidebar={sidebar}>
        <div className={`stock-analysis-inner${active ? " has-discussion" : ""}`}><main className="stock-analysis-content">
            {!active && (listView === 'groups' && !groupSymbols.size
                ? <div className="stock-watchlist-empty"><strong>{tr('groups.empty')}</strong><p>{tr('groups.emptyHint')}</p>
                    <button type="button" className="modal-action-cancel" onClick={() => setEditingGroup(marketGroups.length === 1 ? marketGroups[0] : 'new')}>{tr(marketGroups.length === 1 ? 'groups.edit' : 'groups.create')}</button></div>
                : <StockSectorMap key={`${market}:${i18n.resolvedLanguage}:${listView === 'groups' ? 'groups' : 'market'}`} market={market} onOpen={openSymbol} directory={symbols} stockGroups={listView === 'groups' ? marketGroups : undefined}/>)}
            {active && <div className="stock-analysis-heading">
                <div className="stock-analysis-chart-title"><button type="button" className="stock-analysis-back" aria-label={tr('sectorMap')} onClick={() => {
                    setActive(null);
                    setRows(null);
                    setLoading(false);
                    setPriceError(false);
                    setRefreshVersion(0);
                }}><ArrowLeft size={16} aria-hidden="true"/></button>
                    <h1>{active.name}</h1><p className="stock-symbol-label">{active.symbol}</p></div>
                <div className="stock-analysis-header-actions">
                <div className="stock-analysis-comparison-action" hidden={detailTab !== 'chart'} ref={setComparisonTarget}/>
                {detailTab === 'chart' && <StockRefreshInterval seconds={chartRefreshSeconds} onChange={changeChartRefreshSeconds}/>}
                {active && <button type="button" className="modal-action-cancel stock-analysis-refresh" aria-label={tr('refresh')} disabled={loading} onClick={() => {
                    setLoading(true);
                    setPriceError(false);
                    setRefreshVersion(value => value + 1);
                }}><RefreshCw size={16} aria-hidden="true"/></button>}
                </div>
            </div>}
            {active && <div className="stock-analysis-detail-tabs"><ModalTabs
                tabs={[{key: 'chart', label: tr('history.chart')}, {key: 'history', label: tr('history.tab')}, {key: 'financials', label: tr('financials.tab')}]}
                activeKey={detailTab} onChange={setDetailTab}/></div>}
            {active && <div className="stock-analysis-detail-panel" hidden={detailTab !== 'chart'}>
            <div className="stock-analysis-chart-stage" aria-busy={loading}>
            {loading && <StockLoadingIndicator title={active.name} overlay={!!rows?.length} iconOnly/>}
            {priceError && <p role="alert">{tr('historyError')}</p>}
            {rows?.length === 0 && !loading && !priceError && <p>{tr('noPrices')}</p>}
            {active && !!rows?.length && <StockPriceChart captureChart={captureChart} key={active.symbol} symbol={active.symbol} name={active.name} rows={rows} market={market} directory={symbols} comparisonTarget={comparisonTarget} autoRefreshEnabled={chartVisible && !loading} refreshSeconds={chartRefreshSeconds} manualRefreshVersion={refreshVersion} label={tr('dailyPrices')}/>}
            </div>
            <footer className="stock-chart-attribution stock-analysis-caption">
                <span>{tr('source')}</span>
                <a href="https://www.tradingview.com/" target="_blank" rel="noreferrer">TradingView Lightweight Charts™ · © 2025 TradingView, Inc.</a>
            </footer></div>}
            {active && <div className="stock-analysis-detail-panel" hidden={detailTab !== 'history'} aria-busy={loading}>
                {loading && <StockLoadingIndicator title={active.name} iconOnly/>}
                {priceError && <p role="alert">{tr('historyError')}</p>}
                {rows?.length === 0 && !loading && !priceError && <p>{tr('noPrices')}</p>}
                {!!rows?.length && <StockHistory key={active.symbol} rows={rows} market={market}/>}
            </div>}
            {active && detailTab === 'financials' && <div className="stock-analysis-detail-panel">
                <StockFinancials key={`${active.symbol}:${refreshVersion}`} symbol={active.symbol} market={market}/>
            </div>}
        </main>
        {active && <StockDiscussionPanel captureChart={detailTab === 'chart' ? captureChart : undefined} key={`${market}:${active.symbol}`} stock={active} market={market} directory={symbols}/>}
        </div>
    </WorkspaceLayout></>;
}
