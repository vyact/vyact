import type {ChartSnapshotContext, ChartSnapshot} from './chartSnapshot';
import {attachBandFill} from './chartBandFill';
import {OVERLAY_INDICATORS, type OverlayIndicator} from './overlayIndicators';
import IndicatorSettingsDialog from './IndicatorSettingsDialog';
import IndicatorLegends from './IndicatorLegends';
import {readIndicatorSettings, INDICATOR_SETTINGS_KEY} from './indicatorSettings';
import {useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject} from 'react';
import {CandlestickSeries, createChart, HistogramSeries, LineSeries, type IChartApi, type ISeriesApi, type MouseEventParams} from 'lightweight-charts';
import {Eraser, ListX, Pencil, Ruler, Settings, Trash2} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import {stockAnalysis, type DailyPrice, type StockMarket, type StockMemo, type StockMemoDraft, type StockSymbol} from '../../services/stockAnalysis';
import StockComparison from './StockComparison';
import {chartPriceFormat} from './chartPriceFormat';
import CustomSelect from '../CustomSelect/CustomSelect';
import {calculateIndicator, INDICATORS, type Indicator} from './technicalIndicators';

import {Tooltip} from '../common/Tooltip/Tooltip';
import StockMemoDialog from './StockMemoDialog';
import useStockMemoMarkers from './useStockMemoMarkers';
import ChartSettings from './ChartSettings';
import ChartQuoteDetails, {type QuoteDisplayMode} from './ChartQuoteDetails';
import {aggregatePrices, chartActivityField, DEFAULT_MOVING_AVERAGES, INTERVALS, MAX_MA_PERIOD, movingAverage, type ChartInterval, type MovingAverage} from './chartData';
import {attachChartRuler, chartDay} from './chartRuler';

interface Props {
    captureChart: RefObject<(() => ChartSnapshot) | null>;
    autoRefreshEnabled: boolean;
    refreshSeconds: number;
    manualRefreshVersion: number;
    symbol: string;
    name: string;
    rows: DailyPrice[];
    market: StockMarket;
    label: string;
    directory: StockSymbol[];
    comparisonTarget: HTMLDivElement | null;
}

const MARKET_COLORS = {KR: {rise: '#e64c52', fall: '#2878da'}, US: {rise: '#30ad69', fall: '#e64c52'}, JP: {rise: '#e64c52', fall: '#30ad69'}, TW: {rise: '#e64c52', fall: '#30ad69'}, HK: {rise: '#30ad69', fall: '#e64c52'}, CN: {rise: '#e64c52', fall: '#30ad69'}};
const QUOTE_MODE_STORAGE_KEY = 'vyact:stock-analysis:quote-mode';
const MA_STORAGE_KEY = 'vyact:stock-analysis:ma-periods';
const INDICATOR_STORAGE_KEY = 'vyact:stock-analysis:indicators';
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

