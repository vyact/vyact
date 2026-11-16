import {useTranslation} from 'react-i18next';

export default function ChartToolShortcuts({title, rise, fall, pointerDefault = false}: {title: string; rise: string; fall: string; pointerDefault?: boolean}) {
    const {t} = useTranslation('main');
    return <div className="rich-tooltip-content stock-chart-ruler-shortcuts">
        <strong className="rich-tooltip-title">{title}</strong>
        <div><span>{t(pointerDefault ? 'stockAnalysis.chartTools.pointerClick' : 'stockAnalysis.rulerClick')}</span></div>
        <div style={{color: rise}}><kbd>H</kbd><span>{t('stockAnalysis.high')}</span></div>
        <div style={{color: fall}}><kbd>L</kbd><span>{t('stockAnalysis.low')}</span></div>
        <div className="stock-chart-ruler-open"><kbd>O</kbd><span>{t('stockAnalysis.open')}</span></div>
        {pointerDefault && <div><kbd>C</kbd><span>{t('stockAnalysis.close')}</span></div>}
        <small>{t('stockAnalysis.rulerHoldKey')}</small>
    </div>;
}
