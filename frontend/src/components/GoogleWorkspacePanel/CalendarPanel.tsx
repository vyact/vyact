import {Fragment, useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {
    AlertCircle,
    Bell,
    CalendarDays,
    CircleCheck,
    CircleDot,
    ChevronDown,
    ChevronLeft,
    ChevronRight,
    ChevronsLeft,
    ChevronsRight,
    Clock,
    LoaderCircle,
    MapPin,
    MessageSquareText,
    Plus,
    RotateCcw,
    Trash2,
    X,
} from 'lucide-react';
import {useWorkspace} from './WorkspaceContext';
import type {GoogleCalendarSelection} from '../../types/googleWorkspace';
import CustomSelect from '../CustomSelect/CustomSelect';
import {Tooltip} from '../common/Tooltip/Tooltip';
import ConfirmModal from '../common/ConfirmModal/ConfirmModal';
import LocalizedDateTimePicker from './LocalizedDateTimePicker';

type CalendarEvent = {
    id: string;
    summary?: string;
    description?: string;
    location?: string;
    start?: {dateTime?: string; date?: string; timeZone?: string};
    end?: {dateTime?: string; date?: string; timeZone?: string};
    htmlLink?: string;
    created?: string;
    reminders?: {
        useDefault?: boolean;
        overrides?: {method: ReminderMethod; minutes: number}[];
    };
};

type ReminderMethod = 'popup' | 'email';
type ReminderUnit = 'minute' | 'hour' | 'day';
type EventReminderForm = {method: ReminderMethod; amount: number | ''; unit: ReminderUnit};

type EventFormData = {
    summary: string;
    start: string;
    end: string;
    description: string;
    location: string;
    reminders: EventReminderForm[];
    useDefaultReminders: boolean;
};

const EMPTY_FORM: EventFormData = {
    summary: '',
    start: '',
    end: '',
    description: '',
    location: '',
    reminders: [],
    useDefaultReminders: true,
};
const FALLBACK_TIME_ZONE = 'UTC';
const MAX_REMINDERS = 3;
const MAX_REMINDER_MINUTES = 40_320;
const DEFAULT_EVENT_DURATION_MINUTES = 60;
const DEFAULT_EVENT_TIME_INTERVAL_MINUTES = 30;
const REMINDER_UNIT_MINUTES: Record<ReminderUnit, number> = {
    minute: 1,
    hour: 60,
    day: 1_440,
};

const minutesToReminderForm = ({method, minutes}: {method: ReminderMethod; minutes: number}): EventReminderForm => {
    const unit = (['day', 'hour'] as ReminderUnit[])
        .find(candidate => minutes > 0 && minutes % REMINDER_UNIT_MINUTES[candidate] === 0) ?? 'minute';
    return {method, amount: minutes / REMINDER_UNIT_MINUTES[unit], unit};
};

const reminderFormToMinutes = ({amount, unit}: EventReminderForm) =>
    Number(amount) * REMINDER_UNIT_MINUTES[unit];

const isReminderInvalid = (reminder: EventReminderForm) => {
    const minutes = reminderFormToMinutes(reminder);
    return reminder.amount === ''
        || !Number.isInteger(reminder.amount)
        || reminder.amount < 0
        || minutes > MAX_REMINDER_MINUTES;
};

const roundUpToEventTimeInterval = (date: Date): Date => {
    const roundedDate = new Date(date);
    const minutes = roundedDate.getMinutes();
    const hasSubMinuteValue = roundedDate.getSeconds() > 0 || roundedDate.getMilliseconds() > 0;
    const remainder = minutes % DEFAULT_EVENT_TIME_INTERVAL_MINUTES;
    const minutesToAdd = remainder === 0
        ? (hasSubMinuteValue ? DEFAULT_EVENT_TIME_INTERVAL_MINUTES : 0)
        : DEFAULT_EVENT_TIME_INTERVAL_MINUTES - remainder;

    roundedDate.setMinutes(minutes + minutesToAdd, 0, 0);
    return roundedDate;
};

const getSystemTimeZone = (): string => {
    try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || FALLBACK_TIME_ZONE;
    } catch {
        return FALLBACK_TIME_ZONE;
    }
};

const getWeekdayNames = (locale: string): string[] => {
    const base = new Date(2024, 0, 7); // Sunday
    return Array.from({length: 7}, (_, i) => {
        const d = new Date(base);
        d.setDate(base.getDate() + i);
        return d.toLocaleDateString(locale, {weekday: 'short'});
    });
};

const toLocalTime = (dt: string | undefined, locale: string): string => {
    if (!dt) return '';
    try {
        return new Date(dt).toLocaleTimeString(locale, {hour: '2-digit', minute: '2-digit', hour12: false});
    } catch {
        return '';
    }
};

