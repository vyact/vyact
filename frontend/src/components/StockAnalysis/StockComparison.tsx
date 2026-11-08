import {Tooltip} from '../common/Tooltip/Tooltip';
import ModalTabs from '../common/ModalTabs/ModalTabs';
import {stockSnapshotCache} from '../../services/stockSnapshotCache';
import {MARKET_INDEX_LABELS} from './marketIndexLabels';
import {useEffect, useRef, useState, type ReactNode, type RefObject} from 'react';
import {LineSeries, type IChartApi} from 'lightweight-charts';
import {createPortal} from 'react-dom';
import {ArrowLeft, ArrowRight, CircleHelp, Plus, RotateCcw, X} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import {stockAnalysis, type DailyPrice, type StockSymbol, type StockMarket} from '../../services/stockAnalysis';
import ModalOverlay from '../common/ModalOverlay/ModalOverlay';
import ModalCloseButton from '../common/ModalOverlay/ModalCloseButton';
import {comparisonDailyChange, comparisonPoints} from './comparisonData';
import type {ChartInterval} from './chartData';
import './StockComparison.css';

const comparisonColor = () => getComputedStyle(document.documentElement).getPropertyValue('--stock-comparison-color').trim();

type Comparison = {symbol: string; name: string; rows: DailyPrice[]; shift: number};

