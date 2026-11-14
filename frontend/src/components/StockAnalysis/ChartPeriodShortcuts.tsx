import {useEffect, useState} from 'react';
import type {IChartApi} from 'lightweight-charts';
import {useTranslation} from 'react-i18next';
import type {DailyPrice} from '../../services/stockAnalysis';
import './ChartTools.css';

const PERIODS = [1, 3, 6, 12, 0] as const;

export default function ChartPeriodShortcuts({chart, bars}: {chart: IChartApi | null; bars: DailyPrice[]}) {
    const {t} = useTranslation('main');
    const [selected, setSelected] = useState<number | null>(null);
    useEffect(() => {
        if (!chart) return;
        const reset = () => setSelected(null);
        chart.timeScale().subscribeVisibleLogicalRangeChange(reset);
        return () => chart.timeScale().unsubscribeVisibleLogicalRangeChange(reset);
    }, [chart]);
    const select = (months: number) => {
        if (!chart || bars.length < 2) return;
        const last = new Date(`${bars[bars.length - 1].day}T00:00:00Z`);
        const originalDay = last.getUTCDate();
        last.setUTCDate(1);
        last.setUTCMonth(last.getUTCMonth() - months);
        const monthEnd = new Date(Date.UTC(last.getUTCFullYear(), last.getUTCMonth() + 1, 0)).getUTCDate();
        last.setUTCDate(Math.min(originalDay, monthEnd));
        const start = last.toISOString().slice(0, 10);
        const index = months ? bars.findIndex(bar => bar.day >= start) : 0;
        chart.timeScale().setVisibleLogicalRange({from: Math.min(Math.max(0, index), bars.length - 2), to: bars.length - 1});
        setSelected(months);
    };
    return <div className="stock-chart-periods" role="group" aria-label={t('stockAnalysis.chartTools.period')}>
        <span>{t('stockAnalysis.chartTools.period')}</span>
        {PERIODS.map(months => <button type="button" className="modal-action-cancel" key={months} aria-pressed={selected === months}
            disabled={!chart || bars.length < 2} onClick={() => select(months)}>
            {t(`stockAnalysis.chartTools.${months === 0 ? 'all' : months === 12 ? 'year' : 'months'}`, {count: months})}
        </button>)}
    </div>;
}
