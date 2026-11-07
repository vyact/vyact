import {useRef, useState} from 'react';
import {Plus, Trash2} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import CustomSelect from '../CustomSelect/CustomSelect';
import type {QuoteDisplayMode} from './ChartQuoteDetails';
import ModalOverlay from '../common/ModalOverlay/ModalOverlay';
import {DEFAULT_MOVING_AVERAGES, MAX_MA_PERIOD, type MovingAverage} from './chartData';

export default function ChartSettings({averages, quoteMode, onSave, onClose}: {
    averages: MovingAverage[];
    quoteMode: QuoteDisplayMode;
    onSave: (averages: MovingAverage[], quoteMode: QuoteDisplayMode) => void;
    onClose: () => void;
}) {
    const {t} = useTranslation(['main', 'common']);
    const [draftQuoteMode, setDraftQuoteMode] = useState(quoteMode);
    const nextId = useRef(averages.length);
    const [draft, setDraft] = useState(() => averages.map(({period, color}, id) => ({id, period: String(period), color})));
    const values = draft.map(({period, color}) => ({period: Number(period), color}));
    const valid = values.every(({period}) => Number.isInteger(period) && period >= 1 && period <= MAX_MA_PERIOD);
    const update = (id: number, changes: {period?: string; color?: string}) =>
        setDraft(previous => previous.map(entry => entry.id === id ? {...entry, ...changes} : entry));

    return <ModalOverlay onClose={onClose} closeOnBackdrop captureEscape>
        <form className="stock-chart-settings" role="dialog" aria-modal="true" aria-labelledby="stock-chart-settings-title"
              onSubmit={event => {event.preventDefault(); if (valid) onSave(values, draftQuoteMode);}}>
            <h2 id="stock-chart-settings-title">{t('stockAnalysis.chartSettings')}</h2>
            <label className="stock-chart-quote-mode">
                <span>{t('stockAnalysis.quoteDisplayMode')}</span>
                <CustomSelect value={draftQuoteMode} onChange={value => setDraftQuoteMode(value as QuoteDisplayMode)}
                    options={(['header', 'tooltip'] as const).map(value => ({value, label: t(`stockAnalysis.quoteDisplay.${value}`)}))}
                    ariaLabel={t('stockAnalysis.quoteDisplayMode')} portal/>
            </label>
            <p>{t('stockAnalysis.maHelp')}</p>
            <div className="stock-chart-settings-averages">
                {draft.map(({id, period, color}, index) => <div className="stock-chart-settings-average" key={id}>
                    <label htmlFor={`stock-ma-period-${id}`}>{t('stockAnalysis.maPeriod', {number: index + 1})}</label>
                    <input id={`stock-ma-period-${id}`} type="number" min={1} max={MAX_MA_PERIOD} step={1} required value={period}
                           onChange={event => update(id, {period: event.target.value})}/>
                    <input type="color" aria-label={t('stockAnalysis.maColor', {number: index + 1})} value={color}
                           onChange={event => update(id, {color: event.target.value})}/>
                    <button type="button" className="modal-action-cancel" aria-label={t('stockAnalysis.removeMa', {number: index + 1})}
                            onClick={() => setDraft(previous => previous.filter(entry => entry.id !== id))}><Trash2 size={14}/></button>
                </div>)}
            </div>
            <footer>
                <button type="button" className="modal-action-cancel stock-chart-settings-add" onClick={() => {
                    const id = nextId.current++;
                    const preset = DEFAULT_MOVING_AVERAGES[draft.length % DEFAULT_MOVING_AVERAGES.length];
                    setDraft(previous => [...previous, {id, period: String(preset.period), color: preset.color}]);
                }}><Plus size={14}/>{t('stockAnalysis.addMa')}</button>
                <button type="button" className="modal-action-cancel" onClick={onClose}>{t('common:cancel')}</button>
                <button type="submit" className="modal-action-submit" disabled={!valid}>{t('common:save')}</button>
            </footer>
        </form>
    </ModalOverlay>;
}
