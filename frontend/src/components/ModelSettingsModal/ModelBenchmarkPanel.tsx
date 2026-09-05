import {useEffect, useRef, useState} from 'react';
import {Check, Play, Square, Info, Award} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import type {VyactModelProfile} from '../../services/api';
import {benchmarkConditionsMatch, median, modelBenchmark, type BenchmarkJob, type BenchmarkState} from '../../services/modelBenchmark';
import './ModelBenchmarkPanel.css';

type Props = {dflashEnabled: boolean; canTestMtp: boolean; profile: VyactModelProfile; visible: boolean; disabled: boolean; validate: () => boolean; onBusy: (busy: boolean) => void; onSelect: (profile: VyactModelProfile) => void};
export default function ModelBenchmarkPanel({dflashEnabled, canTestMtp, profile, visible, disabled, validate, onBusy, onSelect}: Props) {
    const {t} = useTranslation('main');
    const b = (key: string) => t(`modelBenchmark.${key}`);
    const pendingRef = useRef(false);
    const requestEpoch = useRef(0);
    const [plan, setPlan] = useState<Awaited<ReturnType<typeof modelBenchmark.plan>> | null>(null);
    const [selected, setSelected] = useState<string[]>([]);
    useEffect(() => {
        let cancelled = false;
        setPlan(null);
        void modelBenchmark.plan(profile).then(value => {
            if (!cancelled) {const cases = value.cases.filter(item => canTestMtp || !item.profile.mtp_enabled); setPlan({...value, cases, mtp_supported: value.mtp_supported && canTestMtp}); setSelected(cases.map(item => item.id));}
        }).catch(() => {if (!cancelled) setError(true);});
        return () => {cancelled = true;};
    }, [profile, canTestMtp]);
    const [state, setState] = useState<BenchmarkState | null>(null);
    const [pending, setPending] = useState(false);
    const [error, setError] = useState(false);
    const [stopping, setStopping] = useState(false);
    useEffect(() => {
        let cancelled = false;
        let timer: ReturnType<typeof setTimeout>;
        const poll = async () => {
            const epoch = requestEpoch.current;
            try {
                const value = await modelBenchmark.read(profile.model_path);
                if (!cancelled && !pendingRef.current && epoch === requestEpoch.current) {setState(value); onBusy(value.busy); setError(false);}
            } catch {if (!cancelled) setError(true);}
            if (!cancelled) timer = setTimeout(poll, 1500);
        };
        void poll();
        return () => {cancelled = true; clearTimeout(timer);};
    }, [profile.model_path, onBusy]);
    const job: BenchmarkJob | null = state?.job ?? state?.last_completed ?? null;
    const running = Boolean(state?.busy) || pending;
    const start = async () => {
        if (!plan || !validate()) return;
        requestEpoch.current += 1;
        pendingRef.current = true; setPending(true); setError(false); setStopping(false); onBusy(true);
        try {
            const value = await modelBenchmark.start(profile, selected, plan.plan_id);
            setState(() => ({job: value, last_completed: null, busy: true, stale: false}));
        } catch {setError(true); setState(previous => ({job: previous?.job ?? null, last_completed: previous?.last_completed ?? null, busy: true, stale: previous?.stale ?? false}));}
        finally {pendingRef.current = false; setPending(false);}
    };
    const stop = async () => {
        setStopping(true);
        try {await modelBenchmark.stop();} catch {setError(true); setStopping(false);}
    };
    const shownJob = job;
    const conditionsChanged = Boolean(shownJob && (!benchmarkConditionsMatch(profile, shownJob.base_profile) || state?.stale));
    const displayedCases = running && job?.selected_cases ? job.selected_cases : plan?.cases ?? [];
    const comparisonFields = ([['performance_mode', 'performanceMode'], ['kv_cache_precision', 'kvCachePrecision'], ['mtp_enabled', 'mtpAcceleration']] as const)
        .filter(([field]) => (profile.runtime === 'gguf' || field === 'mtp_enabled') && new Set(displayedCases.map(item => item.profile[field])).size > 1)
        .map(([, label]) => t(`modelSettings.${label}`));
    const format = (value: number | null) => value === null ? b('unavailable') : value.toLocaleString(undefined, {maximumFractionDigits: 2});
    return <section className="model-benchmark" hidden={!visible} aria-label={b('title')}>
        <p className="model-benchmark-description">{comparisonFields.length ? t('modelBenchmark.comparisonFields', {fields: comparisonFields.join(' · ')}) : b('currentOnly')}</p>
        <details className="model-benchmark-method"><summary onMouseDown={event => event.preventDefault()}>{b('method')}</summary><p className="model-benchmark-description">{b('fixed')}</p>
            {dflashEnabled && <p className="model-benchmark-description">{b('dflashNotice')}</p>}
            <p className="model-benchmark-description">{b('comparisonNotice')}</p><p className="model-benchmark-description">{b('scoreNotice')}</p></details>
        <div className="model-benchmark-toolbar">
            <h3 id="model-benchmark-plan-title">{b('selectCases')} <span className="model-benchmark-selection-count">{running ? job?.cases_total ?? selected.length : selected.length}/{running ? job?.cases_total ?? selected.length : plan?.cases.length ?? 0}</span></h3>
        <div className="model-benchmark-actions">
            {!running && <button type="button" className="primary" disabled={disabled || !state || !plan || !selected.length} onClick={() => void start()}><Play size={14} aria-hidden="true"/>{b(job ? 'rerun' : 'start')}</button>}
            {running && <button type="button" disabled={stopping || job?.phase === 'restoring'} onClick={() => void stop()}><Square size={13} aria-hidden="true"/>{b(stopping ? 'stopping' : 'stop')}</button>}
            {!running && job?.status === 'save_failed' && <button type="button" onClick={() => void modelBenchmark.save().catch(() => setError(true))}>{b('saveRetry')}</button>}
        </div>
        </div>
        <fieldset aria-labelledby="model-benchmark-plan-title" className="model-benchmark-plan" disabled={running || disabled}>

            {(running && job?.selected_cases ? job.selected_cases : plan?.cases)?.map(item => <label className="model-benchmark-choice" key={item.id}>
                <input type="checkbox" checked={running || selected.includes(item.id)} onChange={event => setSelected(values => event.target.checked ? [...values, item.id] : values.filter(id => id !== item.id))}/>
                <span className="model-benchmark-checkbox" aria-hidden="true"><Check size={13} strokeWidth={3}/></span>
                <span className="model-benchmark-choice-body"><strong>{t('modelBenchmark.case', {number: item.id})}</strong><span className="model-benchmark-choice-values">
                    {profile.runtime === 'gguf' && <><span>{t('modelSettings.performanceMode')}: {t(`modelSettings.performanceModes.${item.profile.performance_mode ?? 'auto'}`)}</span><span>{t('modelSettings.kvCachePrecision')}: {t(`modelSettings.kvCachePrecisions.${item.profile.kv_cache_precision ?? 'none'}`)}</span></>}
                    {(running ? job?.mtp_supported && canTestMtp : plan?.mtp_supported) && <span>{t('modelSettings.mtpAcceleration')}: {b(item.profile.mtp_enabled ? 'on' : 'off')}</span>}
                </span></span>
            </label>)}
        </fieldset>
        {!running && <p className="model-benchmark-replace-notice"><Info size={16} aria-hidden="true"/><span>{b('replaceWarning')}</span></p>}
        {running && <div className="model-benchmark-progress" role="status" aria-live="polite">
            <div className="model-benchmark-progress-heading"><strong>{job?.current && `${t('modelBenchmark.case', {number: job.current})} · `}{b(job?.phase ?? 'loading')}</strong>
            <span>{t('modelBenchmark.caseProgress', {completed: job?.cases_completed ?? 0, total: job?.cases_total ?? selected.length})}</span>
            <span>{t('modelBenchmark.progress', {completed: job?.completed ?? 0, total: job?.total ?? 0})}</span></div>
            <progress max={Math.max(job?.total ?? 1, 1)} value={job?.completed ?? 0}/>
            <small>{b('restoreNotice')}</small>
            {job?.estimated_remaining_s != null && <small>{t('modelBenchmark.remaining', {minutes: Math.max(1, Math.ceil(job.estimated_remaining_s / 60))})}</small>}
        </div>}
        {error && <p className="model-settings-error" role="alert">{b('requestFailed')}</p>}
        {!running && job && <p role="status">{b(job.status)} · {t('modelBenchmark.caseProgress', {completed: job.cases_completed ?? 0, total: job.cases_total ?? job.rows.length})}</p>}
        {shownJob && <>
            <p className="model-benchmark-description">{t('modelBenchmark.lastRun', {date: new Date(shownJob.created_at).toLocaleString()})}</p>
            {conditionsChanged && <p className="model-settings-error" role="status">{b('stale')}</p>}
            {shownJob.rows.map(row => <article className={`model-benchmark-card${shownJob.recommended === row.id ? ' is-recommended' : ''}`} key={row.id}>
                <div className="model-benchmark-card-heading"><strong>{t('modelBenchmark.case', {number: row.id})}{shownJob.recommended === row.id && <span className="model-benchmark-recommended-badge"><Award size={17} aria-hidden="true"/>{b('recommended')}</span>}</strong>
                    <button type="button" className={shownJob.recommended === row.id ? 'primary' : undefined} disabled={running || !!row.error || !['short', 'long', 'followup'].every(workload => row.samples[workload]?.length) || conditionsChanged} onClick={() => onSelect(row.profile)}>{b('useSettings')}</button></div>
                <div className="model-benchmark-settings">
                    {profile.runtime === 'gguf' && <span>{t('modelSettings.performanceMode')}: {t(`modelSettings.performanceModes.${row.profile.performance_mode ?? 'auto'}`)}</span>}
                    {profile.runtime === 'gguf' && <span>{t('modelSettings.kvCachePrecision')}: {t(`modelSettings.kvCachePrecisions.${row.profile.kv_cache_precision ?? 'none'}`)}</span>}
                    <span>{t('modelSettings.context')}: {row.profile.context_size.toLocaleString()}</span>
                    {shownJob.mtp_supported && <span>{t('modelSettings.mtpAcceleration')}: {b(row.profile.mtp_enabled ? 'on' : 'off')}</span>}
                </div>
                {row.error ? <p className="model-settings-error">{b(row.error)}</p> : <div className="model-benchmark-table-wrap"><table><thead><tr><th>{b('workload')}</th><th>{b('prefill')}</th><th>{b('prefillRate')}</th><th>{b('ttft')}</th><th>{b('decode')}</th><th>{b('totalTime')}</th><th>{b('cached')}</th></tr></thead><tbody>
                    {['short', 'long', 'followup'].map(workload => <tr key={workload}><th scope="row">{b(workload)} <small>×{row.samples[workload]?.length ?? 0}</small>
                        <span className="model-benchmark-token-counts">
                            <span>{b('inputTokens')}: {format(median((row.samples[workload] ?? []).map(sample => sample.input_tokens)))}</span>
                            <span>{b('outputTokens')}: {format(median((row.samples[workload] ?? []).map(sample => sample.output_tokens)))}</span>
                        </span></th>
                        {(['prefill_s', 'prefill_tps', 'ttft_s', 'decode_tps', 'total_s', 'cached_tokens'] as const).map((metric, index) => <td key={metric} data-label={b(['prefill', 'prefillRate', 'ttft', 'decode', 'totalTime', 'cached'][index])}>{format(median((row.samples[workload] ?? []).map(sample => sample[metric])))}</td>)}
                    </tr>)}
                </tbody></table></div>}
            </article>)}
        </>}
    </section>;
}
