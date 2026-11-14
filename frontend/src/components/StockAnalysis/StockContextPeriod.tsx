import {useEffect, useState} from 'react';
import {useTranslation} from 'react-i18next';
import StockContextDateInput from './StockContextDateInput';
import CustomSelect from '../CustomSelect/CustomSelect';
import ActionMenu from '../common/ActionMenu/ActionMenu';
import {loadMarketContextDates} from './stockContextDates';
import {clampContextRange, type StockContextRange} from './stockContextRange';
import type {StockMarket, DailyPrice} from '../../services/stockAnalysis';
import './StockContextPeriod.css';

export default function StockContextPeriod({rows, groupScope, market, days, onDaysChange, range, lastRange, onRangeChange, disabled}: {
    groupScope: boolean; market: StockMarket; rows: DailyPrice[]; days: number; onDaysChange: (days: number) => void;
    lastRange: StockContextRange; range: StockContextRange; onRangeChange: (range: StockContextRange) => void; disabled: boolean;
}) {
    const {t} = useTranslation('main');
    const tr = (key: string) => t(`stockAnalysis.discussion.${key}`);
    const [open, setOpen] = useState(false);
    const [loaded, setLoaded] = useState<{market: StockMarket; dates: string[]} | null>(null);
    const rangeSelected = range !== null;
    useEffect(() => {
        if ((!open && !rangeSelected) || !groupScope) return;
        let cancelled = false;
        void loadMarketContextDates(market).then(dates => {
            if (!cancelled) setLoaded({market, dates});
        }).catch(() => {if (!cancelled) setLoaded({market, dates: []});});
        return () => {cancelled = true;};
    }, [open, market, groupScope, rangeSelected]);
    const dates = groupScope ? loaded?.market === market ? loaded.dates : [] : [...new Set(rows.map(row => row.day))].sort();
    const selectedCount = range ? dates.filter(day => day >= range.start && day <= range.end).length : days;
    const selectedCountLabel = t('stockAnalysis.discussion.selectedTradingDays', {count: selectedCount});
    const min = dates[0];
    const max = dates[dates.length - 1];
    useEffect(() => {
        if (disabled) return;
        const clamped = clampContextRange(range, min, max);
        if (clamped && range && (clamped.start !== range.start || clamped.end !== range.end)) onRangeChange(clamped);
    }, [range, min, max, disabled, onRangeChange]);
    return <ActionMenu isOpen={open} onOpenChange={setOpen} preferredSide="top" align="start" disabled={disabled}
        className="stock-context-period" triggerClassName="stock-context-period-trigger"
        menuClassName="stock-context-period-popup" ariaLabel={tr('periodSettings')}
        trigger={<span>{range ? `${range.start} – ${range.end} · ${selectedCountLabel}` : `${tr('contextDays')} ${days}`}</span>}>
            <CustomSelect value={range ? 'range' : 'recent'} disabled={disabled} ariaLabel={tr('periodSettings')}
                options={[{value: 'recent', label: tr('contextDays')}, {value: 'range', label: tr('dateRange'), disabled: !min}]}
                onChange={mode => onRangeChange(mode === 'range' && min && max ? clampContextRange(lastRange ?? {start: dates[Math.max(0, dates.length - days)], end: max}, min, max) : null)}/>
            {range ? <div className="stock-context-period-dates">
                <StockContextDateInput label={tr('startDate')} value={range.start} min={min} max={range.end} disabled={disabled}
                    onChange={start => {if (start && min && start >= min && start <= range.end) onRangeChange({...range, start});}}/>
                <span>–</span>
                <StockContextDateInput label={tr('endDate')} value={range.end} min={range.start} max={max} disabled={disabled}
                    onChange={end => {if (end && max && end >= range.start && end <= max) onRangeChange({...range, end});}}/>
            </div> : <input type="number" aria-label={tr('contextDays')} min={1} max={500} value={days} className="stock-context-period-count" disabled={disabled}
                onChange={event => {const value = Number(event.target.value); if (Number.isInteger(value) && value >= 1 && value <= 500) onDaysChange(value);}}/>}
            {range && <div className="stock-context-period-summary-row">
                {!!min && <small className="stock-context-period-summary" role="status">
                    {selectedCountLabel}
                    {selectedCount > 500 && <> · {t('stockAnalysis.discussion.usedTradingDays', {count: 500})}</>}
                </small>}
                <small className="stock-context-period-limit">{tr('rangeLimit')}</small>
            </div>}
    </ActionMenu>;
}
