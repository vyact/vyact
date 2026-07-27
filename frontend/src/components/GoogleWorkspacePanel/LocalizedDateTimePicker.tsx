import {useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react';
import type {CSSProperties} from 'react';
import {createPortal} from 'react-dom';
import {CalendarDays, ChevronLeft, ChevronRight} from 'lucide-react';
import CustomSelect from '../CustomSelect/CustomSelect';
import type {SelectOption} from '../CustomSelect/CustomSelect';

type LocalizedDateTimePickerProps = {
    value: string;
    language: string;
    todayLabel: string;
    previousMonthLabel: string;
    nextMonthLabel: string;
    invalid?: boolean;
    onChange: (value: string) => void;
};

const pad2 = (value: number) => String(value).padStart(2, '0');
const MINUTE_OPTION_INTERVAL = 5;
const HOUR_OPTIONS: SelectOption[] = Array.from({length: 24}, (_, hour) => ({
    value: String(hour),
    label: pad2(hour),
}));
const MINUTE_OPTIONS: SelectOption[] = Array.from({length: 60 / MINUTE_OPTION_INTERVAL}, (_, index) => {
    const minute = index * MINUTE_OPTION_INTERVAL;
    return {
        value: String(minute),
        label: pad2(minute),
    };
});

const parseValue = (value: string) => {
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
    if (!match) return null;
    return new Date(
        Number(match[1]),
        Number(match[2]) - 1,
        Number(match[3]),
        Number(match[4]),
        Number(match[5]),
    );
};

const serializeValue = (value: Date) =>
    `${value.getFullYear()}-${pad2(value.getMonth() + 1)}-${pad2(value.getDate())}T${pad2(value.getHours())}:${pad2(value.getMinutes())}`;

const getCalendarDays = (year: number, month: number) => {
    const firstDay = new Date(year, month, 1);
    const gridStart = new Date(year, month, 1 - firstDay.getDay());
    return Array.from({length: 42}, (_, index) =>
        new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + index));
};

const isSameDay = (left: Date, right: Date) =>
    left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate();