const formatDateRange = (event: CalendarEvent, locale: string, allDayLabel: string): string => {
    const s = event.start;
    const e = event.end;
    if (!s) return '';
    if (s.date) return allDayLabel;
    const startTime = toLocalTime(s.dateTime, locale);
    const endTime = toLocalTime(e?.dateTime, locale);
    const startDate = s.dateTime ? new Date(s.dateTime) : null;
    const endDate = e?.dateTime ? new Date(e.dateTime) : null;
    const spansMultipleDays = startDate && endDate
        && (startDate.getFullYear() !== endDate.getFullYear()
            || startDate.getMonth() !== endDate.getMonth()
            || startDate.getDate() !== endDate.getDate());
    if (spansMultipleDays) {
        const formatDateTime = (date: Date) => date.toLocaleString(locale, {
            month: 'numeric',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
        });
        return `${formatDateTime(startDate)} – ${formatDateTime(endDate)}`;
    }
    return endTime ? `${startTime} – ${endTime}` : startTime;
};

const getMonthDays = (year: number, month: number): {date: Date; isCurrentMonth: boolean}[] => {
    const first = new Date(year, month, 1);
    const last = new Date(year, month + 1, 0);
    const startDay = first.getDay();
    const days: {date: Date; isCurrentMonth: boolean}[] = [];
    for (let i = startDay - 1; i >= 0; i--) {
        days.push({date: new Date(year, month, -i), isCurrentMonth: false});
    }
    for (let d = 1; d <= last.getDate(); d++) {
        days.push({date: new Date(year, month, d), isCurrentMonth: true});
    }
    const remaining = 7 - (days.length % 7);
    if (remaining < 7) {
        for (let i = 1; i <= remaining; i++) {
            days.push({date: new Date(year, month + 1, i), isCurrentMonth: false});
        }
    }
    return days;
};

const pad2 = (n: number) => String(n).padStart(2, '0');
const dateToStr = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

const getEventBoundaryTime = (boundary?: CalendarEvent['start']): number => {
    const value = boundary?.dateTime ?? (boundary?.date ? `${boundary.date}T00:00:00` : '');
    return value ? new Date(value).getTime() : Number.NaN;
};

const eventOverlapsDate = (event: CalendarEvent, dateString: string): boolean => {
    const dayStart = new Date(`${dateString}T00:00:00`);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);
    const eventStart = getEventBoundaryTime(event.start);
    const parsedEnd = getEventBoundaryTime(event.end);
    const eventEnd = Number.isFinite(parsedEnd) ? parsedEnd : eventStart + 1;
    return Number.isFinite(eventStart) && eventStart < dayEnd.getTime() && eventEnd > dayStart.getTime();
};

const getEventDateKeys = (event: CalendarEvent): string[] => {
    const eventStart = getEventBoundaryTime(event.start);
    const parsedEnd = getEventBoundaryTime(event.end);
    if (!Number.isFinite(eventStart)) return [];
    const eventEnd = Number.isFinite(parsedEnd) && parsedEnd > eventStart ? parsedEnd : eventStart + 1;
    const firstDay = new Date(eventStart);
    firstDay.setHours(0, 0, 0, 0);
    const lastDay = new Date(eventEnd - 1);
    lastDay.setHours(0, 0, 0, 0);
    const dateKeys: string[] = [];
    for (const date = new Date(firstDay); date <= lastDay; date.setDate(date.getDate() + 1)) {
        dateKeys.push(dateToStr(date));
    }
    return dateKeys;
};

const toDatetimeLocalValue = (isoStr?: string): string => {
    if (!isoStr) return '';
    try {
        const d = new Date(isoStr);
        return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
    } catch { return ''; }
};

type EventStatus = 'past' | 'ongoing' | 'upcoming';

const getEventStatus = (event: CalendarEvent, now: number): EventStatus => {
    const startValue = event.start?.dateTime ?? event.start?.date;
    const endValue = event.end?.dateTime ?? event.end?.date;
    const startTime = startValue ? new Date(startValue).getTime() : Number.NaN;
    const endTime = endValue ? new Date(endValue).getTime() : Number.NaN;

    if (Number.isFinite(endTime) && endTime <= now) return 'past';
    if (Number.isFinite(startTime) && startTime <= now) return 'ongoing';
    return 'upcoming';
};

