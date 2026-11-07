import {useEffect, useMemo, useRef, useState} from 'react';
import {CandlestickSeries, createChart, HistogramSeries, LineSeries, type IChartApi, type ISeriesApi} from 'lightweight-charts';
import {Eraser, Pencil, Ruler, Settings, Trash2} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import {stockAnalysis, type DailyPrice, type StockMarket, type StockMemo, type StockMemoDraft} from '../../services/stockAnalysis';

import {Tooltip} from '../common/Tooltip/Tooltip';
import StockMemoDialog from './StockMemoDialog';
import useStockMemoMarkers from './useStockMemoMarkers';
import ChartSettings from './ChartSettings';
import ChartQuoteDetails, {type QuoteDisplayMode} from './ChartQuoteDetails';
import {aggregatePrices, DEFAULT_MOVING_AVERAGES, INTERVALS, MAX_MA_PERIOD, movingAverage, type ChartInterval, type MovingAverage} from './chartData';
import {attachChartRuler, chartDay} from './chartRuler';

interface Props {
    symbol: string;
    name: string;
    rows: DailyPrice[];
    market: StockMarket;
    label: string;
}

const MARKET_COLORS = {KR: {rise: '#e64c52', fall: '#2878da'}, US: {rise: '#30ad69', fall: '#e64c52'}};
const QUOTE_MODE_STORAGE_KEY = 'vyact:stock-analysis:quote-mode';
const MA_STORAGE_KEY = 'vyact:stock-analysis:ma-periods';
const MA_ENABLED_STORAGE_KEY = 'vyact:stock-analysis:ma-enabled';

