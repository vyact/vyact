import {Tooltip} from '../common/Tooltip/Tooltip';
import {ChevronDown, CircleHelp, RotateCcw} from 'lucide-react';
import {useState} from 'react';
import {useTranslation} from 'react-i18next';
import ModalOverlay from '../common/ModalOverlay/ModalOverlay';
import ModalCloseButton from '../common/ModalOverlay/ModalCloseButton';
import {INDICATORS} from './technicalIndicators';
import {OVERLAY_INDICATORS, type OverlayIndicator} from './overlayIndicators';
import {DEFAULT_INDICATOR_SETTINGS, MAX_INDICATOR_PERIOD, validIndicatorSettings, type IndicatorSettings} from './indicatorSettings';
import './IndicatorSettings.css';

export default function IndicatorSettingsDialog({settings, onSave, onClose}: {
    settings: IndicatorSettings; onSave: (settings: IndicatorSettings) => void; onClose: () => void;
}) {
    const {t} = useTranslation(['main', 'common']);
    const [draft, setDraft] = useState(() => structuredClone(settings));
    const [expanded, setExpanded] = useState<string | null>('macd');
    const valid = validIndicatorSettings(draft);
    return <ModalOverlay onClose={onClose} closeOnBackdrop captureEscape aria-labelledby="indicator-settings-title">
        <form className="stock-indicator-settings" onSubmit={event => {event.preventDefault(); if (valid) onSave(draft);}}>
            <header><h2 id="indicator-settings-title">{t('stockAnalysis.indicatorSettings')}</h2><ModalCloseButton onClick={onClose}/></header>
            <div className="stock-indicator-settings-body">
                {[
                    {label: 'overlayGroup', indicators: [...OVERLAY_INDICATORS]},
                    {label: 'panelGroup', indicators: INDICATORS.filter(kind => !OVERLAY_INDICATORS.includes(kind as OverlayIndicator))},
                ].map(group => <div className="stock-indicator-settings-group" key={group.label} role="group" aria-label={t(`stockAnalysis.${group.label}`)}>
                <p className="stock-indicator-group-title">{t(`stockAnalysis.${group.label}`)}</p>
                {group.indicators.map(kind => <section className="stock-indicator-accordion" key={kind}>
                    <div className="stock-indicator-accordion-heading">
                    <Tooltip multiline size="medium" content={<div className="rich-tooltip-content stock-indicator-help">
                        <strong className="rich-tooltip-title">{t(`stockAnalysis.indicators.${kind}`)}</strong>
                        <p className="rich-tooltip-description">{t(`stockAnalysis.indicatorHelp.${kind}.description`)}</p>
                        <ul className="stock-indicator-help-list">{t(`stockAnalysis.indicatorSettingHelp.${kind}`).split('\n').map(text => <li key={text}>{text}</li>)}</ul>
                    </div>}>
                        <button type="button" className="stock-indicator-help-button" aria-label={t('stockAnalysis.indicatorHelp.label', {name: t(`stockAnalysis.indicators.${kind}`)})}><CircleHelp size={14} aria-hidden="true"/></button>
                    </Tooltip>
                    <h3><button type="button" aria-expanded={expanded === kind} aria-controls={`indicator-panel-${kind}`}
                        onClick={() => setExpanded(previous => previous === kind ? null : kind)}>
                        {t(`stockAnalysis.indicators.${kind}`)}<ChevronDown size={16} aria-hidden="true"/>
                    </button></h3>
                    </div>
                    <div id={`indicator-panel-${kind}`} className="stock-indicator-panel" data-expanded={expanded === kind}
                        aria-hidden={expanded !== kind} inert={expanded !== kind}>
                    <div className="stock-indicator-panel-inner">
                    <div className="stock-indicator-panel-content">
                    <div className="stock-indicator-fields">
                    {Object.keys(DEFAULT_INDICATOR_SETTINGS[kind]).map(key => {
                        const level = ['lower', 'upper', 'threshold'].includes(key);
                        const decimal = ['deviation', 'percent', 'step', 'maximum'].includes(key);
                        return <label key={key}><span>{t(`stockAnalysis.indicatorFields.${key}`)}</span>
                            <input type="number" required min={level ? 0 : decimal ? 0.001 : 1} max={['step', 'maximum'].includes(key) ? 1 : level || decimal ? 100 : MAX_INDICATOR_PERIOD}
                                step={level || decimal ? 'any' : 1} value={Number.isNaN(draft[kind][key]) ? '' : draft[kind][key]}
                                onChange={event => setDraft(previous => ({...previous, [kind]: {...previous[kind], [key]: event.target.valueAsNumber}}))}/>
                        </label>;
                    })}
                    {kind === 'obv' && <p>{t('stockAnalysis.obvSettingsHint')}</p>}
                </div>
                    {kind !== 'obv' && <button type="button" className="modal-action-cancel stock-indicator-restore" onClick={() =>
                        setDraft(previous => ({...previous, [kind]: structuredClone(DEFAULT_INDICATOR_SETTINGS[kind])}))}>
                        <RotateCcw size={12} aria-hidden="true"/>{t('stockAnalysis.indicatorRestore')}
                    </button>}
                    </div>
                    </div>
                    </div>
                </section>)}
                </div>)}
                {!valid && <p role="alert">{t('stockAnalysis.indicatorSettingsInvalid')}</p>}
            </div>
            <footer>
                <button type="button" className="modal-action-cancel" onClick={onClose}>{t('common:cancel')}</button>
                <button type="submit" className="modal-action-submit" disabled={!valid}>{t('common:save')}</button>
            </footer>
        </form>
    </ModalOverlay>;
}