const EventDescriptionPreview = ({description, expanded, onToggle}: {
    description: string;
    expanded: boolean;
    onToggle: () => void;
}) => {
    const {t} = useTranslation('main');
    const previewDescription = description.replace(/\s+/g, ' ').trim();
    const toggleDescription = (event: React.MouseEvent) => {
        event.stopPropagation();
        onToggle();
    };

    return <div className={`gwp-cal-event-description${expanded ? ' is-expanded' : ''}`}
                onClick={toggleDescription}>
        <span
            className="gwp-cal-event-description-preview"
            onMouseDown={event => event.preventDefault()}
        >
            <MessageSquareText size={12}/>
            <span>{previewDescription}</span>
        </span>
        <button type="button" className="gwp-cal-event-description-toggle"
                aria-label={t('googleWorkspace.calendar.description')} aria-expanded={expanded}
                onMouseDown={event => event.preventDefault()}>
            <ChevronDown aria-hidden="true" size={15}/>
        </button>
        {expanded && <div className="gwp-cal-event-description-full">{description}</div>}
    </div>;
};

const EventReminderIndicator = ({reminders}: {reminders?: CalendarEvent['reminders']}) => {
    const {t} = useTranslation('main');
    const overrides = reminders?.overrides ?? [];

    if (!overrides.length) return null;
    const reminderUnitKey: Record<ReminderUnit, 'minutes' | 'hours' | 'days'> = {
        minute: 'minutes',
        hour: 'hours',
        day: 'days',
    };

    const tooltipContent = <span className="gwp-cal-event-reminder-content">
            {overrides.map((reminder, index) => {
                const {amount, unit} = minutesToReminderForm(reminder);
                return <Fragment key={`${reminder.method}-${reminder.minutes}-${index}`}>
                    <span>{reminder.method === 'email'
                        ? t('googleWorkspace.calendar.email')
                        : t('googleWorkspace.calendar.notification')}</span>
                    <span>· {amount} {t(`googleWorkspace.calendar.${reminderUnitKey[unit]}`)}</span>
                </Fragment>;
            })}
        </span>;

    return <Tooltip content={tooltipContent} multiline>
        <span className="gwp-cal-event-reminder-indicator" tabIndex={0} onClick={event => event.stopPropagation()}>
            <Bell aria-hidden="true" size={14}/>
        </span>
    </Tooltip>;
};