export default function StockComparison({chart, bars, interval, revision, directory, hoveredDay, children, actionTarget, quoteTarget, market, onLayoutChange, quoteMode}: {
    onLayoutChange: () => void;
    quoteMode: 'header' | 'tooltip';
    market: StockMarket;
    actionTarget: HTMLDivElement | null;
    quoteTarget: HTMLDivElement | null;
    children: ReactNode;
    chart: RefObject<IChartApi | null>;
    bars: DailyPrice[];
    interval: ChartInterval;
    revision: unknown;
    directory: StockSymbol[];
    hoveredDay?: string;
}) {
    const {t, i18n} = useTranslation(['main', 'common']);
    const tr = (key: string) => t(`stockAnalysis.${key}`);
    const [items, setItems] = useState<Comparison[]>([]);
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const [searchMarket, setSearchMarket] = useState<StockMarket>(market);
    const [remoteDirectory, setRemoteDirectory] = useState<{market: StockMarket; language: string; rows: StockSymbol[]}>();
    const [directoryError, setDirectoryError] = useState(false);
    const [directoryRetry, setDirectoryRetry] = useState(0);
    const language = i18n.resolvedLanguage ?? i18n.language;
    const cachedDirectory = stockSnapshotCache.readSymbols(searchMarket, language);
    const searchDirectory = searchMarket === market ? directory : remoteDirectory?.market === searchMarket && remoteDirectory.language === language ? remoteDirectory.rows : cachedDirectory;
    useEffect(() => {
        if (!open || searchMarket === market) return;
        const controller = new AbortController();
        stockAnalysis.symbols(searchMarket, controller.signal, language).then(rows => {
            if (controller.signal.aborted) return;
            stockSnapshotCache.writeSymbols(searchMarket, rows, language);
            setRemoteDirectory({market: searchMarket, language, rows});
            setDirectoryError(false);
        }).catch(() => {if (!controller.signal.aborted) setDirectoryError(true);});
        return () => controller.abort();
    }, [open, searchMarket, market, language, directoryRetry]);
    const [draftShifts, setDraftShifts] = useState<Record<string, string>>({});
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(false);
    const request = useRef<AbortController | null>(null);
    useEffect(() => () => {request.current?.abort();}, []);
    useEffect(() => {
        const instance = chart.current;
        if (!instance) return;
        const range = instance.timeScale().getVisibleRange();
        let latestDay = bars[bars.length - 1]?.day;
        const series = items.map(item => {
            const line = instance.addSeries(LineSeries, {
                priceScaleId: 'left', color: comparisonColor(), lineWidth: 2,
                priceLineVisible: false, lastValueVisible: false,
            });
            const points = comparisonPoints(bars, item.rows, interval, item.shift);
            const lastDay = points[points.length - 1]?.time;
            if (lastDay && (!latestDay || lastDay > latestDay)) latestDay = lastDay;
            line.setData(points);
            return line;
        });
        const themeObserver = new MutationObserver(() => {
            const color = comparisonColor();
            series.forEach(line => line.applyOptions({color}));
        });
        themeObserver.observe(document.documentElement, {attributes: true, attributeFilter: ['data-theme']});
        // Axis visibility is a chart-wide layout option. Updating only pane 0's
        // scale leaves volume/indicator axis widgets missing during resize.
        instance.applyOptions({leftPriceScale: {visible: items.length > 0, borderVisible: false}});
        const restoreRange = () => {
            if (chart.current !== instance) return;
            if (range) instance.timeScale().setVisibleRange({
                from: range.from,
                to: latestDay && String(range.to) >= bars[bars.length - 1]?.day && latestDay > String(range.to) ? latestDay : range.to,
            });
            instance.clearCrosshairPosition();
        };
        restoreRange();
        // Showing the left axis changes the plot width on the next layout pass.
        // Restore dates after that resize as well so the latest candles stay visible.
        const restoreFrame = requestAnimationFrame(restoreRange);
        return () => {
            cancelAnimationFrame(restoreFrame);
            themeObserver.disconnect();
            // The parent disposes and replaces this chart when its interval changes.
            // Only remove series while their owning chart is still alive.
            // eslint-disable-next-line react-hooks/exhaustive-deps
            if (chart.current === instance) series.forEach(line => instance.removeSeries(line));
        };
    }, [chart, bars, interval, revision, items]);

    const add = async (symbol: StockSymbol) => {
        if (loading || items.some(item => item.symbol === symbol.symbol)) return;
        const controller = new AbortController();
        request.current = controller;
        setLoading(true);
        setError(false);
        try {
            const rows = await stockAnalysis.prices(symbol.symbol, controller.signal, false);
            if (controller.signal.aborted) return;
            if (!rows.length) {setError(true); return;}
            setItems([{...symbol, rows, shift: 0}]);
            onLayoutChange();
            setDraftShifts({});
            setOpen(false);
            setQuery('');
        } catch {
            if (!controller.signal.aborted) setError(true);
        } finally {
            if (!controller.signal.aborted) setLoading(false);
        }
    };
    const changeShift = (symbol: string, shift: number) => {
        if (Number.isInteger(shift) && Math.abs(shift) < bars.length) {
            onLayoutChange();
            setItems(previous => previous.map(item => item.symbol === symbol ? {...item, shift} : item));
        }
    };
    const indexSymbols = MARKET_INDEX_LABELS[searchMarket].map(item => ({symbol: item.symbol, name: tr(item.key)}));
    const candidates = [...new Map([...indexSymbols, ...(searchDirectory ?? [])].map(item => [item.symbol, item])).values()];
    const matches = candidates.filter(item => !items.some(selected => selected.symbol === item.symbol)
        && `${item.symbol} ${item.name}`.toLowerCase().includes(query.trim().toLowerCase()));
    const number = new Intl.NumberFormat(i18n.resolvedLanguage, {maximumFractionDigits: 2});
    const percent = new Intl.NumberFormat(i18n.resolvedLanguage, {minimumFractionDigits: 2, maximumFractionDigits: 2, signDisplay: 'exceptZero'});
    const date = new Intl.DateTimeFormat(i18n.resolvedLanguage, {dateStyle: 'medium', timeZone: 'UTC'});

    const renderComparisonQuote = (item: Comparison, inline = false) => {
                const day = hoveredDay ?? bars[bars.length - 1]?.day;
                const point = comparisonPoints(bars, item.rows, interval, item.shift).find(point => point.time === day);
                const change = point ? comparisonDailyChange(item.rows, point.sourceDay) : null;
                return <div className={`stock-comparison-quote${inline ? ' stock-comparison-quote-inline' : ''}`} data-market={market} key={item.symbol}>
                    {!inline && <strong className="stock-comparison-name">{item.name}</strong>}
                    {point ? <><time dateTime={point.sourceDay}>{date.format(new Date(point.sourceDay))}</time><span>{number.format(point.value)}
                        {change !== null && <span className="stock-quote-change" data-direction={change > 0 ? 'up' : change < 0 ? 'down' : 'flat'}>({percent.format(change)}%)</span>}
                    </span></> : <span>{tr('compareNoPoint')}</span>}
                </div>;
    };

    return <>
        <div className="stock-price-chart-toolbar">
            {children}
        </div>
        {actionTarget && createPortal(<button type="button" className="modal-action-cancel" disabled={loading}
            onClick={() => {setError(false); setOpen(true);}}><Plus size={14} aria-hidden="true"/>{tr('compareAdd')}</button>, actionTarget)}
        {!!items.length && <div className="stock-comparison">
        {items.map(item => {
            const draft = draftShifts[item.symbol] ?? String(item.shift);
            const value = Number(draft);
            const valid = draft.trim() !== '' && Number.isInteger(value) && Math.abs(value) < bars.length;
            const setDraft = (value: string) => setDraftShifts(previous => ({...previous, [item.symbol]: value}));
            return <div className="stock-comparison-row" key={item.symbol}>
                <Tooltip multiline size="medium" content={<div className="rich-tooltip-content stock-comparison-help">
                    <strong className="rich-tooltip-title">{tr('compareHelpTitle')}</strong>
                    <p className="rich-tooltip-description">{tr('compareHelpChart')}</p>
                    <ul>{['compareHelpShift', 'compareHelpPositive', 'compareHelpUnit'].map(key => <li key={key}>{tr(key)}</li>)}</ul>
                </div>}>
                    <button type="button" className="stock-comparison-help-button" aria-label={tr('compareHelpTitle')}><CircleHelp size={14} aria-hidden="true"/></button>
                </Tooltip>
                <span className="stock-comparison-dot"/>
                <strong>{item.name}</strong>
                <span className="stock-comparison-shift">
                    <button type="button" aria-label={tr('compareEarlier')} disabled={valid && value <= 1 - bars.length}
                        onClick={() => setDraft(String((valid ? value : 0) - 1))}><ArrowLeft size={13}/></button>
                    <input type="text" inputMode="text" value={draft} aria-invalid={!valid}
                        aria-label={tr('compareShift')} onChange={event => {if (/^-?\d*$/.test(event.target.value)) setDraft(event.target.value);}}
                        onKeyDown={event => {if (event.key === 'Enter' && valid) {event.preventDefault(); changeShift(item.symbol, value); setDraft(String(value));}}}/>
                    <button type="button" aria-label={tr('compareLater')} disabled={valid && value >= bars.length - 1}
                        onClick={() => setDraft(String((valid ? value : 0) + 1))}><ArrowRight size={13}/></button>
                </span>
                <button type="button" className="stock-comparison-apply" disabled={!valid || value === item.shift} onClick={() => {changeShift(item.symbol, value); setDraft(String(value));}}>{tr('compareApply')}</button>
                <button type="button" className="stock-comparison-reset" aria-label={tr('compareReset')} onClick={() => {changeShift(item.symbol, 0); setDraft('0');}}><RotateCcw size={14} aria-hidden="true"/></button>
                {quoteMode === 'header' && renderComparisonQuote(item, true)}
                <button type="button" className="stock-comparison-remove" aria-label={t('common:remove')}
                    onClick={() => {setItems(previous => previous.filter(entry => entry.symbol !== item.symbol)); setDraftShifts(previous => {const next = {...previous}; delete next[item.symbol]; return next;});}}><X size={14}/></button>
            </div>;
        })}
        </div>}
        {quoteMode === 'tooltip' && quoteTarget && createPortal(<div className="stock-comparison-quotes">
            {items.map(item => renderComparisonQuote(item))}
        </div>, quoteTarget)}
        {open && <ModalOverlay onClose={loading ? undefined : () => setOpen(false)} closeOnBackdrop captureEscape aria-labelledby="stock-comparison-title">
            <div className="stock-comparison-dialog">
                <header><h2 id="stock-comparison-title">{tr('compareAdd')}</h2><ModalCloseButton disabled={loading} onClick={() => setOpen(false)}/></header>
                <ModalTabs tabs={(['KR', 'US'] as const).map(key => ({key, label: tr(key)}))} activeKey={searchMarket}
                    disabled={loading} onChange={value => {setSearchMarket(value); setQuery(''); setDirectoryError(false);}}/>
                <input type="search" aria-label={tr('search')} placeholder={tr('search')} value={query} disabled={loading}
                    onChange={event => setQuery(event.target.value)}/>
                <div className="stock-comparison-results">
                <ul>{matches.slice(0, 50).map(item => <li key={item.symbol}>
                    <button type="button" disabled={loading} onClick={() => {void add(item);}}><strong>{item.name}</strong><span>{item.symbol}</span><Plus size={14}/></button>
                </li>)}</ul>
                {!matches.length && <p className="stock-comparison-empty">{searchDirectory || directoryError ? tr('radarNoResults') : tr('loading')}</p>}
                </div>
                <div className="stock-comparison-status">
                    {(loading || (!searchDirectory && !directoryError)) && <p role="status">{tr('loading')}</p>}
                    {directoryError && <div className="stock-comparison-directory-error"><p role="alert">{tr('directoryError')}</p><button type="button" className="modal-action-cancel" onClick={() => {setDirectoryError(false); setDirectoryRetry(value => value + 1);}}>{tr('retry')}</button></div>}
                    {error && <p role="alert">{tr('historyError')}</p>}
                </div>
            </div>
        </ModalOverlay>}
    </>;
}
