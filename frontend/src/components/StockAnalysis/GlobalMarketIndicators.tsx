import {useEffect, useState} from 'react';
import {Activity, Droplets, Gem, DollarSign, Landmark} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import {stockAnalysis, type StockSymbol, type MarketIndex} from '../../services/stockAnalysis';
import StockSparkline from './StockSparkline';
import './GlobalMarketIndicators.css';

const REFRESH_MS = 60_000;
const INDICATORS = [
    {symbol: '^VIX', key: 'vix', Icon: Activity},
    {symbol: 'CL=F', key: 'oil', Icon: Droplets},
    {symbol: 'GC=F', key: 'gold', Icon: Gem},
    {symbol: 'DX-Y.NYB', key: 'dollar', Icon: DollarSign},
    {symbol: '^TNX', key: 'treasury', Icon: Landmark},
] as const;

export default function GlobalMarketIndicators({hidden = false, onOpen}: {hidden?: boolean; onOpen: (stock: StockSymbol) => void}) {
    const {t, i18n} = useTranslation('main');
    const [quotes, setQuotes] = useState<MarketIndex[]>([]);
    const [failed, setFailed] = useState(false);
    useEffect(() => {
        const controller = new AbortController();
        let pending = false;
        let refreshAt = 0;
        let timer: number | undefined;
        const refresh = async () => {
            if (pending || document.hidden || Date.now() < refreshAt) return;
            pending = true;
            try {
                const next = await stockAnalysis.globalIndicators(controller.signal);
                if (!controller.signal.aborted) {
                    setQuotes(next); setFailed(next.some(quote => quote.stale));
                    const deadlines = next.map(quote => quote.nextRefreshAt).filter((value): value is number => value != null && Number.isFinite(value));
                    refreshAt = deadlines.length ? Math.min(...deadlines) * 1000 : Date.now() + REFRESH_MS;
                }
            } catch {if (!controller.signal.aborted) {setFailed(true); refreshAt = Date.now() + REFRESH_MS;}}
            finally {
                pending = false;
                if (!controller.signal.aborted) {
                    window.clearTimeout(timer);
                    timer = window.setTimeout(() => void refresh(), Math.max(1000, Math.min(86_400_000, refreshAt - Date.now())));
                }
            }
        };
        void refresh();

        document.addEventListener('visibilitychange', refresh);
        return () => {controller.abort(); window.clearTimeout(timer); document.removeEventListener('visibilitychange', refresh);};
    }, []);
    const tr = (key: string) => t(`stockAnalysis.globalIndicators.${key}`);
    const format = (value: number) => value.toLocaleString(i18n.resolvedLanguage, {minimumFractionDigits: 2, maximumFractionDigits: 2});
    return <section className="stock-global" hidden={hidden} aria-label={tr('title')}>
        <div className="stock-global-grid">{INDICATORS.map(({symbol, key, Icon}) => {
            const quote = quotes.find(item => item.symbol === symbol);
            const isYield = symbol === '^TNX';
            const change = isYield ? (quote?.change != null ? quote.change * 100 : null) : quote?.changePercent;
            const direction = change == null || change === 0 ? 'flat' : change > 0 ? 'up' : 'down';
            return <button type="button" className="stock-global-card" data-indicator={key} key={symbol} onClick={() => onOpen({symbol, name: tr(key)})}>
                <div className="stock-global-label"><Icon size={14} aria-hidden="true"/><span className="stock-global-name">{tr(key)}</span><span>{tr(key === 'oil' || key === 'gold' ? 'usd' : 'points')}</span></div>
                <div className="stock-global-value"><strong>{quote?.price != null ? `${format(quote.price)}${isYield ? '%' : ''}` : '—'}</strong>
                    <span className="stock-global-change" data-direction={direction}>{change != null ? `${change > 0 ? '+' : ''}${format(change)}${isYield ? ' bp' : '%'}` : '—'}</span></div>
                <StockSparkline closes={quote?.closes} change={change}/>
            </button>;
        })}</div>
        {failed && <p className="stock-global-error" role="status">{tr('error')}</p>}
    </section>;
}
