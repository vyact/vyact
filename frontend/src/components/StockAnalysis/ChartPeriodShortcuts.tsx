import {useEffect, useSyncExternalStore} from 'react';
import type {IChartApi} from 'lightweight-charts';
import {useTranslation} from 'react-i18next';
import type {DailyPrice} from '../../services/stockAnalysis';
import './ChartTools.css';

import {CHART_PERIODS, readChartPeriod, saveChartPeriod, subscribeChartPeriod} from './chartPeriodPreference';

export default function ChartPeriodShortcuts({chart, bars, resetVersion = 0}: {chart: IChartApi | null; bars: DailyPrice[]; resetVersion?: number}) {
    const {t} = useTranslation('main');
    const selected = useSyncExternalStore(subscribeChartPeriod, readChartPeriod);
    useEffect(() => {
        if (!chart || bars.length < 2) return;
        const months = selected;
        const last = new Date(`${bars[bars.length - 1].day}T00:00:00Z`);
        const originalDay = last.getUTCDate();
        last.setUTCDate(1);
        last.setUTCMonth(last.getUTCMonth() - months);
        const monthEnd = new Date(Date.UTC(last.getUTCFullYear(), last.getUTCMonth() + 1, 0)).getUTCDate();
        last.setUTCDate(Math.min(originalDay, monthEnd));
        const start = last.toISOString().slice(0, 10);
        const index = months ? bars.findIndex(bar => bar.day >= start) : 0;
        chart.timeScale().setVisibleLogicalRange({from: Math.min(Math.max(0, index), bars.length - 2), to: bars.length - 1});
    }, [chart, bars, selected, resetVersion]);
    return <div className="stock-chart-periods" role="group" aria-label={t('stockAnalysis.chartTools.period')}>
        <span>{t('stockAnalysis.chartTools.period')}</span>
        {CHART_PERIODS.map(months => <button type="button" className="modal-action-cancel" key={months} aria-pressed={selected === months}
            disabled={!chart || bars.length < 2} onClick={() => saveChartPeriod(months)}>
            {t(`stockAnalysis.chartTools.${months === 0 ? 'all' : months === 12 ? 'year' : 'months'}`, {count: months})}
        </button>)}
    </div>;
}
