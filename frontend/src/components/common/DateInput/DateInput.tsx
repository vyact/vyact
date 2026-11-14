import {CalendarDays} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import './DateInput.css';

export default function DateInput({label, value, min, max, disabled, showIcon = true, required, onChange}: {
    label: string; value: string; min?: string; max?: string; disabled?: boolean; showIcon?: boolean; required?: boolean; onChange: (value: string) => void;
}) {
    const {i18n} = useTranslation('main');
    const timestamp = Date.parse(value);
    const formatted = Number.isFinite(timestamp) ? new Intl.DateTimeFormat(i18n.language, {
        year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'UTC',
    }).format(timestamp) : '—';
    return <span className="date-input">
        <span aria-hidden="true">{formatted}</span>
        {showIcon && <CalendarDays size={17} aria-hidden="true"/>}
        <input type="date" aria-label={label} value={value} min={min} max={max} disabled={disabled} required={required}
            onChange={event => onChange(event.target.value)}/>
    </span>;
}
