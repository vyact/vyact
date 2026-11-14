import {useState} from 'react';
import {useTranslation} from 'react-i18next';
import {ChevronLeft, ChevronRight} from 'lucide-react';
import ActionMenu from '../common/ActionMenu/ActionMenu';
import CustomSelect from '../CustomSelect/CustomSelect';
import './StockContextDateInput.css';

const DAY_MS = 24 * 60 * 60 * 1000;
const GRID_DAYS = 42;
const toDay = (timestamp: number) => new Date(timestamp).toISOString().slice(0, 10);

/** Date selection constrained to the available price history, with a latest-date shortcut. */
export default function StockContextDateInput({label, value, min, max, disabled, onChange}: {
    label: string; value: string; min?: string; max?: string; disabled: boolean; onChange: (value: string) => void;
}) {
    const {t, i18n} = useTranslation('main');
    const locale = i18n.resolvedLanguage ?? i18n.language;
    const [open, setOpen] = useState(false);
    const [month, setMonth] = useState(value.slice(0, 7));
    const timestamp = Date.parse(`${month}-01T00:00:00Z`);
    const firstDay = new Date(timestamp);
    const year = firstDay.getUTCFullYear();
    const monthIndex = firstDay.getUTCMonth();
    const previousMonth = toDay(Date.UTC(year, monthIndex - 1, 1)).slice(0, 7);
    const nextMonth = toDay(Date.UTC(year, monthIndex + 1, 1)).slice(0, 7);
    const minMonth = min?.slice(0, 7);
    const maxMonth = max?.slice(0, 7);
    const dateFormatter = new Intl.DateTimeFormat(locale, {year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'UTC'});
    const weekdayFormatter = new Intl.DateTimeFormat(locale, {weekday: 'short', timeZone: 'UTC'});
    const monthFormatter = new Intl.DateTimeFormat(locale, {month: 'long', timeZone: 'UTC'});
    const chooseDate = (day: string) => {
        if ((min && day < min) || (max && day > max)) return;
        onChange(day); setOpen(false);
    };
    const years = Array.from({length: Number(maxMonth?.slice(0, 4) ?? year) - Number(minMonth?.slice(0, 4) ?? year) + 1},
        (_, offset) => String(Number(minMonth?.slice(0, 4) ?? year) + offset));
    const changeMonth = (nextYear: number, nextIndex: number) => {
        const candidate = toDay(Date.UTC(nextYear, nextIndex, 1)).slice(0, 7);
        setMonth(minMonth && candidate < minMonth ? minMonth : maxMonth && candidate > maxMonth ? maxMonth : candidate);
    };
    return <ActionMenu isOpen={open} onOpenChange={next => {if (next) setMonth(value.slice(0, 7)); setOpen(next);}}
        preferredSide="top" disabled={disabled} className="stock-context-date-input" triggerClassName="stock-context-date-trigger"
        menuClassName="stock-context-calendar" ariaLabel={label} trigger={dateFormatter.format(new Date(`${value}T00:00:00Z`))}>
        <div className="stock-context-calendar-header">
            <button type="button" aria-label={t('stockAnalysis.discussion.previousMonth')} disabled={!!minMonth && previousMonth < minMonth}
                onClick={() => setMonth(previousMonth)}><ChevronLeft size={16}/></button>
            <CustomSelect value={String(year)} ariaLabel={t('stockAnalysis.discussion.calendarYear')}
                options={years.map(item => ({value: item, label: item}))} onChange={next => changeMonth(Number(next), monthIndex)}/>
            <CustomSelect value={String(monthIndex)} ariaLabel={t('stockAnalysis.discussion.calendarMonth')}
                options={Array.from({length: 12}, (_, index) => ({value: String(index), label: monthFormatter.format(new Date(Date.UTC(year, index, 1))),
                    disabled: !!minMonth && toDay(Date.UTC(year, index, 1)).slice(0, 7) < minMonth || !!maxMonth && toDay(Date.UTC(year, index, 1)).slice(0, 7) > maxMonth}))}
                onChange={next => changeMonth(year, Number(next))}/>
            <button type="button" aria-label={t('stockAnalysis.discussion.nextMonth')} disabled={!!maxMonth && nextMonth > maxMonth}
                onClick={() => setMonth(nextMonth)}><ChevronRight size={16}/></button>
        </div>
        <div className="stock-context-calendar-grid">
            {Array.from({length: 7}, (_, index) => <span key={index} className="stock-context-calendar-weekday">{weekdayFormatter.format(new Date(Date.UTC(2026, 10, 1 + index)))}</span>)}
            {Array.from({length: GRID_DAYS}, (_, index) => {
                const day = toDay(timestamp + (index - firstDay.getUTCDay()) * DAY_MS);
                return <button type="button" key={day} aria-label={dateFormatter.format(new Date(`${day}T00:00:00Z`))}
                    aria-pressed={day === value} data-outside-month={day.slice(0, 7) !== month}
                    disabled={!!min && day < min || !!max && day > max} onClick={() => chooseDate(day)}>{Number(day.slice(-2))}</button>;
            })}
        </div>
        <button type="button" className="stock-context-calendar-latest" disabled={!max} onClick={() => {if (max) chooseDate(max);}}>
            {t('stockAnalysis.discussion.latestDate')}
        </button>
    </ActionMenu>;
}