export default function StockPriceChart({symbol, name, rows, market, label, directory, comparisonTarget, refreshSeconds, manualRefreshVersion, autoRefreshEnabled, captureChart}: Props) {
    const {t, i18n} = useTranslation('main');
    const container = useRef<HTMLDivElement>(null);
    const ruler = useRef<ReturnType<typeof attachChartRuler> | null>(null);
    const chart = useRef<IChartApi | null>(null);
    const [comparisonQuoteTarget, setComparisonQuoteTarget] = useState<HTMLDivElement | null>(null);
    const [chartInstance, setChartInstance] = useState<IChartApi | null>(null);
    const candleSeries = useRef<ISeriesApi<'Candlestick'> | null>(null);
    const averages = useRef<ISeriesApi<'Line'>[]>([]);
    const savedRange = useRef<{from: number; to: number} | null>(null);
    const savedRangeInterval = useRef<ChartInterval>('day');
    const crosshairPosition = useRef<{day: string; price: number} | null>(null);
    const [indicators, setIndicators] = useState<Indicator[]>(() => {
        try {
            const saved: unknown = JSON.parse(localStorage.getItem(INDICATOR_STORAGE_KEY) ?? '[]');
            return Array.isArray(saved) ? INDICATORS.filter(value => saved.includes(value)) : [];
        } catch {return [];}
    });
    const [indicatorSettings, setIndicatorSettings] = useState(readIndicatorSettings);
    const [indicatorSettingsOpen, setIndicatorSettingsOpen] = useState(false);
    const [interval, setInterval] = useState<ChartInterval>('day');
    const [quoteMode, setQuoteMode] = useState<QuoteDisplayMode>(() => {
        try {return localStorage.getItem(QUOTE_MODE_STORAGE_KEY) === 'header' ? 'header' : 'tooltip';} catch {return 'tooltip';}
    });
    const [hoverPoint, setHoverPoint] = useState<{x: number; y: number; chartWidth: number; chartHeight: number}>();
    const [hoveredDay, setHoveredDay] = useState<string>();
    const [quoteTooltipHeight, setQuoteTooltipHeight] = useState(240);
    const [quoteTooltipWidth, setQuoteTooltipWidth] = useState(272);
    useLayoutEffect(() => {
        const tooltip = comparisonQuoteTarget?.parentElement;
        if (quoteMode !== 'tooltip' || !tooltip) return;
        const position = () => {
            setQuoteTooltipHeight(tooltip.offsetHeight);
            setQuoteTooltipWidth(tooltip.offsetWidth);
        };
        position();
        const observer = new ResizeObserver(position);
        observer.observe(tooltip);
        return () => observer.disconnect();
    }, [comparisonQuoteTarget, quoteMode]);
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
    const activityField = chartActivityField(rows);
    const hasActivity = rows.some(row => row[activityField] != null);
    const chartRevision = useMemo(() => ({locale, market, t, indicators, indicatorSettings}), [locale, market, t, indicators, indicatorSettings]);
    const comparisonSnapshot = useRef<ChartSnapshotContext['comparisons']>([]);
    const snapshotSettings = useRef({symbol, name, interval, maEnabled, movingAverages, indicators, indicatorSettings});
    snapshotSettings.current = {symbol, name, interval, maEnabled, movingAverages, indicators, indicatorSettings};
    const latestBars = useRef(bars);
    latestBars.current = bars;
    const updateChartData = useRef<((rows: DailyPrice[]) => void) | null>(null);
    const hoveredIndex = bars.findIndex(row => row.day === hoveredDay);
    const quoteIndex = hoveredIndex < 0 ? bars.length - 1 : hoveredIndex;
    const quote = bars[quoteIndex];
    const previousQuote = bars[quoteIndex - 1];

    useEffect(() => {
        const node = container.current;
        if (!node) return;
        const bars = latestBars.current;
        const dataUpdates: ((rows: DailyPrice[]) => void)[] = [];
        const sameInterval = savedRangeInterval.current === interval;
        const previousCrosshair = sameInterval ? crosshairPosition.current : null;
        if (!sameInterval) crosshairPosition.current = null;
        let restoringCrosshair = true;
        const instance = createChart(node, {
            autoSize: true,
            layout: {attributionLogo: false},
            localization: {locale},
            timeScale: {rightOffset: 0, fixLeftEdge: true, fixRightEdge: true},
        });
        chart.current = instance;
        captureChart.current = () => {
            const settings = snapshotSettings.current;
            const visible = instance.timeScale().getVisibleRange();
            return {canvas: instance.takeScreenshot(true, false), context: {
                symbol: settings.symbol, name: settings.name, interval: settings.interval,
                captured_at: new Date().toISOString(),
                visible_from: visible ? chartDay(visible.from) ?? null : null,
                visible_to: visible ? chartDay(visible.to) ?? null : null,
                moving_averages: settings.maEnabled ? settings.movingAverages.map(value => ({...value})) : [],
                indicators: settings.indicators.map(value => ({name: value, settings: {...settings.indicatorSettings[value]}})),
                comparisons: comparisonSnapshot.current.map(value => ({...value})),
            }};
        };
        setChartInstance(instance);
        const candles = instance.addSeries(CandlestickSeries, {
            upColor: rise, downColor: fall,
            borderVisible: false, wickUpColor: rise, wickDownColor: fall,
            priceFormat: chartPriceFormat(locale, market === 'KR' ? 0 : 2),
        });
        candleSeries.current = candles;
        if (hasActivity) {
            const volumes = instance.addSeries(HistogramSeries, {
                title: t(activityField === 'tradingValue' ? 'stockAnalysis.history.tradingValue' : 'stockAnalysis.volume'),
                priceFormat: {type: 'volume'}, priceLineVisible: false, lastValueVisible: false,
            }, 1);
            const updateVolumes = (rows: DailyPrice[]) => volumes.setData(rows.map(row => {
                const value = row[activityField];
                return value == null ? {time: row.day} : {
                    time: row.day, value, color: row.close >= row.open ? rise : fall,
                };
            }));
            updateVolumes(bars);
            dataUpdates.push(updateVolumes);
            const [pricePane, volumePane] = instance.panes();
            pricePane.setStretchFactor(4);
            volumePane.setStretchFactor(1);
        }
        const updateCandles = (rows: DailyPrice[]) => candles.setData(rows.map(({day, open, high, low, close}) => ({time: day, open, high, low, close})));
        updateCandles(bars);
        dataUpdates.push(updateCandles);
        let nextIndicatorPane = hasActivity ? 2 : 1;
        indicators.forEach(kind => {
            const overlay = OVERLAY_INDICATORS.includes(kind as OverlayIndicator);
            const pane = overlay ? 0 : nextIndicatorPane++;
            const indicatorSeries: (ISeriesApi<'Line'> | ISeriesApi<'Histogram'>)[] = [];
            let updateBand: ReturnType<typeof attachBandFill> | undefined;
            const updateIndicator = (bars: DailyPrice[]) => {
                const lines = calculateIndicator(kind, bars, indicatorSettings);
                    const times = bars.map(row => row.day);
                    while (times.length < Math.max(...lines.map(line => line.values.length)) && times.length) {
                        const date = new Date(times[times.length - 1]);
                        if (interval === 'month') date.setUTCMonth(date.getUTCMonth() + 1, 1);
                        else if (interval === 'year') date.setUTCFullYear(date.getUTCFullYear() + 1, 0, 1);
                        else {
                            date.setUTCDate(date.getUTCDate() + (interval === 'week' ? 7 : 1));
                            if (interval === 'day') while ([0, 6].includes(date.getUTCDay())) date.setUTCDate(date.getUTCDate() + 1);
                        }
                        times.push(date.toISOString().slice(0, 10));
                    }
                lines.forEach((definition, definitionIndex) => {
                    const options = {
                        color: definition.color, priceLineVisible: false, lastValueVisible: false,
                        title: '',
                        crosshairMarkerVisible: !overlay,
                        priceFormat: {type: 'custom' as const, minMove: .01, formatter: (value: number) => new Intl.NumberFormat(locale, {notation: 'compact', maximumFractionDigits: 2}).format(value)},
                    };
                    const data = times.map((time, index) => definition.values[index] == null ? {time} : {
                        time, value: definition.values[index]!,
                        ...(definition.histogram ? {color: definition.values[index]! >= 0 ? rise : fall} : {}),
                    });
                    const existing = indicatorSeries[definitionIndex];
                    if (existing) {existing.setData(data); return;}
                    if (definition.histogram) {
                        const histogram = instance.addSeries(HistogramSeries, options, pane);
                        histogram.setData(data);
                        indicatorSeries.push(histogram);
                    }
                    else {
                        const line = instance.addSeries(LineSeries, {...options, lineWidth: 1, ...(kind === 'bollinger' && definition === lines[0] ? {lineStyle: 2} : {}), ...(kind === 'sar' ? {lineVisible: false, pointMarkersVisible: true, pointMarkersRadius: 2} : {})}, pane);
                        line.setData(data);
                        indicatorSeries.push(line);
                        const settings = indicatorSettings[kind];
                        const levels = kind === 'rsi' || kind.includes('Stochastic') ? [settings.lower, settings.upper] : kind === 'adx' ? [settings.threshold] : [];
                        if (!overlay) line.priceScale().applyOptions({scaleMargins: {top: .25, bottom: .1}});
                        if (definition === lines[0]) levels.forEach(price => line.createPriceLine({price, color: '#88888880', lineWidth: 1, lineStyle: 2, axisLabelVisible: false}));
                    }
                });
                if (kind === 'bollinger' || kind === 'ichimoku') {
                    const upper = lines[kind === 'bollinger' ? 1 : 2].values;
                    const lower = lines[kind === 'bollinger' ? 2 : 3].values;
                    const points = times.map((time, index) => ({time, upper: upper[index] ?? null, lower: lower[index] ?? null}));
                    if (updateBand) updateBand(points);
                    else updateBand = attachBandFill(instance, candles, points,
                        kind === 'bollinger' ? {positive: 'rgba(125,159,230,.10)', negative: 'rgba(125,159,230,.10)'} :
                            {positive: 'rgba(69,181,142,.14)', negative: 'rgba(215,121,146,.14)'});
                }
            };
            updateIndicator(bars);
            dataUpdates.push(updateIndicator);
            if (!overlay) instance.panes()[pane]?.setStretchFactor(1);
            const element = instance.panes()[pane]?.getHTMLElement();
            if (element) element.style.position = 'relative';
        });
        instance.panes()[0].setStretchFactor(4);
        const initialPaneFactors = instance.panes().map(pane => pane.getStretchFactor());
        const resetPaneHeights = (event: MouseEvent) => {
            if (!(event.target instanceof Element)) return;
            const separator = event.target.closest('td[colspan="3"] [style*="cursor: row-resize"]');
            if (!separator || !node.contains(separator)) return;
            event.preventDefault();
            event.stopPropagation();
            instance.panes().forEach((pane, index) => pane.setStretchFactor(initialPaneFactors[index]));
        };
        node.addEventListener('dblclick', resetPaneHeights, true);
        const onCrosshairMove = ({time, point}: MouseEventParams) => {
            if (restoringCrosshair) return;
            const inside = point && time && point.x >= 0 && point.y >= 0
                && point.x < node.clientWidth && point.y < node.clientHeight;
            const day = inside ? chartDay(time) : undefined;
            const price = inside ? candles.coordinateToPrice(point.y) : null;
            crosshairPosition.current = day && price !== null ? {day, price} : null;
            setHoveredDay(inside ? chartDay(time) : undefined);
            setHoverPoint(inside ? {
                x: point.x,
                y: point.y,
                chartWidth: node.clientWidth,
                chartHeight: node.clientHeight,
            } : undefined);
        };
        instance.subscribeCrosshairMove(onCrosshairMove);
        const percent = new Intl.NumberFormat(locale, {style: 'percent', maximumFractionDigits: 2});
        const number = new Intl.NumberFormat(locale);
        const measurement = attachChartRuler(instance, candles, bars, (change, periods) => {
            const text = t('stockAnalysis.measureResult', {change: `${change < 0 ? '▼' : change > 0 ? '▲' : '•'} ${percent.format(Math.abs(change))}`, periods: number.format(periods)});
            return text;
        }, {rise, fall});
        ruler.current = measurement;
        updateChartData.current = rows => {
            const position = crosshairPosition.current;
            restoringCrosshair = true;
            try {
                dataUpdates.forEach(update => update(rows));
                measurement.setRows(rows);
            } finally {restoringCrosshair = false;}
            if (position) instance.setCrosshairPosition(position.price, position.day, candles);
        };
        if (sameInterval && savedRange.current) {
            instance.timeScale().setVisibleLogicalRange(savedRange.current);
            savedRange.current = null;
        } else if (interval === 'day' && bars.length > 1) {
            const cutoff = new Date(bars[bars.length - 1].day);
            cutoff.setUTCFullYear(cutoff.getUTCFullYear() - 1);
            const cutoffDay = cutoff.toISOString().slice(0, 10);
            const first = bars.findIndex(bar => bar.day >= cutoffDay);
            instance.timeScale().setVisibleLogicalRange({from: Math.min(Math.max(0, first), bars.length - 2), to: bars.length - 1});
        } else {
            instance.timeScale().fitContent();
        }
        savedRange.current = null;
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
        const restoreCrosshairFrame = requestAnimationFrame(() => {
            restoringCrosshair = false;
            if (previousCrosshair && crosshairPosition.current === previousCrosshair) {
                instance.setCrosshairPosition(previousCrosshair.price, previousCrosshair.day, candles);
            }
        });
        const themeObserver = new MutationObserver(applyTheme);
        themeObserver.observe(document.documentElement, {attributes: true, attributeFilter: ['data-theme']});
        return () => {
            cancelAnimationFrame(restoreCrosshairFrame);
            instance.unsubscribeCrosshairMove(onCrosshairMove);
            node.removeEventListener('dblclick', resetPaneHeights, true);
            themeObserver.disconnect();
            measurement.dispose();
            savedRange.current = instance.timeScale().getVisibleLogicalRange();
            savedRangeInterval.current = interval;
            instance.remove();
            updateChartData.current = null;
            ruler.current = null;
            chart.current = null;
            captureChart.current = null;
            candleSeries.current = null;
            averages.current = [];
        };
    }, [interval, market, locale, t, rise, fall, indicators, indicatorSettings, captureChart, activityField, hasActivity]);

    useEffect(() => {updateChartData.current?.(bars);}, [bars]);

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
    }, [bars, interval, market, locale, t, maEnabled, movingAverages, indicators, indicatorSettings]);

    useEffect(() => {
        ruler.current?.setEnabled(measuring && !settingsOpen && !indicatorSettingsOpen && !memoDialog);
    }, [bars, interval, market, locale, t, measuring, settingsOpen, memoDialog, indicators, indicatorSettings, indicatorSettingsOpen]);

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
        if (!instance || !memosReady || measuring || settingsOpen || indicatorSettingsOpen || memoDialog) return;
        const days = new Set(bars.map(bar => bar.day));
        const openMemo: Parameters<IChartApi['subscribeDblClick']>[0] = ({time, paneIndex}) => {
            const day = chartDay(time);
            if (paneIndex === 0 && day && days.has(day)) setMemoDialog({day, editing: true});
        };
        instance.subscribeDblClick(openMemo);
        return () => {
            if (chart.current === instance) instance.unsubscribeDblClick(openMemo);
        };
    }, [bars, chartRevision, memosReady, measuring, settingsOpen, memoDialog, indicators, indicatorSettings, indicatorSettingsOpen]);

    const markers = useStockMemoMarkers(chart, candleSeries, bars, interval, memos, chartRevision);
    const selectedMemo = memos.find(memo => memo.day === memoDialog?.day);
    const formatMemoDay = new Intl.DateTimeFormat(locale, {year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short', timeZone: 'UTC'});
    const saveMemo = async (draft: StockMemoDraft) => {
        if (!memoDialog) return;
        const memo = await stockAnalysis.saveMemo(symbol, memoDialog.day, draft);
        setMemos(previous => [...previous.filter(entry => entry.day !== memo.day), memo].sort((a, b) => a.day.localeCompare(b.day)));
        setMemoDialog(selectedMemo ? {day: memo.day, editing: false} : undefined);
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
        <StockComparison snapshotComparisons={comparisonSnapshot} manualRefreshVersion={manualRefreshVersion} refreshSeconds={refreshSeconds} autoRefreshEnabled={autoRefreshEnabled} quoteMode={quoteMode} market={market} chart={chart} bars={bars} interval={interval} revision={chartInstance} directory={directory} hoveredDay={hoveredDay} actionTarget={comparisonTarget} quoteTarget={comparisonQuoteTarget}
            onLayoutChange={() => {setHoveredDay(undefined); setHoverPoint(undefined);}}>
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
            <CustomSelect showGroupLabels dropdownClassName="stock-indicator-dropdown" className="stock-indicator-select" value="" selectedValues={indicators}
                placeholder={t('stockAnalysis.indicatorSelect', {count: indicators.length})}
                ariaLabel={t('stockAnalysis.indicatorSelect', {count: indicators.length})}
                options={[...OVERLAY_INDICATORS, ...INDICATORS.filter(value => !OVERLAY_INDICATORS.includes(value as OverlayIndicator))].map(value => ({value, label: t(`stockAnalysis.indicators.${value}`), group: t(OVERLAY_INDICATORS.includes(value as OverlayIndicator) ? 'stockAnalysis.overlayGroup' : 'stockAnalysis.panelGroup')}))}
                footer={closeDropdown => <div className="stock-indicator-menu-actions">
                    <button type="button" className="modal-action-cancel" aria-label={t('stockAnalysis.indicatorClearAll')} disabled={!indicators.length} onClick={() => {
                        closeDropdown();
                        savedRange.current = chart.current?.timeScale().getVisibleLogicalRange() ?? null;
                        setIndicators([]);
                        try {localStorage.setItem(INDICATOR_STORAGE_KEY, '[]');} catch { /* Retain session selection. */ }
                    }}><ListX size={16} aria-hidden="true"/></button>
                    <button type="button" className="modal-action-cancel" aria-label={t('stockAnalysis.indicatorSettings')} onClick={() => {closeDropdown(); setIndicatorSettingsOpen(true);}}><Settings size={16} aria-hidden="true"/></button>
                </div>}
                closeOnSelect={false} portal onChange={value => {
                    if (!INDICATORS.includes(value as Indicator)) return;
                    savedRange.current = chart.current?.timeScale().getVisibleLogicalRange() ?? null;
                    const next = indicators.includes(value as Indicator) ? indicators.filter(item => item !== value) : [...indicators, value as Indicator];
                    setIndicators(next);
                    try {localStorage.setItem(INDICATOR_STORAGE_KEY, JSON.stringify(next));} catch { /* Retain session selection. */ }
                }}/>
            <button type="button" className="modal-action-cancel stock-chart-settings-button"
                    onClick={() => setSettingsOpen(true)}><Settings size={16}/>{t('stockAnalysis.chartSettings')}</button>
        </StockComparison>
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
                className="stock-chart-quote-tooltip stock-chart-quote-tooltip-with-comparisons" style={{left: Math.max(8,
                    hoverPoint.x + 40 + quoteTooltipWidth <= hoverPoint.chartWidth - 8
                        ? hoverPoint.x + 40 : hoverPoint.x - quoteTooltipWidth - 40,
                ), top: Math.max(8, Math.min(
                    (hoverPoint.y - quoteTooltipHeight - 18 >= 8 ? hoverPoint.y - quoteTooltipHeight - 18 : hoverPoint.y + 18) - 50,
                    hoverPoint.chartHeight - quoteTooltipHeight - 8,
                ))}}>
                <div className="stock-chart-quote-heading">
                    <strong>{name}</strong><time dateTime={quote.day}>{quote.day}</time>
                </div>
                <ChartQuoteDetails quote={quote} previous={previousQuote} market={market} detailed/>
                <div ref={setComparisonQuoteTarget}/>
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
            onDelete={async () => {
                const day = memoDialog.day;
                await stockAnalysis.deleteMemo(symbol, day);
                setMemos(previous => previous.filter(memo => memo.day !== day));
                setMemoDialog(undefined);
            }}
            onClose={() => setMemoDialog(undefined)} onEdit={() => setMemoDialog({...memoDialog, editing: true})}/>}
        <IndicatorLegends chart={chartInstance} indicators={indicators} settings={indicatorSettings} bars={bars} hoveredDay={hoveredDay}/>
        {indicatorSettingsOpen && <IndicatorSettingsDialog settings={indicatorSettings} onClose={() => setIndicatorSettingsOpen(false)} onSave={settings => {
            savedRange.current = chart.current?.timeScale().getVisibleLogicalRange() ?? null;
            setIndicatorSettings(settings);
            setIndicatorSettingsOpen(false);
            try {localStorage.setItem(INDICATOR_SETTINGS_KEY, JSON.stringify(settings));} catch { /* Retain session settings. */ }
        }}/>}
        {settingsOpen && <ChartSettings averages={movingAverages} quoteMode={quoteMode} onSave={saveMovingAverages} onClose={() => setSettingsOpen(false)}/>}
    </section>;
}