function readMovingAverages(): MovingAverage[] {
    try {
        const stored: unknown = JSON.parse(localStorage.getItem(MA_STORAGE_KEY) ?? 'null');
        if (Array.isArray(stored)) {
            const entries = stored.map((entry, index) => typeof entry === 'number' ? {
                period: entry, color: DEFAULT_MOVING_AVERAGES[index % DEFAULT_MOVING_AVERAGES.length].color,
            } : entry);
            if (entries.every(entry => entry && Number.isInteger(entry.period) && entry.period >= 1
                && entry.period <= MAX_MA_PERIOD && /^#[0-9a-f]{6}$/i.test(entry.color))) return entries;
        }
    } catch {
        // Use the default periods if storage is unavailable.
    }
    return DEFAULT_MOVING_AVERAGES;
}

export default function StockPriceChart({symbol, name, rows, market, label}: Props) {
    const {t, i18n} = useTranslation('main');
    const container = useRef<HTMLDivElement>(null);
    const ruler = useRef<ReturnType<typeof attachChartRuler> | null>(null);
    const chart = useRef<IChartApi | null>(null);
    const candleSeries = useRef<ISeriesApi<'Candlestick'> | null>(null);
    const averages = useRef<ISeriesApi<'Line'>[]>([]);
    const [interval, setInterval] = useState<ChartInterval>('day');
    const [quoteMode, setQuoteMode] = useState<QuoteDisplayMode>(() => {
        try {return localStorage.getItem(QUOTE_MODE_STORAGE_KEY) === 'header' ? 'header' : 'tooltip';} catch {return 'tooltip';}
    });
    const [hoverPoint, setHoverPoint] = useState<{x: number; y: number}>();
    const [hoveredDay, setHoveredDay] = useState<string>();
    const [movingAverages, setMovingAverages] = useState(readMovingAverages);
    const [maEnabled, setMaEnabled] = useState(() => {
        try {return localStorage.getItem(MA_ENABLED_STORAGE_KEY) === 'true';} catch {return false;}
    });
    useEffect(() => {
        try {localStorage.setItem(MA_ENABLED_STORAGE_KEY, String(maEnabled));} catch { /* Preserve the current chart state. */ }
    }, [maEnabled]);
    const [measuring, setMeasuring] = useState(false);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [memos, setMemos] = useState<StockMemo[]>([]);
    const [memosReady, setMemosReady] = useState(false);
    const [memoLoadFailed, setMemoLoadFailed] = useState(false);
    const [memoRequest, setMemoRequest] = useState(0);
    const [memoDialog, setMemoDialog] = useState<{day: string; editing: boolean}>();
    const locale = i18n.resolvedLanguage;
    const {rise, fall} = MARKET_COLORS[market];
    const bars = useMemo(() => aggregatePrices(rows, interval), [rows, interval]);
    const chartRevision = useMemo(() => ({locale, market, t}), [locale, market, t]);
    const hoveredIndex = bars.findIndex(row => row.day === hoveredDay);
    const quoteIndex = hoveredIndex < 0 ? bars.length - 1 : hoveredIndex;
    const quote = bars[quoteIndex];
    const previousQuote = bars[quoteIndex - 1];

    useEffect(() => {
        const node = container.current;
        if (!node) return;
        const instance = createChart(node, {
            autoSize: true,
            layout: {attributionLogo: false},
            localization: {locale},
            timeScale: {rightOffset: 0, fixLeftEdge: true, fixRightEdge: true},
        });
        chart.current = instance;
        const candles = instance.addSeries(CandlestickSeries, {
            upColor: rise, downColor: fall,
            borderVisible: false, wickUpColor: rise, wickDownColor: fall,
            priceFormat: market === 'KR' ? {type: 'price', precision: 0, minMove: 1} : undefined,
        });
        candleSeries.current = candles;
        const hasVolume = bars.some(row => row.volume !== null);
        if (hasVolume) {
            const volumes = instance.addSeries(HistogramSeries, {
                priceFormat: {type: 'volume'}, priceLineVisible: false, lastValueVisible: false,
            }, 1);
            volumes.setData(bars.map(row => row.volume === null ? {time: row.day} : {
                time: row.day, value: row.volume, color: row.close >= row.open ? rise : fall,
            }));
            const [pricePane, volumePane] = instance.panes();
            pricePane.setStretchFactor(4);
            volumePane.setStretchFactor(1);
        }
        candles.setData(bars.map(({day, open, high, low, close}) => ({time: day, open, high, low, close})));
        instance.subscribeCrosshairMove(({time, point}) => {
            const inside = point && time && point.x >= 0 && point.y >= 0
                && point.x < node.clientWidth && point.y < node.clientHeight;
            setHoveredDay(inside ? chartDay(time) : undefined);
            setHoverPoint(inside ? {
                x: Math.max(8, Math.min(point.x + 18, node.clientWidth - 280)),
                y: Math.max(8, Math.min(point.y + 18, node.clientHeight - 240)),
            } : undefined);
        });
        const percent = new Intl.NumberFormat(locale, {style: 'percent', maximumFractionDigits: 2});
        const number = new Intl.NumberFormat(locale);
        const measurement = attachChartRuler(instance, candles, bars, (change, periods) => {
            const text = t('stockAnalysis.measureResult', {change: `${change < 0 ? '▼' : change > 0 ? '▲' : '•'} ${percent.format(Math.abs(change))}`, periods: number.format(periods)});
            return text;
        }, {rise, fall});
        ruler.current = measurement;
        if (interval === 'day' && bars.length > 1) {
            const cutoff = new Date(bars[bars.length - 1].day);
            cutoff.setUTCFullYear(cutoff.getUTCFullYear() - 1);
            const cutoffDay = cutoff.toISOString().slice(0, 10);
            const first = bars.findIndex(bar => bar.day >= cutoffDay);
            instance.timeScale().setVisibleLogicalRange({from: Math.min(Math.max(0, first), bars.length - 2), to: bars.length - 1});
        } else {
            instance.timeScale().fitContent();
        }
        const applyTheme = () => {
            const style = getComputedStyle(node);
            const color = (name: string) => style.getPropertyValue(name).trim();
            const border = color('--border');
            instance.applyOptions({
                layout: {background: {color: color('--bg')}, textColor: color('--text'),
                    panes: {separatorColor: color('--info'), separatorHoverColor: 'transparent'}},
                grid: {vertLines: {visible: false}, horzLines: {color: border}},
                rightPriceScale: {borderColor: border},
                timeScale: {borderColor: border},
            });
        };
        applyTheme();
        const themeObserver = new MutationObserver(applyTheme);
        themeObserver.observe(document.documentElement, {attributes: true, attributeFilter: ['data-theme']});
        return () => {
            themeObserver.disconnect();
            measurement.dispose();
            instance.remove();
            ruler.current = null;
            chart.current = null;
            candleSeries.current = null;
            averages.current = [];
        };
    }, [bars, interval, market, locale, t, rise, fall]);

    useEffect(() => {
        const instance = chart.current;
        if (!instance) return;
        for (const series of averages.current.splice(movingAverages.length)) instance.removeSeries(series);
        movingAverages.forEach(({period, color}, index) => {
            const series = averages.current[index] ?? instance.addSeries(LineSeries, {
                lineWidth: 1, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false,
            });
            averages.current[index] = series;
            series.applyOptions({color});
            series.setData(maEnabled ? movingAverage(bars, period) : []);
        });
    }, [bars, interval, market, locale, t, maEnabled, movingAverages]);

    useEffect(() => {
        ruler.current?.setEnabled(measuring && !settingsOpen && !memoDialog);
    }, [bars, interval, market, locale, t, measuring, settingsOpen, memoDialog]);

    useEffect(() => {
        const controller = new AbortController();
        stockAnalysis.memos(symbol, controller.signal).then(entries => {
            if (!controller.signal.aborted) {
                setMemos(entries);
                setMemosReady(true);
            }
        }).catch(() => {
            if (!controller.signal.aborted) setMemoLoadFailed(true);
        });
        return () => controller.abort();
    }, [symbol, memoRequest]);

    useEffect(() => {
        const instance = chart.current;
        if (!instance || !memosReady || measuring || settingsOpen || memoDialog) return;
        const days = new Set(bars.map(bar => bar.day));
        const openMemo: Parameters<IChartApi['subscribeDblClick']>[0] = ({time, paneIndex}) => {
            const day = chartDay(time);
            if (paneIndex === 0 && day && days.has(day)) setMemoDialog({day, editing: true});
        };
        instance.subscribeDblClick(openMemo);
        return () => {
            if (chart.current === instance) instance.unsubscribeDblClick(openMemo);
        };
    }, [bars, chartRevision, memosReady, measuring, settingsOpen, memoDialog]);

    const markers = useStockMemoMarkers(chart, candleSeries, bars, interval, memos, chartRevision);
    const selectedMemo = memos.find(memo => memo.day === memoDialog?.day);
    const formatMemoDay = new Intl.DateTimeFormat(locale, {year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short', timeZone: 'UTC'});
    const saveMemo = async (draft: StockMemoDraft) => {
        if (!memoDialog) return;
        const memo = await stockAnalysis.saveMemo(symbol, memoDialog.day, draft);
        setMemos(previous => [...previous.filter(entry => entry.day !== memo.day), memo].sort((a, b) => a.day.localeCompare(b.day)));
        setMemoDialog({day: memo.day, editing: false});
    };

    const saveMovingAverages = (values: MovingAverage[], mode: QuoteDisplayMode) => {
        setQuoteMode(mode);
        setMovingAverages(values);
        setSettingsOpen(false);
        try {
            localStorage.setItem(MA_STORAGE_KEY, JSON.stringify(values));
            localStorage.setItem(QUOTE_MODE_STORAGE_KEY, mode);
        } catch {
            // Keep the settings in memory if storage is unavailable.
        }
    };

    return <section className="stock-price-chart" aria-label={label}>
        <div className="stock-price-chart-toolbar">
            <button type="button" className="modal-action-cancel" aria-pressed={maEnabled}
                    onClick={() => setMaEnabled(value => !value)}>{t('stockAnalysis.movingAverage')}</button>
            {maEnabled && <span className="stock-chart-ma-legend">{movingAverages.map(({period, color}, index) => <span key={index} style={{color}}>{period}</span>)}</span>}
            {INTERVALS.map(value => <button key={value} type="button" className="modal-action-cancel"
                aria-pressed={interval === value} onClick={() => {setHoveredDay(undefined); setInterval(value);}}>
                {t(`stockAnalysis.interval.${value}`)}
            </button>)}
            <Tooltip multiline hoverOnly content={
                <div className="rich-tooltip-content stock-chart-ruler-shortcuts">
                    <strong className="rich-tooltip-title">{t('stockAnalysis.rulerPurpose')}</strong>
                    <div><span>{t('stockAnalysis.rulerClick')}</span></div>
                    <div style={{color: rise}}><kbd>H</kbd><span>{t('stockAnalysis.high')}</span></div>
                    <div style={{color: fall}}><kbd>L</kbd><span>{t('stockAnalysis.low')}</span></div>
                    <div className="stock-chart-ruler-open"><kbd>O</kbd><span>{t('stockAnalysis.open')}</span></div>
                    <small>{t('stockAnalysis.rulerHoldKey')}</small>
                </div>
            }>
                <button type="button" className="modal-action-cancel stock-chart-tool stock-chart-tool-ruler" aria-pressed={measuring}
                        aria-label={t('stockAnalysis.ruler')} onClick={() => setMeasuring(value => !value)}><Ruler size={17}/></button>
            </Tooltip>
            <button type="button" className="modal-action-cancel stock-chart-tool stock-chart-tool-undo" aria-label={t('stockAnalysis.undoMeasure')}
                    title={t('stockAnalysis.undoMeasure')} onClick={() => {ruler.current?.undo();}}><Eraser size={17}/></button>
            <button type="button" className="modal-action-cancel stock-chart-tool stock-chart-tool-clear" aria-label={t('stockAnalysis.clearMeasures')}
                    title={t('stockAnalysis.clearMeasures')} onClick={() => {ruler.current?.clear();}}><Trash2 size={17}/></button>
            <button type="button" className="modal-action-cancel stock-chart-settings-button"
                    onClick={() => setSettingsOpen(true)}><Settings size={16}/>{t('stockAnalysis.chartSettings')}</button>
        </div>
        {quoteMode === 'header' && <ChartQuoteDetails quote={quote} previous={previousQuote} market={market}/>}
        {memoLoadFailed && <div className="stock-memo-error" role="alert">
            {t('stockAnalysis.memoLoadError')}
            <button type="button" className="modal-action-cancel" onClick={() => {
                setMemoLoadFailed(false);
                setMemoRequest(value => value + 1);
            }}>{t('stockAnalysis.retry')}</button>
        </div>}
        <div className="stock-chart-plot">
            <div ref={container} className="stock-price-chart-canvas"/>
            {quoteMode === 'tooltip' && hoverPoint && hoveredIndex >= 0 && !settingsOpen && !memoDialog && <div
                className="stock-chart-quote-tooltip" style={{left: hoverPoint.x, top: hoverPoint.y}}>
                <strong>{name}</strong>
                <ChartQuoteDetails quote={quote} previous={previousQuote} market={market} detailed/>
            </div>}
            <div className="stock-memo-markers">
                {markers.map(({memo, x, y}) => <Tooltip key={memo.day} multiline hoverOnly content={
                    <div className="stock-memo-tooltip"><strong>{formatMemoDay.format(new Date(memo.day))}</strong><span>{memo.title}</span></div>
                }>
                    <button type="button" className="stock-memo-marker" style={{left: x, top: y}}
                            aria-label={`${formatMemoDay.format(new Date(memo.day))} · ${memo.title}`}
                            onClick={() => setMemoDialog({day: memo.day, editing: false})}><Pencil size={12} aria-hidden="true"/></button>
                </Tooltip>)}
            </div>
        </div>
        {memoDialog && <StockMemoDialog key={`${memoDialog.day}:${memoDialog.editing}`} name={name} day={memoDialog.day}
            memo={selectedMemo} editing={memoDialog.editing} onSave={saveMemo}
            onClose={() => setMemoDialog(undefined)} onEdit={() => setMemoDialog({...memoDialog, editing: true})}/>}
        {settingsOpen && <ChartSettings averages={movingAverages} quoteMode={quoteMode} onSave={saveMovingAverages} onClose={() => setSettingsOpen(false)}/>}
    </section>;
}