export default function CalendarPanel({selectedEvent, onSelectedEventHandled}: {
    selectedEvent?: GoogleCalendarSelection | null;
    onSelectedEventHandled?: (requestId: number) => void;
}) {
    const {api, provider} = useWorkspace();
    const maxReminders = provider === 'microsoft' ? 1 : MAX_REMINDERS;
    const {t, i18n} = useTranslation('main');
    const currentLanguage = i18n.resolvedLanguage ?? i18n.language;
    const today = useMemo(() => new Date(), []);
    const [year, setYear] = useState(today.getFullYear());
    const [month, setMonth] = useState(today.getMonth());
    const [selectedDate, setSelectedDate] = useState<string>(dateToStr(today));
    const [events, setEvents] = useState<CalendarEvent[]>([]);
    const [expandedDescriptionIds, setExpandedDescriptionIds] = useState<Set<string>>(new Set());
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);

    // Event form
    const [showForm, setShowForm] = useState(false);
    const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null);
    const [form, setForm] = useState<EventFormData>(EMPTY_FORM);
    const [saving, setSaving] = useState(false);
    const [hasAttemptedSave, setHasAttemptedSave] = useState(false);
    const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
    const initialFormRef = useRef<EventFormData>(EMPTY_FORM);
    const firstInvalidReminderInputRef = useRef<HTMLInputElement>(null);

    // Delete confirm
    const [deleteTarget, setDeleteTarget] = useState<CalendarEvent | null>(null);
    const [deleting, setDeleting] = useState(false);

    const fetchRef = useRef(0);
    const eventRowRefs = useRef(new Map<string, HTMLDivElement>());
    const focusedSelectionRequestRef = useRef<number | null>(null);
    const didAutoScrollTodayRef = useRef(false);
    const highlightTimeoutRef = useRef<number | null>(null);
    const [highlightedEventId, setHighlightedEventId] = useState<string | null>(null);

    useEffect(() => {
        if (!selectedEvent) return;
        const eventStart = new Date(selectedEvent.startAt);
        if (Number.isNaN(eventStart.getTime())) return;
        setYear(eventStart.getFullYear());
        setMonth(eventStart.getMonth());
        setSelectedDate(dateToStr(eventStart));
    }, [selectedEvent]);

    const fetchEvents = useCallback(async (showRefresh = false) => {
        const id = ++fetchRef.current;
        if (showRefresh) setRefreshing(true); else setLoading(true);
        try {
            const firstDay = new Date(year, month, 1);
            // Fetch from start of first visible week to end of last visible week
            const startDay = firstDay.getDay();
            const viewStart = new Date(year, month, 1 - startDay);
            const endDays = getMonthDays(year, month).length;
            const viewEnd = new Date(viewStart);
            viewEnd.setDate(viewStart.getDate() + endDays);
            const res = await api.getGoogleCalendarEvents({
                time_min: viewStart.toISOString(),
                time_max: viewEnd.toISOString(),
                max_results: 250,
            });
            if (id === fetchRef.current) setEvents(res.events ?? []);
        } catch { /* ignore */ } finally {
            if (id === fetchRef.current) {
                setLoading(false);
                setRefreshing(false);
            }
        }
    }, [year, month]);

    useEffect(() => { fetchEvents(); }, [fetchEvents]);

    const eventsForDate = useMemo(() => {
        if (!selectedDate) return [];
        return events
            .filter(event => eventOverlapsDate(event, selectedDate))
            .sort((a, b) => {
                const aStart = a.start?.dateTime ?? a.start?.date ?? '';
                const bStart = b.start?.dateTime ?? b.start?.date ?? '';
                const cmp = aStart.localeCompare(bStart);
                if (cmp !== 0) return cmp;
                return (a.created ?? '').localeCompare(b.created ?? '');
            });
    }, [events, selectedDate]);

    const eventDates = useMemo(() => {
        const set = new Set<string>();
        events.forEach(e => {
            getEventDateKeys(e).forEach(dateKey => set.add(dateKey));
        });
        return set;
    }, [events]);

    const prevMonth = () => {
        if (month === 0) { setYear(y => y - 1); setMonth(11); }
        else setMonth(m => m - 1);
    };
    const nextMonth = () => {
        if (month === 11) { setYear(y => y + 1); setMonth(0); }
        else setMonth(m => m + 1);
    };
    const previousYear = () => setYear(currentYear => currentYear - 1);
    const nextYear = () => setYear(currentYear => currentYear + 1);
    const goToday = () => {
        setYear(today.getFullYear());
        setMonth(today.getMonth());
        setSelectedDate(dateToStr(today));
    };

    const days = useMemo(() => getMonthDays(year, month), [year, month]);
    const todayStr = dateToStr(today);
    const weekdays = useMemo(() => getWeekdayNames(currentLanguage), [currentLanguage]);

    const openCreateForm = () => {
        setEditingEvent(null);
        setHasAttemptedSave(false);
        const now = new Date();
        const isTodaySelected = selectedDate === dateToStr(now);
        const defaultStartDate = roundUpToEventTimeInterval(now);
        const defaultStart = isTodaySelected
            ? toDatetimeLocalValue(defaultStartDate.toISOString())
            : selectedDate ? `${selectedDate}T09:00` : '';
        const defaultEndDate = new Date(defaultStartDate.getTime() + DEFAULT_EVENT_DURATION_MINUTES * 60 * 1_000);
        const defaultEnd = isTodaySelected
            ? toDatetimeLocalValue(defaultEndDate.toISOString())
            : selectedDate ? `${selectedDate}T10:00` : '';
        const initialForm = {...EMPTY_FORM, start: defaultStart, end: defaultEnd};
        initialFormRef.current = initialForm;
        setForm(initialForm);
        setShowForm(true);
    };

    const openEditForm = (event: CalendarEvent) => {
        setEditingEvent(event);
        setHasAttemptedSave(false);
        const isAllDay = !!event.start?.date;
        const initialForm = {
            summary: event.summary ?? '',
            start: isAllDay ? (event.start?.date ?? '') : toDatetimeLocalValue(event.start?.dateTime),
            end: isAllDay ? (event.end?.date ?? '') : toDatetimeLocalValue(event.end?.dateTime),
            description: event.description ?? '',
            location: event.location ?? '',
            reminders: [...(event.reminders?.overrides ?? [])]
                .sort((left, right) => {
                    const reminderTimeDifference = left.minutes - right.minutes;
                    if (reminderTimeDifference !== 0) return reminderTimeDifference;
                    return left.method === right.method ? 0 : left.method === 'popup' ? -1 : 1;
                })
                .slice(0, maxReminders)
                .map(minutesToReminderForm),
            useDefaultReminders: event.reminders?.useDefault !== false,
        };
        initialFormRef.current = initialForm;
        setForm(initialForm);
        setShowForm(true);
    };

    useEffect(() => {
        if (!selectedEvent || focusedSelectionRequestRef.current === selectedEvent.requestId) return;
        const matchingEvent = events.find(event => event.id === selectedEvent.eventId);
        if (!matchingEvent || !eventsForDate.some(event => event.id === matchingEvent.id)) return;

        focusedSelectionRequestRef.current = selectedEvent.requestId;
        setHighlightedEventId(null);
        const animationFrame = window.requestAnimationFrame(() => {
            const eventRow = eventRowRefs.current.get(matchingEvent.id);
            eventRow?.scrollIntoView({behavior: 'smooth', block: 'center'});
            setHighlightedEventId(matchingEvent.id);
            onSelectedEventHandled?.(selectedEvent.requestId);
            if (highlightTimeoutRef.current !== null) window.clearTimeout(highlightTimeoutRef.current);
            highlightTimeoutRef.current = window.setTimeout(() => {
                setHighlightedEventId(null);
                highlightTimeoutRef.current = null;
            }, 2_400);
        });
        return () => window.cancelAnimationFrame(animationFrame);
    }, [events, eventsForDate, onSelectedEventHandled, selectedEvent]);

    useEffect(() => {
        if (
            loading
            || selectedEvent
            || didAutoScrollTodayRef.current
            || selectedDate !== todayStr
            || eventsForDate.length === 0
        ) return;

        didAutoScrollTodayRef.current = true;
        const now = Date.now();
        const targetEvent = eventsForDate.find(event => {
            const eventEnd = getEventBoundaryTime(event.end);
            return Number.isFinite(eventEnd) && eventEnd > now;
        }) ?? eventsForDate[eventsForDate.length - 1];
        const animationFrame = window.requestAnimationFrame(() => {
            if (targetEvent) {
                eventRowRefs.current.get(targetEvent.id)?.scrollIntoView({block: 'start'});
            }
        });
        return () => window.cancelAnimationFrame(animationFrame);
    }, [eventsForDate, loading, selectedDate, selectedEvent, todayStr]);

    useEffect(() => () => {
        if (highlightTimeoutRef.current !== null) window.clearTimeout(highlightTimeoutRef.current);
    }, []);

    const closeForm = useCallback(() => {
        setShowForm(false);
        setShowDiscardConfirm(false);
        setEditingEvent(null);
        setHasAttemptedSave(false);
        setForm(EMPTY_FORM);
        initialFormRef.current = EMPTY_FORM;
    }, []);

    const isFormDirty = useMemo(
        () => JSON.stringify(form) !== JSON.stringify(initialFormRef.current),
        [form],
    );

    const requestCloseForm = useCallback(() => {
        if (saving) return;
        if (isFormDirty) {
            setShowDiscardConfirm(true);
            return;
        }
        closeForm();
    }, [closeForm, isFormDirty, saving]);

    useEffect(() => {
        if (!showForm || showDiscardConfirm || deleteTarget) return;
        const closeOnEscape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') requestCloseForm();
        };
        window.addEventListener('keydown', closeOnEscape);
        return () => window.removeEventListener('keydown', closeOnEscape);
    }, [deleteTarget, requestCloseForm, showDiscardConfirm, showForm]);

    const isEndBeforeStart = useMemo(() => {
        if (!form.start || !form.end) return false;
        return new Date(form.end) <= new Date(form.start);
    }, [form.start, form.end]);
    const hasInvalidReminder = form.reminders.some(isReminderInvalid);
    const firstInvalidReminderIndex = form.reminders.findIndex(isReminderInvalid);
    const remindersChanged = form.useDefaultReminders !== initialFormRef.current.useDefaultReminders
        || JSON.stringify(form.reminders) !== JSON.stringify(initialFormRef.current.reminders);

    const updateReminder = (index: number, updates: Partial<EventReminderForm>) => {
        setForm(current => ({
            ...current,
            reminders: current.reminders.map((reminder, reminderIndex) =>
                reminderIndex === index ? {...reminder, ...updates} : reminder),
        }));
    };

    const handleSave = async () => {
        if (!form.start || isEndBeforeStart || hasInvalidReminder) {
            setHasAttemptedSave(true);
            if (hasInvalidReminder) {
                window.requestAnimationFrame(() => {
                    firstInvalidReminderInputRef.current?.scrollIntoView({behavior: 'smooth', block: 'center'});
                    firstInvalidReminderInputRef.current?.focus();
                });
            }
            return;
        }
        setSaving(true);
        const timezone = getSystemTimeZone();
        const remindersToSave = form.reminders
            .slice(0, maxReminders)
            .filter(reminder => reminderFormToMinutes(reminder) > 0);
        const shouldUpdateReminders = remindersChanged || remindersToSave.length !== form.reminders.length;
        const reminderPayload = shouldUpdateReminders
            ? {reminders: remindersToSave.map(reminder => ({
                method: reminder.method,
                minutes: reminderFormToMinutes(reminder),
            })), use_default_reminders: form.useDefaultReminders}
            : {};
        try {
            if (editingEvent) {
                await api.updateGoogleCalendarEvent(editingEvent.id, {
                    summary: form.summary,
                    start: form.start,
                    end: form.end || form.start,
                    description: form.description,
                    location: form.location,
                    timezone,
                    ...reminderPayload,
                });
            } else {
                await api.createGoogleCalendarEvent({
                    summary: form.summary,
                    start: form.start,
                    end: form.end || form.start,
                    description: form.description,
                    location: form.location,
                    timezone,
                    ...reminderPayload,
                });
            }
            closeForm();
            fetchEvents(true);
        } catch { /* ignore */ } finally {
            setSaving(false);
        }
    };

    const handleDelete = async () => {
        if (!deleteTarget) return;
        setDeleting(true);
        try {
            await api.deleteGoogleCalendarEvent(deleteTarget.id);
            setDeleteTarget(null);
            fetchEvents(true);
        } catch { /* ignore */ } finally {
            setDeleting(false);
        }
    };

    return <div className="gwp-calendar">
        {/* Calendar Header */}
        <div className="gwp-cal-header">
            <div className="gwp-cal-nav">
                <button onClick={previousYear} aria-label={t('googleWorkspace.calendar.prevYear')}><ChevronsLeft size={16}/></button>
                <button onClick={prevMonth} aria-label={t('googleWorkspace.calendar.prevMonth')}><ChevronLeft size={16}/></button>
                <strong>{new Date(year, month).toLocaleDateString(currentLanguage, {year: 'numeric', month: 'long'})}</strong>
                <button onClick={nextMonth} aria-label={t('googleWorkspace.calendar.nextMonth')}><ChevronRight size={16}/></button>
                <button onClick={nextYear} aria-label={t('googleWorkspace.calendar.nextYear')}><ChevronsRight size={16}/></button>
            </div>
            <div className="gwp-cal-actions">
                <button className="gwp-cal-today-btn" onClick={goToday}>{t('googleWorkspace.calendar.today')}</button>
                <button className="gwp-cal-refresh-btn" onClick={() => fetchEvents(true)} disabled={refreshing} aria-label={t('common:refresh')}>
                    <RotateCcw size={16} className={refreshing ? 'gwp-spin' : ''}/>
                </button>
                <button className="gwp-cal-add-btn" onClick={openCreateForm}>
                    <Plus size={16}/>
                    <span>{t('googleWorkspace.calendar.newEvent')}</span>
                </button>
            </div>
        </div>

        {/* Calendar Grid */}
        <div className="gwp-cal-grid">
            <div className="gwp-cal-weekdays">
                {weekdays.map((d, i) => <span key={d} className={i === 0 ? 'sun' : i === 6 ? 'sat' : ''}>{d}</span>)}
            </div>
            {loading ? (
                <div className="gwp-cal-loading"><LoaderCircle size={20} className="gwp-spin"/></div>
            ) : (
                <div className="gwp-cal-days">
                    {days.map(({date, isCurrentMonth}, i) => {
                        const ds = dateToStr(date);
                        const isToday = ds === todayStr;
                        const isSelected = ds === selectedDate;
                        const hasEvents = eventDates.has(ds);
                        const dayOfWeek = date.getDay();
                        return <button
                            key={i}
                            className={[
                                'gwp-cal-day',
                                !isCurrentMonth && 'other-month',
                                isToday && 'today',
                                isSelected && 'selected',
                                dayOfWeek === 0 && 'sun',
                                dayOfWeek === 6 && 'sat',
                            ].filter(Boolean).join(' ')}
                            onClick={() => setSelectedDate(ds)}
                        >
                            <span>{date.getDate()}</span>
                            {hasEvents && <i className="gwp-cal-dot"/>}
                        </button>;
                    })}
                </div>
            )}
        </div>

        {/* Event List for Selected Date */}
        <div className="gwp-cal-events">
            <div className="gwp-cal-events-header">
                <CalendarDays size={14}/>
                <strong>{selectedDate ? new Date(selectedDate + 'T00:00').toLocaleDateString(currentLanguage, {month: 'long', day: 'numeric', weekday: 'short'}) : ''}</strong>
            </div>
            <div className="gwp-cal-events-scroll">
                {eventsForDate.length === 0 ? (
                    <div className="gwp-cal-empty">{t('googleWorkspace.calendar.noEvents')}</div>
                ) : (
                    eventsForDate.map(event => {
                        const eventStatus = getEventStatus(event, Date.now());
                        return <div
                            key={event.id}
                            ref={element => {
                                if (element) eventRowRefs.current.set(event.id, element);
                                else eventRowRefs.current.delete(event.id);
                            }}
                            className={`gwp-cal-event-row ${eventStatus}${highlightedEventId === event.id ? ' notification-highlight' : ''}`}
                            onClick={() => openEditForm(event)}
                        >
                            <div className="gwp-cal-event-info">
                                <div className="gwp-cal-event-title">
                                    <strong>{event.summary || t('googleWorkspace.noSubject')}</strong>
                                    <div className="gwp-cal-event-actions">
                                        <span className={`gwp-cal-event-status ${eventStatus}`}>
                                            {eventStatus === 'past' ? <CircleCheck size={12}/> : eventStatus === 'ongoing' ? <CircleDot size={12}/> : <Clock size={12}/>}
                                            {t(`googleWorkspace.calendar.${eventStatus === 'past' ? 'ended' : eventStatus}`)}
                                        </span>
                                        <EventReminderIndicator reminders={event.reminders}/>
                                        <button
                                            className="gwp-cal-event-delete"
                                            onClick={e => { e.stopPropagation(); setDeleteTarget(event); }}
                                            aria-label={t('googleWorkspace.delete')}
                                        >
                                            <Trash2 size={14}/>
                                        </button>
                                    </div>
                                </div>
                                <span className="gwp-cal-event-time"><Clock size={12}/> {formatDateRange(event, currentLanguage, t('googleWorkspace.calendar.allDay'))}</span>
                                {event.location && <span className="gwp-cal-event-location"><MapPin size={12}/> {event.location}</span>}
                                {event.description?.trim() && <EventDescriptionPreview
                                    description={event.description.trim()}
                                    expanded={expandedDescriptionIds.has(event.id)}
                                    onToggle={() => setExpandedDescriptionIds(current => {
                                        const next = new Set(current);
                                        if (next.has(event.id)) next.delete(event.id);
                                        else next.add(event.id);
                                        return next;
                                    })}/>}
                            </div>
                        </div>;
                    })
                )}
            </div>
        </div>

        {/* Event Form Modal */}
        {showForm && <div className="gwp-cal-form-backdrop">
            <div className="gwp-cal-form">
                <header>
                    <h3>{editingEvent ? t('googleWorkspace.calendar.editEvent') : t('googleWorkspace.calendar.newEvent')}</h3>
                    <button onClick={requestCloseForm}><X size={18}/></button>
                </header>
                <div className="gwp-cal-form-body">
                    <label>
                        <span>{t('googleWorkspace.calendar.eventTitle')}</span>
                        <input
                            type="text"
                            value={form.summary}
                            onChange={e => setForm(f => ({...f, summary: e.target.value}))}
                            placeholder={t('googleWorkspace.calendar.eventTitlePlaceholder')}
                            autoFocus
                        />
                    </label>
                    <label>
                        <span>{t('googleWorkspace.calendar.startTime')}</span>
                        <LocalizedDateTimePicker
                            value={form.start}
                            language={currentLanguage}
                            todayLabel={t('googleWorkspace.calendar.today')}
                            previousMonthLabel={t('googleWorkspace.calendar.prevMonth')}
                            nextMonthLabel={t('googleWorkspace.calendar.nextMonth')}
                            onChange={start => setForm(f => ({...f, start}))}
                        />
                    </label>
                    <label>
                        <span>{t('googleWorkspace.calendar.endTime')}</span>
                        <div className="gwp-cal-date-time-field">
                            <LocalizedDateTimePicker
                                value={form.end}
                                language={currentLanguage}
                                todayLabel={t('googleWorkspace.calendar.today')}
                                previousMonthLabel={t('googleWorkspace.calendar.prevMonth')}
                                nextMonthLabel={t('googleWorkspace.calendar.nextMonth')}
                                invalid={hasAttemptedSave && isEndBeforeStart}
                                onChange={end => setForm(f => ({...f, end}))}
                            />
                            {hasAttemptedSave && isEndBeforeStart && <div className="gwp-cal-date-time-error-tooltip" role="alert">
                                <AlertCircle aria-hidden="true" size={15}/>
                                <span>{t('googleWorkspace.calendar.endBeforeStartError')}</span>
                            </div>}
                        </div>
                    </label>
                    <label>
                        <span>{t('googleWorkspace.calendar.location')}</span>
                        <input type="text" autoComplete="off" value={form.location} onChange={e => setForm(f => ({...f, location: e.target.value}))} placeholder={t('googleWorkspace.calendar.locationPlaceholder')}/>
                    </label>
                    <label>
                        <span>{t('googleWorkspace.calendar.description')}</span>
                        <textarea className="gwp-cal-description-input" value={form.description} onChange={e => setForm(f => ({...f, description: e.target.value}))} rows={8} placeholder={t('googleWorkspace.calendar.descriptionPlaceholder')}/>
                    </label>
                    <section className="gwp-cal-reminders">
                        <div className="gwp-cal-reminders-header">
                            <span>{t('googleWorkspace.calendar.reminders')}</span>
                            <button
                                type="button"
                                onClick={() => setForm(current => ({
                                    ...current,
                                    reminders: [...current.reminders, {method: 'popup', amount: 30, unit: 'minute'}],
                                    useDefaultReminders: false,
                                }))}
                                disabled={form.reminders.length >= maxReminders}
                            >
                                <Bell aria-hidden="true" size={13}/>
                                {t('googleWorkspace.calendar.addReminder')}
                            </button>
                        </div>
                        {form.reminders.length === 0 && <small>
                            {t(provider === 'microsoft' ? 'settings:microsoft.defaultReminderHint' : 'googleWorkspace.calendar.defaultReminderHint')}
                        </small>}
                        {form.reminders.map((reminder, index) => {
                            const hasReminderError = hasAttemptedSave && isReminderInvalid(reminder);
                            return <div className={`gwp-cal-reminder-row${hasReminderError ? ' has-error' : ''}`} key={index}>
                            <CustomSelect
                                className="gwp-cal-reminder-method"
                                ariaLabel={t('googleWorkspace.calendar.reminderType')}
                                portal
                                options={[
                                    {value: 'popup', label: t('googleWorkspace.calendar.notification')},
                                    ...(provider === 'google' ? [{value: 'email', label: t('googleWorkspace.calendar.email')}] : []),
                                ]}
                                value={reminder.method}
                                onChange={method => updateReminder(index, {method: method as ReminderMethod})}
                            />
                            <input
                                aria-label={t('googleWorkspace.calendar.reminderAmount')}
                                type="number"
                                min={0}
                                max={Math.floor(MAX_REMINDER_MINUTES / REMINDER_UNIT_MINUTES[reminder.unit])}
                                step={1}
                                value={reminder.amount}
                                ref={index === firstInvalidReminderIndex ? firstInvalidReminderInputRef : undefined}
                                aria-invalid={hasReminderError}
                                onChange={event => updateReminder(index, {
                                    amount: event.target.value === '' ? '' : Number(event.target.value),
                                })}
                            />
                            <CustomSelect
                                className="gwp-cal-reminder-unit"
                                ariaLabel={t('googleWorkspace.calendar.reminderUnit')}
                                portal
                                options={[
                                    {value: 'minute', label: t('googleWorkspace.calendar.minutes')},
                                    {value: 'hour', label: t('googleWorkspace.calendar.hours')},
                                    {value: 'day', label: t('googleWorkspace.calendar.days')},
                                ]}
                                value={reminder.unit}
                                onChange={unit => updateReminder(index, {unit: unit as ReminderUnit})}
                            />
                            <button
                                type="button"
                                className="gwp-cal-reminder-remove"
                                aria-label={t('googleWorkspace.calendar.removeReminder')}
                                onClick={() => setForm(current => ({
                                    ...current,
                                    reminders: current.reminders.filter((_, reminderIndex) => reminderIndex !== index),
                                    useDefaultReminders: current.reminders.length === 1,
                                }))}
                            >
                                <X aria-hidden="true" size={15}/>
                            </button>
                            {hasReminderError && <div className="gwp-cal-reminder-error-tooltip" role="alert">
                                <AlertCircle aria-hidden="true" size={15}/>
                                <span>{t('googleWorkspace.calendar.reminderRangeError')}</span>
                            </div>}
                        </div>;
                        })}
                    </section>
                </div>
                <footer>
                    <button className="gwp-cal-form-cancel" onClick={requestCloseForm}>{t('googleWorkspace.cancel')}</button>
                    <button className="gwp-primary" onClick={handleSave} disabled={saving}>
                        {saving && <LoaderCircle size={14} className="gwp-spin"/>}
                        {editingEvent ? t('googleWorkspace.calendar.save') : t('googleWorkspace.calendar.create')}
                    </button>
                </footer>
            </div>
        </div>}

        {/* Delete Confirm */}
        {deleteTarget && <ConfirmModal
            title={t('googleWorkspace.delete')}
            description={t('googleWorkspace.calendar.deleteConfirm', {name: deleteTarget.summary || ''})}
            loading={deleting}
            loadingValue="delete"
            loadingLabel={t('googleWorkspace.processing')}
            actionLayout="horizontal"
            options={[
                {label: t('googleWorkspace.cancel'), value: 'cancel'},
                {label: t('googleWorkspace.delete'), value: 'delete', variant: 'danger'},
            ]}
            onSelect={v => { if (v === 'delete') handleDelete(); else setDeleteTarget(null); }}
            onClose={() => setDeleteTarget(null)}
        />}
        {showDiscardConfirm && <ConfirmModal
            title={t('googleWorkspace.calendar.discardChangesTitle')}
            description={t('googleWorkspace.calendar.discardChangesDescription')}
            actionLayout="horizontal"
            options={[
                {label: t('googleWorkspace.calendar.keepEditing'), value: 'keep'},
                {label: t('googleWorkspace.calendar.discardChanges'), value: 'discard', variant: 'danger'},
            ]}
            onSelect={value => { if (value === 'discard') closeForm(); else setShowDiscardConfirm(false); }}
            onClose={() => setShowDiscardConfirm(false)}
        />}
    </div>;
}