export default function LocalizedDateTimePicker({
    value,
    language,
    todayLabel,
    previousMonthLabel,
    nextMonthLabel,
    invalid = false,
    onChange,
}: LocalizedDateTimePickerProps) {
    const rootRef = useRef<HTMLDivElement>(null);
    const popoverRef = useRef<HTMLDivElement>(null);
    const selected = useMemo(() => parseValue(value), [value]);
    const initialDate = selected ?? new Date();
    const [isOpen, setIsOpen] = useState(false);
    const [popoverPosition, setPopoverPosition] = useState<CSSProperties>({});
    const [visibleMonth, setVisibleMonth] = useState(
        () => new Date(initialDate.getFullYear(), initialDate.getMonth(), 1),
    );

    useEffect(() => {
        if (!isOpen) return;
        const closeOnOutsideClick = (event: MouseEvent) => {
            const target = event.target as Node;
            if (!rootRef.current?.contains(target) && !popoverRef.current?.contains(target)) {
                setIsOpen(false);
            }
        };
        const closeOnEscape = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            event.stopPropagation();
            setIsOpen(false);
        };
        document.addEventListener('mousedown', closeOnOutsideClick);
        document.addEventListener('keydown', closeOnEscape);
        return () => {
            document.removeEventListener('mousedown', closeOnOutsideClick);
            document.removeEventListener('keydown', closeOnEscape);
        };
    }, [isOpen]);

    useLayoutEffect(() => {
        if (!isOpen) return;
        const updatePopoverPosition = () => {
            const triggerRect = rootRef.current?.getBoundingClientRect();
            const popoverRect = popoverRef.current?.getBoundingClientRect();
            if (!triggerRect || !popoverRect) return;
            const viewportMargin = 8;
            const gap = 5;
            const fitsBelow = triggerRect.bottom + gap + popoverRect.height <= window.innerHeight - viewportMargin;
            const left = Math.min(
                Math.max(viewportMargin, triggerRect.left),
                Math.max(viewportMargin, window.innerWidth - popoverRect.width - viewportMargin),
            );
            setPopoverPosition({
                left,
                top: fitsBelow
                    ? triggerRect.bottom + gap
                    : Math.max(viewportMargin, triggerRect.top - popoverRect.height - gap),
            });
        };
        updatePopoverPosition();
        window.addEventListener('resize', updatePopoverPosition);
        window.addEventListener('scroll', updatePopoverPosition, true);
        return () => {
            window.removeEventListener('resize', updatePopoverPosition);
            window.removeEventListener('scroll', updatePopoverPosition, true);
        };
    }, [isOpen, visibleMonth]);

    useEffect(() => {
        if (isOpen && selected) {
            setVisibleMonth(new Date(selected.getFullYear(), selected.getMonth(), 1));
        }
    }, [isOpen, selected]);

    const weekdays = useMemo(() => {
        const sunday = new Date(2024, 0, 7);
        return Array.from({length: 7}, (_, index) => {
            const date = new Date(sunday);
            date.setDate(sunday.getDate() + index);
            return new Intl.DateTimeFormat(language, {weekday: 'short'}).format(date);
        });
    }, [language]);
    const calendarDays = useMemo(
        () => getCalendarDays(visibleMonth.getFullYear(), visibleMonth.getMonth()),
        [visibleMonth],
    );
    const formattedValue = selected
        ? new Intl.DateTimeFormat(language, {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
        }).format(selected)
        : '';

    const updateDate = (date: Date) => {
        const nextValue = selected ? new Date(selected) : new Date();
        nextValue.setFullYear(date.getFullYear(), date.getMonth(), date.getDate());
        if (!selected) nextValue.setHours(9, 0, 0, 0);
        onChange(serializeValue(nextValue));
        setVisibleMonth(new Date(date.getFullYear(), date.getMonth(), 1));
    };

    const updateTime = (part: 'hour' | 'minute', nextPart: number) => {
        const nextValue = selected ? new Date(selected) : new Date();
        if (part === 'hour') nextValue.setHours(nextPart);
        else nextValue.setMinutes(nextPart);
        nextValue.setSeconds(0, 0);
        onChange(serializeValue(nextValue));
    };

    const today = new Date();

    const popover = isOpen ? <div ref={popoverRef} className="gwp-date-time-popover portal" style={popoverPosition}>
        <div className="gwp-date-time-header">
            <button
                type="button"
                aria-label={previousMonthLabel}
                onClick={() => setVisibleMonth(month => new Date(month.getFullYear(), month.getMonth() - 1, 1))}
            >
                <ChevronLeft size={17}/>
            </button>
            <strong>{new Intl.DateTimeFormat(language, {year: 'numeric', month: 'long'}).format(visibleMonth)}</strong>
            <button
                type="button"
                aria-label={nextMonthLabel}
                onClick={() => setVisibleMonth(month => new Date(month.getFullYear(), month.getMonth() + 1, 1))}
            >
                <ChevronRight size={17}/>
            </button>
        </div>
        <div className="gwp-date-time-weekdays">
            {weekdays.map(weekday => <span key={weekday}>{weekday}</span>)}
        </div>
        <div className="gwp-date-time-days">
            {calendarDays.map(date => <button
                type="button"
                key={`${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`}
                className={[
                    date.getMonth() !== visibleMonth.getMonth() && 'other-month',
                    selected && isSameDay(date, selected) && 'selected',
                    isSameDay(date, today) && 'today',
                ].filter(Boolean).join(' ')}
                onClick={() => updateDate(date)}
            >
                {date.getDate()}
            </button>)}
        </div>
        <div className="gwp-date-time-footer">
            <button type="button" className="gwp-date-time-today" onClick={() => updateDate(today)}>
                {todayLabel}
            </button>
            <div className="gwp-date-time-selects">
                <CustomSelect
                    className="gwp-date-time-select"
                    ariaLabel="Hour"
                    options={HOUR_OPTIONS}
                    value={String(selected?.getHours() ?? 9)}
                    onChange={hour => updateTime('hour', Number(hour))}
                />
                <span>:</span>
                <CustomSelect
                    className="gwp-date-time-select"
                    ariaLabel="Minute"
                    options={MINUTE_OPTIONS}
                    value={String(selected?.getMinutes() ?? 0)}
                    onChange={minute => updateTime('minute', Number(minute))}
                />
            </div>
        </div>
    </div> : null;

    return <div className={`gwp-date-time-picker${invalid ? ' invalid' : ''}`} ref={rootRef}>
        <button
            type="button"
            className="gwp-date-time-trigger"
            aria-expanded={isOpen}
            aria-invalid={invalid}
            onClick={() => setIsOpen(open => !open)}
        >
            <span>{formattedValue}</span>
            <CalendarDays aria-hidden="true" size={17}/>
        </button>
        {popover && createPortal(popover, document.body)}
    </div>;
}
