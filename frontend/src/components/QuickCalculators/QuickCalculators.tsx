import '../common/WorkspaceLayout/WorkspaceBrand.css';
import DateInput from '../common/DateInput/DateInput';
import ChatAttachButton from '../common/ChatAttachButton/ChatAttachButton';
import {addToChat} from '../../utils/chatDraft';
import {useState, type CSSProperties} from 'react';
import {CalendarDays, Percent, X} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import ModalTabs from '../common/ModalTabs/ModalTabs';
import AmountButtons from '../CalcStudio/AmountButtons';
import {formatAmountInput, parseAmountInput} from '../CalcStudio/amountFormat';
import '../CalcStudio/CalcStudio.css';
import './QuickCalculators.css';
import {calculateReturn, calculateTripDays, calculateArrival} from './calculations';

export const RETURN_CALCULATOR_PANEL_ID = 'return-calculator';
export const TRAVEL_CALCULATOR_PANEL_ID = 'travel-calculator';
const today = () => {
    const date = new Date();
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

export default function QuickCalculators({kind, onClose, style}: {kind: 'returns' | 'travel'; onClose: () => void; style?: CSSProperties}) {
    const {t, i18n} = useTranslation('main');
    const [tab, setTab] = useState(0);
    const [base, setBase] = useState('');
    const [current, setCurrent] = useState('');
    const [years, setYears] = useState('');
    const [start, setStart] = useState(today);
    const [end, setEnd] = useState('');
    const [days, setDays] = useState('');
    const [inclusive, setInclusive] = useState(true);
    const travel = kind === 'travel';
    const resetInputs = () => {
        if (travel) {setStart(today()); setEnd(''); setDays(''); setInclusive(true);}
        else {setBase(''); setCurrent(''); setYears('');}
    };
    const tabs = travel ? ['duration', 'arrival'] : ['change', 'annual'];
    const title = t(`quickCalculators.${travel ? 'travelTitle' : 'returnTitle'}`);
    const validRate = calculateReturn(base, current, tab === 1 ? years : undefined);
    const duration = calculateTripDays(start, end, inclusive);
    const arrivalTime = calculateArrival(start, days, inclusive);
    const arrival = arrivalTime !== null
        ? new Intl.DateTimeFormat(i18n.language, {dateStyle: 'long', timeZone: 'UTC'}).format(arrivalTime) : null;
    const format = (value: number) => new Intl.NumberFormat(i18n.language, {maximumFractionDigits: 2}).format(value);
    const hasResult = travel ? tab === 0 ? duration !== null : arrival !== null : validRate !== null;
    const exportToChat = () => {
        if (!hasResult) return;
        const lines = travel ? [
            `${t('quickCalculators.start')}: ${start}`,
            `${t('quickCalculators.end')}: ${tab === 0 ? end : new Date(arrivalTime!).toISOString().slice(0, 10)}`,
            `${t('quickCalculators.days')}: ${tab === 0 ? duration : days}`,
            `${t('quickCalculators.includeStart')}: ${inclusive}`,
        ] : [
            `${t('quickCalculators.base')}: ${base}`,
            `${t('quickCalculators.current')}: ${current}`,
            ...(tab === 1 ? [`${t('quickCalculators.years')}: ${years}`] : []),
            `${t(`quickCalculators.${tabs[tab]}`)}: ${format(validRate!)}%`,
        ];
        const attachmentTitle = t(`quickCalculators.${tabs[tab]}`);
        addToChat({title: attachmentTitle, text: [`## ${attachmentTitle}`, ...lines.map(line => `- ${line}`)].join('\n')});
    };
    return <aside className="calc-studio quick-calculator" style={style} aria-labelledby="quick-calculator-title">
        <header className="calc-studio-header">
            <span className="workspace-brand-icon">{travel ? <CalendarDays size={18} aria-hidden="true"/> : <Percent size={18} aria-hidden="true"/>}</span>
            <h2 id="quick-calculator-title">{title}</h2>
            <button className="titlebar-btn" onClick={onClose} aria-label={t('windowControls.close')}><X size={18}/></button>
        </header>
        <div className="quick-calculator-content">
            <div className="quick-calculator-tabs">
                <ModalTabs tabs={tabs.map((key, index) => ({key: String(index), label: t(`quickCalculators.${key}`)}))}
                    activeKey={String(tab)} onChange={key => {
                        const nextTab = Number(key);
                        if (nextTab !== tab) {resetInputs(); setTab(nextTab);}
                    }}/>
            </div>
            <div>
                <p className="quick-calculator-hint">{t(`quickCalculators.${tabs[tab]}Hint`)}</p>
                <div className={`calc-studio-fields quick-calculator-fields${travel ? ' quick-calculator-fields--travel' : ''}`}>
                    {travel ? <>
                        <label className="calc-studio-field" onClick={event => {if (event.target === event.currentTarget) event.preventDefault();}}>{t('quickCalculators.start')}<DateInput label={t('quickCalculators.start')} value={start} onChange={setStart}/></label>
                        {tab === 0 ? <label className="calc-studio-field" onClick={event => {if (event.target === event.currentTarget) event.preventDefault();}}>{t('quickCalculators.end')}<DateInput label={t('quickCalculators.end')} min={start} value={end} onChange={setEnd}/></label>
                            : <label className="calc-studio-field">{t('quickCalculators.days')}<input type="number" min={Number(inclusive)} step="1" value={days} onChange={event => setDays(event.target.value)}/></label>}
                        <label className="quick-calculator-checkbox"><input type="checkbox" checked={inclusive} onChange={event => setInclusive(event.target.checked)}/>{t('quickCalculators.includeStart')}</label>
                    </> : <>
                        {[{key: 'base', value: base, setter: setBase}, {key: 'current', value: current, setter: setCurrent}].map(({key, value, setter}) => <div className="calc-studio-field" key={key}>
                            <label htmlFor={`return-${key}`}>{t(`quickCalculators.${key}`)}</label>
                            <input id={`return-${key}`} type="text" inputMode="decimal" value={formatAmountInput(value, i18n.language)} onChange={event => {
                                const parsed = parseAmountInput(event.target.value, i18n.language);
                                if (parsed !== null) setter(parsed);
                            }}/>
                            <AmountButtons fieldLabel={t(`quickCalculators.${key}`)} onAdjust={amount => setter(amount === null ? '' : String((Number(value) || 0) + amount))}/>
                        </div>)}
                        {tab === 1 && <label className="calc-studio-field">{t('quickCalculators.years')}<input type="number" min="0.01" step="any" value={years} onChange={event => setYears(event.target.value)}/></label>}
                    </>}
                </div>
                <div className={`quick-calculator-result${!travel && validRate !== null ? validRate > 0 ? ' is-positive' : validRate < 0 ? ' is-negative' : '' : ''}`} role="status" aria-live="polite">
                    <span>{t(`quickCalculators.${travel ? tab === 0 ? 'days' : 'end' : tabs[tab]}`)}</span>
                    <strong>{travel ? tab === 0 ? duration === null ? '—' : t('quickCalculators.dayCount', {count: duration}) : arrival ?? '—'
                        : validRate === null ? '—' : `${validRate > 0 ? '+' : ''}${format(validRate)}%`}</strong>
                </div>
                <div className="quick-calculator-footer"><button className="modal-action-cancel" onClick={resetInputs}>{t('calcStudio.reset')}</button>
                    <ChatAttachButton disabled={!hasResult} onClick={exportToChat}/>
                </div>
            </div>
        </div>
    </aside>;
}
