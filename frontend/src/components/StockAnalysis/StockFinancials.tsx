import {useEffect, useRef, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {RefreshCw} from 'lucide-react';
import ModalTabs from '../common/ModalTabs/ModalTabs';
import StockLoadingIndicator from './StockLoadingIndicator';
import {FINANCIAL_METRICS, getStockFinancials, type FinancialFrequency, type StockFinancialData} from '../../services/stockFinancials';
import {financialChange, formatFinancialAmount} from '../../utils/stockFinancials';
import type {StockMarket} from '../../services/stockAnalysis';
import './StockFinancials.css';

const PERIOD_PAGE_SIZE = 5;

export default function StockFinancials({symbol, market}: {symbol: string; market: StockMarket}) {
    const {t, i18n} = useTranslation('main');
    const tr = (key: string) => t(`stockAnalysis.financials.${key}`);
    const [frequency, setFrequency] = useState<FinancialFrequency>('yearly');
    const [data, setData] = useState<StockFinancialData | null>(null);
    const [error, setError] = useState(false);
    const [retry, setRetry] = useState(0);
    const periodKey = `${symbol}:${frequency}`;
    const [periodWindow, setPeriodWindow] = useState({key: periodKey, count: PERIOD_PAGE_SIZE});
    const visiblePeriodCount = periodWindow.key === periodKey ? periodWindow.count : PERIOD_PAGE_SIZE;
    const forceRefresh = useRef(false);
    const requestRefresh = () => {forceRefresh.current = true; setRetry(value => value + 1);};
    useEffect(() => {
        const controller = new AbortController();
        setData(null);
        setError(false);
        let timer: ReturnType<typeof setTimeout>;
        const load = async (force = false) => {
            try {
                const result = await getStockFinancials(symbol, frequency, controller.signal, force);
                if (controller.signal.aborted) return;
                setData(result);
                if (result.refreshing) timer = setTimeout(() => void load(), 2000);
            } catch {if (!controller.signal.aborted) setError(true);}
        };
        const force = forceRefresh.current;
        forceRefresh.current = false;
        void load(force);
        return () => {controller.abort(); clearTimeout(timer);};
    }, [symbol, frequency, retry]);
    const language = i18n.resolvedLanguage ?? i18n.language;
    const percentFormatter = new Intl.NumberFormat(language, {maximumFractionDigits: 1, signDisplay: 'exceptZero'});
    const statements = Object.keys(FINANCIAL_METRICS) as (keyof typeof FINANCIAL_METRICS)[];
    return <section className="stock-financials" data-market={market} aria-label={tr('tab')} aria-busy={!data && !error}>
        <div className="stock-financials-controls">
            <div className="stock-financials-status" role="status">
                {data?.checkedAt && <small>{tr('checkedAt')}: {new Intl.DateTimeFormat(i18n.resolvedLanguage, {dateStyle: 'short', timeStyle: 'short'}).format(new Date(data.checkedAt))}</small>}
                {data?.refreshing && <small>{tr('refreshing')}</small>}
                {data?.refreshFailed && !data.refreshing && <small>{tr('refreshFailed')}</small>}
                <button type="button" className="modal-action-cancel" disabled={data?.refreshing || (!data && !error)} aria-label={tr('refresh')} onClick={requestRefresh}><RefreshCw size={14}/></button>
            </div>
            <ModalTabs tabs={(['yearly', 'quarterly'] as const).map(key => ({key, label: tr(key)}))} activeKey={frequency} onChange={setFrequency}/>
        </div>
        {!data && !error && <div className="stock-financials-loading"><StockLoadingIndicator title={tr('tab')} iconOnly/></div>}
        {error && <div role="alert"><p>{tr('error')}</p><button type="button" className="modal-action-cancel" onClick={requestRefresh}>{t('stockAnalysis.retry')}</button></div>}
        {data && statements.map(statement => {
            const periods = data.statements[statement];
            const visiblePeriods = periods.slice(0, visiblePeriodCount);
            return <section className="stock-financials-statement" key={statement} aria-labelledby={`financial-${statement}-${symbol}`}>
                <h3 id={`financial-${statement}-${symbol}`}>{tr(statement)}</h3>
                {!periods.length ? <p className="stock-financials-note">{tr('empty')}</p> : <div className="stock-financials-table-wrap"><table>
                    <thead><tr><th scope="col">{tr('metric')}{data.currency && <small className="stock-financials-currency">{data.currency}</small>}</th>{visiblePeriods.map(period => <th scope="col" key={period.period}>{new Intl.DateTimeFormat(language, {year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'UTC'}).format(new Date(`${period.period}T00:00:00Z`))}</th>)}</tr></thead>
                    <tbody>{FINANCIAL_METRICS[statement].map(metric => <tr key={metric}><th scope="row">{tr(metric)}</th>{visiblePeriods.map(period => <td key={period.period}>
                        <span className="stock-financials-value">{period.values[metric] == null ? '—' : formatFinancialAmount(period.values[metric], metric, language, tr('hundredMillion'))}</span>
                        <div className="stock-financials-changes">{(frequency === 'quarterly' ? ['qoq', 'yoy'] as const : ['yoy'] as const).map(comparison => {
                            const change = financialChange(periods, period, metric, comparison, frequency);
                            if (change == null) return null;
                            const direction = change > 0 ? 'increase' : change < 0 ? 'decrease' : 'unchanged';
                            return <span className="stock-financials-change" data-direction={direction} key={comparison} title={tr(direction)}>
                                <span>{tr(comparison)}</span><span>{`${change > 0 ? '↑ ' : change < 0 ? '↓ ' : ''}${percentFormatter.format(change)}%`}</span>
                            </span>;
                        })}</div>
                    </td>)}</tr>)}</tbody>
                </table></div>}
            </section>;
        })}
        {data && statements.some(kind => data.statements[kind].length > visiblePeriodCount) && <button type="button" className="modal-action-cancel" onClick={() => setPeriodWindow({key: periodKey, count: visiblePeriodCount + PERIOD_PAGE_SIZE})}>{tr('olderPeriods')}</button>}
        <p className="stock-financials-note">{tr('source')}</p>
    </section>;
}
