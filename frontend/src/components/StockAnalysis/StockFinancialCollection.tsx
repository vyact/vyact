import {useEffect, useState} from 'react';
import {Database, Pause, Play, RefreshCw, ChevronDown, CircleAlert} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import ActionMenu from '../common/ActionMenu/ActionMenu';
import ToggleSwitch from '../common/ToggleSwitch/ToggleSwitch';
import {financialCollectionRequest, type FinancialCollectionStatus} from '../../services/stockFinancialCollection';
import type {StockMarket, StockSymbol} from '../../services/stockAnalysis';
import './StockFinancialCollection.css';

const STATUS_POLL_MS = 4000;
interface CollectionProps {market: StockMarket; directory: StockSymbol[]}

export default function StockFinancialCollection({market, directory}: CollectionProps) {
    return <CollectionControl key={market} market={market} directory={directory}/>;
}
function CollectionControl({market, directory}: CollectionProps) {
    const {t, i18n} = useTranslation('main');
    const tr = (key: string) => t(`stockAnalysis.collection.${key}`);
    const [status, setStatus] = useState<FinancialCollectionStatus | null>(null);
    const [busy, setBusy] = useState(false);
    const [open, setOpen] = useState(false);
    const [error, setError] = useState(false);
    useEffect(() => {
        const controller = new AbortController();
        let timer: ReturnType<typeof setTimeout>;
        const poll = async () => {
            try {setStatus(await financialCollectionRequest(market, undefined, undefined, controller.signal));}
            catch {if (!controller.signal.aborted) setError(true);}
            if (!controller.signal.aborted) timer = setTimeout(poll, STATUS_POLL_MS);
        };
        void poll();
        return () => {controller.abort(); clearTimeout(timer);};
    }, [market]);
    const update = async (action?: 'start' | 'pause' | 'resume' | 'retry', auto?: boolean) => {
        setBusy(true); setError(false);
        try {setStatus(await financialCollectionRequest(market, action, auto));}
        catch {setError(true);} finally {setBusy(false);}
    };
    const job = status?.job;
    const currentStock = directory.find(stock => stock.symbol === job?.currentSymbol);
    const running = job?.status === 'running';
    const paused = job?.status === 'paused';
    const progressRatio = job && job.total > 0 ? Math.max(0, Math.min(1, job.processed / job.total)) : 0;
    const progressPercent = new Intl.NumberFormat(i18n.resolvedLanguage, {style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1}).format(progressRatio);
    const number = (value: number) => new Intl.NumberFormat(i18n.resolvedLanguage).format(value);
    return <div className="stock-financial-collection" data-state={running ? 'running' : paused ? 'paused' : 'idle'} data-error={error || undefined}>
        <ActionMenu isOpen={open} onOpenChange={setOpen} ariaLabel={error ? `${tr('title')} · ${tr('error')}` : tr('title')}
            triggerClassName="stock-collection-trigger" menuClassName="hist-menu-popup stock-collection-popup"
            trigger={<>
                {error ? <CircleAlert size={15} aria-hidden="true"/> : running ? <RefreshCw size={15} className="stock-collection-sync-icon" aria-hidden="true"/> : <Database size={15} aria-hidden="true"/>}
                <span className="stock-collection-label">{tr('title')}</span>
                {(running || paused) && job && <span className="stock-collection-count">{number(job.processed)}<span>/ {number(job.total)}</span></span>}
                <ChevronDown size={12} className="stock-collection-chevron" aria-hidden="true"/>

            </>}
            ><div className="stock-collection-menu" role="group" aria-label={tr('title')}>
                <strong>{t(`stockAnalysis.${market}`)} · {tr('title')}</strong>
                <div className="stock-collection-auto"><span>{tr('auto')}</span><ToggleSwitch checked={status?.settings.autoUpdate ?? false}
                    disabled={busy || !status} label={tr('auto')} onChange={checked => void update(undefined, checked)}/></div>
                <ul className="stock-collection-guide">{['hintScope', 'hintResume', 'hintPause'].map(key => <li key={key}>{tr(key)}</li>)}</ul>
                {job && <div className="stock-collection-status" data-state={job.status} data-tooltip-disabled="">
                    <div className="stock-collection-status-heading" role="status"><span>{tr(job.status)}</span><div className="stock-collection-progress-summary"><span className="stock-collection-processed">{number(job.processed)} / {number(job.total)}</span><span className="stock-collection-percent" aria-label={tr('progress')}>{progressPercent}</span></div></div>

                    {job.currentSymbol && running && <div className="stock-collection-current-stock">
                        {currentStock && <span className="stock-collection-current-name">{currentStock.name}</span>}
                        <small className="stock-collection-current-code">{job.currentSymbol}</small>
                    </div>}
                    <div className="stock-collection-stats"><small>{tr('failed')} <strong>{number(job.failed)}</strong></small><small>{tr('empty')} <strong>{number(job.empty)}</strong></small></div>
                </div>}
                <button type="button" className="modal-action-submit stock-collection-update" disabled={busy || !status} onClick={() => void update(running ? 'pause' : paused ? 'resume' : 'start')}>
                    {running ? <Pause size={14}/> : <Play size={14}/>} {tr(running ? 'pause' : paused ? 'resume' : 'start')}
                </button>
                {!!job?.failed && !running && !paused && <button type="button" className="modal-action-cancel" disabled={busy} onClick={() => void update('retry')}><RefreshCw size={14}/>{tr('retry')}</button>}
                {error && <p role="alert">{tr('error')}</p>}
            </div></ActionMenu>

    </div>;
}
