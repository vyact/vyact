import {CircleHelp} from 'lucide-react';
import {Tooltip} from '../common/Tooltip/Tooltip';
import {OVERLAY_INDICATORS, type OverlayIndicator} from './overlayIndicators';
import {createPortal} from 'react-dom';
import {useTranslation} from 'react-i18next';
import type {IChartApi} from 'lightweight-charts';
import type {DailyPrice} from '../../services/stockAnalysis';
import {calculateIndicator, type Indicator} from './technicalIndicators';
import type {IndicatorSettings} from './indicatorSettings';
import './IndicatorSettings.css';

const INDICATOR_LINE_KEYS: Record<string, string> = {Tenkan: 'conversion', Kijun: 'base', 'Senkou A': 'spanA', 'Senkou B': 'spanB', Chikou: 'lagging', M: 'middle', U: 'upper', L: 'lower'};

export default function IndicatorLegends({chart, indicators, settings, bars, hoveredDay}: {
    chart: IChartApi | null; indicators: Indicator[]; settings: IndicatorSettings; bars: DailyPrice[]; hoveredDay?: string;
}) {
    const {t, i18n} = useTranslation('main');
    if (!chart) return null;
    const number = new Intl.NumberFormat(i18n.resolvedLanguage, {maximumFractionDigits: 2, notation: 'compact'});
    const hoverIndex = bars.findIndex(row => row.day === hoveredDay);
    const index = hoveredDay ? hoverIndex : bars.length - 1;
    const firstPane = bars.some(row => row.volume !== null) ? 2 : 1;
    const panels = indicators.filter(kind => !OVERLAY_INDICATORS.includes(kind as OverlayIndicator));
    const overlays = indicators.filter(kind => OVERLAY_INDICATORS.includes(kind as OverlayIndicator));
    return <>{indicators.map(kind => {
        const overlayIndex = overlays.indexOf(kind);
        const pane = chart.panes()[overlayIndex >= 0 ? 0 : firstPane + panels.indexOf(kind)]?.getHTMLElement();
        const target = pane?.children[1]?.firstElementChild;
        if (!target) return null;
        const lines = calculateIndicator(kind, bars, settings);
        return createPortal(<div className="stock-indicator-legend" style={overlayIndex >= 0 ? {top: 6 + overlayIndex * 24} : undefined}>
            <Tooltip multiline size="medium" placement="below" content={<div className="rich-tooltip-content stock-indicator-help">
                <strong className="rich-tooltip-title">{t(`stockAnalysis.indicators.${kind}`)}</strong>
                <p className="rich-tooltip-description">{t(`stockAnalysis.indicatorHelp.${kind}.description`)}</p>
                <strong className="stock-indicator-help-heading">{t('stockAnalysis.indicatorHelp.reading')}</strong>
                {t(`stockAnalysis.indicatorHelp.${kind}.reading`).includes('\n') ? <ul className="stock-indicator-help-list">
                    {t(`stockAnalysis.indicatorHelp.${kind}.reading`).split('\n').map(text => <li key={text}>{text}</li>)}
                </ul> : <>
                    <p className="rich-tooltip-description">{t(`stockAnalysis.indicatorHelp.${kind}.reading`)}</p>
                    <div className="rich-tooltip-callout">{t('stockAnalysis.indicatorHelp.caution')}</div>
                </>}
            </div>}>
                <button type="button" className="stock-indicator-help-button" aria-label={t('stockAnalysis.indicatorHelp.label', {name: t(`stockAnalysis.indicators.${kind}`)})}
                    onPointerDown={event => event.stopPropagation()}><CircleHelp size={14} aria-hidden="true"/></button>
            </Tooltip>
            <strong>{t(`stockAnalysis.indicators.${kind}`)}</strong>
            {lines.map(line => <span key={line.label} style={{color: line.color}}>
                {line.label.startsWith('Signal') ? `${t('stockAnalysis.indicatorLines.signal')} (${settings[kind].signal})` : line.label === 'Histogram' ? t('stockAnalysis.indicatorHistogram') : INDICATOR_LINE_KEYS[line.label] ? t(`stockAnalysis.indicatorLines.${INDICATOR_LINE_KEYS[line.label]}`) : line.label}
                {' '}{line.values[index] == null ? '—' : number.format(line.values[index]!)}
            </span>)}
        </div>, target, kind);
    })}</>;
}
