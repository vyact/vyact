import {useMemo, useState} from 'react';
import {useTranslation} from 'react-i18next';
import type {DailyPrice, StockMarket} from '../../services/stockAnalysis';
import CustomSelect from '../CustomSelect/CustomSelect';
import ToggleSwitch from '../common/ToggleSwitch/ToggleSwitch';
import {availableInvestorGroups, HISTORY_PAGE_SIZE, HISTORY_PERIODS, INVESTOR_GROUPS, INVESTOR_SUMMARY_PERIODS, historyChangePercent, investorPeriodStats, isFiniteValue, tradeValue} from './historyData';
import {formatHistoryQuantity} from './historyNumberFormat';
import {readHistoryPreferences, saveHistoryPreferences} from './historyPreferences';
import './StockHistory.css';

const SCROLL_LOAD_THRESHOLD = 120;
const PRICE_FIELDS = ['open', 'high', 'low', 'close', 'volume'] as const;

export default function StockHistory({rows, market}: {rows: DailyPrice[]; market: StockMarket}) {
    const {t, i18n} = useTranslation('main');
    const tr = (key: string, options?: Record<string, unknown>) => t(`stockAnalysis.history.${key}`, options);
    const [preferences, setPreferences] = useState(readHistoryPreferences);
    const {period, investors} = preferences;
    const [visibleCount, setVisibleCount] = useState(HISTORY_PAGE_SIZE);
    const updatePreferences = (next: typeof preferences) => {
        setPreferences(next);
        saveHistoryPreferences(next);
    };
    const [closeOnly, setCloseOnly] = useState(true);
    const sorted = useMemo(() => [...rows].sort((a, b) => a.day.localeCompare(b.day)), [rows]);
    const groups = useMemo(() => availableInvestorGroups(sorted), [sorted]);
    const hasInvestors = groups.length > 0;
    const priceFields = hasInvestors
        ? closeOnly ? PRICE_FIELDS.filter(field => field === 'close' || field === 'volume') : PRICE_FIELDS
        : ['close', 'changePercent', 'volume'] as const;
    const summaryGroups = groups.filter(group => investors === 'all' || investors.includes(group));
    const visibleRows = useMemo(() => [...sorted].reverse().slice(0, visibleCount), [sorted, visibleCount]);
    const number = new Intl.NumberFormat(i18n.resolvedLanguage, {maximumFractionDigits: 2});
    const format = (value: unknown) => isFiniteValue(value) ? number.format(value) : tr('unavailable');
    const formatQuantity = (value: unknown) => isFiniteValue(value)
        ? formatHistoryQuantity(value, i18n.resolvedLanguage ?? i18n.language, key => tr(`numberUnits.${key}`)) : tr('unavailable');
    const date = (day: string) => new Intl.DateTimeFormat(i18n.resolvedLanguage, {timeZone: 'UTC'}).format(new Date(`${day}T00:00:00Z`));
    const changeByDay = new Map(sorted.map((row, index) => [row.day, historyChangePercent(row, sorted[index - 1])]));
    const summaryPeriods = INVESTOR_SUMMARY_PERIODS.filter(value => value <= period && value <= sorted.length);
    const direction = (value: number | null) => value === null || value === 0 ? undefined : value > 0 ? 'up' : 'down';
    return <section className={`stock-history${hasInvestors ? '' : ' stock-history-prices-only'}`} aria-label={tr('tab')} data-market={market}>

        {!!groups.length && <section className="stock-history-summary" aria-label={tr('statistics')}>
            <div className="stock-history-controls"><h2>{tr('statistics')}</h2>
                <div className="stock-history-summary-filters">
            <label className="stock-history-period-picker"><span>{tr('period')}</span><CustomSelect portal value={String(period)} options={HISTORY_PERIODS.map(value => ({value: String(value), label: tr('days', {count: value})}))}
                ariaLabel={tr('period')} onChange={value => updatePreferences({...preferences, period: Number(value)})}/></label>
                <CustomSelect portal value="" selectedValues={investors === 'all' ? ['all', ...INVESTOR_GROUPS] : investors}
                    closeOnSelect={false} ariaLabel={tr('investor')} options={[
                        {value: 'all', label: tr('allInvestors')},
                        ...INVESTOR_GROUPS.map(group => ({value: group, label: tr(`groups.${group}`)})),
                    ]} renderTrigger={() => <span className="custom-select-trigger-label">{investors === 'all'
                        ? tr('allInvestors') : investors.length ? investors.map(group => tr(`groups.${group}`)).join(', ') : tr('investor')}</span>}
                    onChange={value => {
                        if (value === 'all') {
                            updatePreferences({...preferences, investors: investors === 'all' ? [] : 'all'});
                            return;
                        }
                        const selected = investors === 'all' ? INVESTOR_GROUPS : investors;
                        const next = INVESTOR_GROUPS.filter(group => group === value ? !selected.includes(group) : selected.includes(group));
                        updatePreferences({...preferences, investors: next.length === INVESTOR_GROUPS.length ? 'all' : next});
                    }}/>
                </div>
            </div>
            {!summaryGroups.length && <p>{tr('noData')}</p>}
            <div className="stock-investor-summary-scroll" tabIndex={0} role="region" aria-label={tr('statistics')}>
                <table className="stock-investor-summary-table">
                    <thead><tr>{['aggregatePeriod', 'investor', 'netVolume', 'netAmount', 'periodAverage'].map(key => <th scope="col" key={key}>{tr(key)}</th>)}</tr></thead>
                    {summaryPeriods.map((days, periodIndex) => {
                        const periodRows = sorted.slice(-days);
                        return <tbody key={days} data-alternate={periodIndex % 2 === 0}>{summaryGroups.map((group, index) => {
                            const stats = investorPeriodStats(periodRows, group);
                            return <tr key={group}>
                                {index === 0 && <th scope="rowgroup" rowSpan={summaryGroups.length} className="stock-investor-summary-period">{tr('summaryDays', {count: days})}</th>}
                                <th scope="row">{tr(`groups.${group}`)}</th>
                                <td data-direction={direction(stats.netVolume)}>{formatQuantity(stats.netVolume)}</td>
                                <td data-direction={direction(stats.netAmount)}>{formatQuantity(stats.netAmount)}</td>
                                <td data-direction={direction(stats.averagePrice)}>{format(stats.averagePrice)}</td>
                            </tr>;
                        })}</tbody>;
                    })}
                </table>
            </div>
        </section>}
        {hasInvestors && <div className="stock-history-controls stock-history-daily-controls">
            <div className="stock-history-display-option"><span>{tr('closeOnly')}</span><ToggleSwitch checked={closeOnly} label={tr('closeOnly')} onChange={setCloseOnly}/></div>
        </div>}
        <div className="stock-history-table-scroll" onScroll={event => {
            const container = event.currentTarget;
            if (container.scrollTop + container.clientHeight >= container.scrollHeight - SCROLL_LOAD_THRESHOLD) {
                setVisibleCount(count => Math.min(sorted.length, count + HISTORY_PAGE_SIZE));
            }
        }} tabIndex={0} role="region" aria-label={tr('daily')}>
            <table className="stock-history-table" aria-label={tr('daily')}><thead><tr>
                <th scope="col">{t('stockAnalysis.day')}</th>{priceFields.map(field => <th scope="col" key={field}>{hasInvestors && (field === 'close' || field === 'volume') ? <span className="stock-history-pair"><span>{t(`stockAnalysis.${field}`)}</span><span>{tr(field === 'close' ? 'changePercent' : 'tradingValue')}</span></span> : field === 'changePercent' ? tr('changePercent') : t(`stockAnalysis.${field}`)}</th>)}
                {groups.map(group => <th scope="col" key={group}><span className="stock-history-pair">
                    <span>{tr('investorNetVolume', {name: tr(`groups.${group}`)})}</span><span>{tr('netAmount')}</span>
                </span></th>)}
            </tr></thead><tbody>{visibleRows.map(row => <tr key={row.day}>
                <th scope="row">{date(row.day)}</th>{priceFields.map(field => {
                    if (!hasInvestors) {
                        const change = changeByDay.get(row.day);
                        const value = field === 'changePercent' ? change : row[field];
                        return <td key={field} data-direction={field === 'volume' ? undefined : direction(isFiniteValue(change) ? change : null)}>{field === 'changePercent'
                            ? isFiniteValue(value) ? `${number.format(value)}%` : tr('unavailable')
                            : field === 'volume' ? formatQuantity(value) : format(value)}</td>;
                    }
                    if (field === 'close') {
                        const change = changeByDay.get(row.day);
                        const direction = isFiniteValue(change) && change !== 0 ? change > 0 ? 'up' : 'down' : undefined;
                        return <td key={field} data-direction={direction}><span className="stock-history-pair"><span>{format(row.close)}</span><span>{isFiniteValue(change) ? `${number.format(change)}%` : tr('unavailable')}</span></span></td>;
                    }
                    if (field === 'volume') return <td key={field}><span className="stock-history-pair"><span>{formatQuantity(row.volume)}</span><span>{formatQuantity(row.tradingValue)}</span></span></td>;
                    return <td key={field}>{format(row[field])}</td>;
                })}
                {groups.map(group => <td key={group}><span className="stock-history-pair">
                    {(['netVolume', 'netAmount'] as const).map(field => {
                        const value = tradeValue(row.investors?.[group], field);
                        return <span key={field} data-direction={value !== null && value !== 0 ? value > 0 ? 'up' : 'down' : undefined}>{formatQuantity(value)}</span>;
                    })}
                </span></td>)}
            </tr>)}</tbody></table>
        </div>
    </section>;
}
