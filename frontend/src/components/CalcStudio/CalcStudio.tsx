import '../common/WorkspaceLayout/WorkspaceBrand.css';
import IncomeSources from './IncomeSources';
import SavedPlanDialog from './SavedPlanDialog';
import ConfirmModal from '../common/ConfirmModal/ConfirmModal';
import {listSavedPlans, savePlan, deletePlan, type SavedPlan} from './savedPlans';
import {persistProjection} from './projectionPersistence';
import {toast} from '../common/ToastNotifications/ToastNotifications';
import ChatAttachButton from '../common/ChatAttachButton/ChatAttachButton';
import {getVisibleResultColumns} from './resultColumns';
import {formatProjectionAmount} from './resultFormat';
import {getUserProfile, onUserProfileUpdated} from '../../services/userProfile';
import {loadProfileNameOverride} from './profileNamePreference';
import SettingLabel from '../common/SettingLabel/SettingLabel';
import AmountInput from './AmountInput';
import CustomSelect from '../CustomSelect/CustomSelect';
import {useEffect, useRef, useState, type CSSProperties} from 'react';
import {useTranslation} from 'react-i18next';
import {Asterisk, ChartNoAxesCombined, SlidersHorizontal, BookmarkPlus, Trash2, RefreshCw, X} from 'lucide-react';
import {calculateProjection, calculateScenarios, summarizeProjection, createEmptyProjection, MIN_START_YEAR, MAX_START_YEAR, getIncomeSources, withIncomeSources, incomeSourceError, optionalFields, loadProjection, MIN_WITHDRAWAL_YEAR, PROJECTION_STORAGE_KEY, type ProjectionField} from './projection';
import '../common/ModalOverlay/ModalActions.css';
import './CalcStudio.css';
import AmountButtons from './AmountButtons';
import {exportProjectionToChat, WEALTH_LAB_CHAT_DRAFT_EVENT} from './chatExport';

const inputFieldOrder = [
    'initialAmount',
    'annualContribution', 'contributionYears',
    'annualWithdrawal', 'withdrawalStartYear',
    'annualReturn', 'inflationRate',
] as const satisfies readonly ProjectionField[];

const requiredFields = new Set(['initialAmount', 'annualReturn']);
const yearFields = new Set(['contributionYears', 'withdrawalStartYear', 'investmentYears']);
const amountFields = new Set(['initialAmount', 'annualContribution', 'annualWithdrawal']);
const rateFields = new Set(['annualReturn', 'inflationRate']);

export default function CalcStudio({onClose, style}: {onClose: () => void; style?: CSSProperties}) {
    const {t, i18n} = useTranslation('main');
    const [inputs, setInputs] = useState(loadProjection);
    const [plans, setPlans] = useState<SavedPlan[]>([]);
    const [plansLoading, setPlansLoading] = useState(true);
    const [plansFailed, setPlansFailed] = useState(false);
    const [selectedPlanId, setSelectedPlanId] = useState('');
    const [saveDialog, setSaveDialog] = useState(false);
    const [deleteDialog, setDeleteDialog] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const selectedPlan = plans.find(plan => plan.id === selectedPlanId);
    const refreshPlans = () => {
        setPlansLoading(true); setPlansFailed(false);
        return listSavedPlans().then(setPlans).catch(() => setPlansFailed(true)).finally(() => setPlansLoading(false));
    };
    useEffect(() => {
        let active = true;
        void listSavedPlans().then(value => {if (active) setPlans(value);})
            .catch(() => {if (active) setPlansFailed(true);}).finally(() => {if (active) setPlansLoading(false);});
        return () => {active = false;};
    }, []);
    const [initialNameOverride] = useState(loadProfileNameOverride);
    const nameOverriddenRef = useRef(initialNameOverride);
    const profileNicknameRef = useRef('');
    useEffect(() => {
        let active = true;
        const applyProfileName = (profile: {nickname: string}) => {
            if (!active) return;
            profileNicknameRef.current = profile.nickname || '';
            if (!nameOverriddenRef.current) setInputs(previous => ({...previous, profileName: profileNicknameRef.current}));
        };
        const unsubscribe = onUserProfileUpdated(applyProfileName);
        void getUserProfile().then(applyProfileName).catch(() => {});
        return () => {active = false; unsubscribe();};
    }, []);
    const [results, setResults] = useState<ReturnType<typeof calculateProjection> | null>(null);
    const [selectedScenario, setSelectedScenario] = useState(0);
    const [scenarios, setScenarios] = useState<ReturnType<typeof calculateScenarios>>([]);
    const [incomeValidationAttempted, setIncomeValidationAttempted] = useState(false);
    const incomeSources = getIncomeSources(inputs);
    const missingWithdrawalAge = Number(inputs.annualWithdrawal) > 0 && inputs.withdrawalAge === '';
    const withdrawalAgeError = incomeValidationAttempted && missingWithdrawalAge;
    const [error, setError] = useState('');
    const bodyRef = useRef<HTMLDivElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);
    const currentAge = Number(inputs.startYear) - Number(inputs.birthYear) - 1;
    const endAge = Number(inputs.endAge);
    const invalidIncome = incomeSources.some(source => incomeSourceError(source, currentAge, endAge));
    const thisYear = new Date().getFullYear();
    const displayedAge = thisYear - Number(inputs.birthYear);
    const showCurrentAge = inputs.birthYear !== '' && Number.isInteger(Number(inputs.birthYear)) && Number(inputs.birthYear) >= 1
        && displayedAge >= 0;
    const validAgeRange = inputs.birthYear !== '' && inputs.startYear !== '' && inputs.endAge !== '' && Number.isInteger(currentAge) && Number.isInteger(endAge)
        && Number.isInteger(Number(inputs.birthYear)) && Number(inputs.birthYear) >= 1 && currentAge >= -1 && endAge > currentAge;
    const format = (value: number) => new Intl.NumberFormat(i18n.language, {maximumFractionDigits: 2}).format(value);
    useEffect(() => {
        const previousFocus = document.activeElement as HTMLElement | null;
        panelRef.current?.querySelector<HTMLInputElement>('input')?.focus();
        return () => previousFocus?.focus();
    }, []);
    useEffect(() => { bodyRef.current?.scrollTo({top: 0}); }, [results]);
    const totals = results ? summarizeProjection(results) : null;
    const visibleColumns = getVisibleResultColumns((totals?.shortfall ?? 0) > 0, incomeSources.some(source => Number(source.monthlyAmount) > 0));
    const last = results?.[results.length - 1];
    return (
            <aside className="calc-studio" ref={panelRef} style={style} aria-labelledby="calc-studio-title">
                <header className="calc-studio-header">
                    <span className="workspace-brand-icon"><ChartNoAxesCombined size={18} aria-hidden="true"/></span><h2 id="calc-studio-title">{t('calcStudio.title')}</h2>
                    <button className="titlebar-btn" onClick={onClose} aria-label={t('windowControls.close')}><X size={18}/></button>
                </header>
                <div className={`calc-studio-body${results ? ' calc-studio-body--results' : ''}`} ref={bodyRef}>
                    {!results && <form className="calc-studio-form" onSubmit={event => {
                        event.preventDefault();
                        setIncomeValidationAttempted(true);
                        if (missingWithdrawalAge) {
                            setError('');
                            const target = panelRef.current?.querySelector<HTMLElement>('.calc-studio-withdrawal-age .custom-select-trigger');
                            target?.focus();
                            target?.scrollIntoView({block: 'nearest'});
                            return;
                        }
                        if (invalidIncome) {
                            setError('');
                            const options = panelRef.current?.querySelector<HTMLDetailsElement>('.calc-studio-options');
                            if (options) {
                                options.open = true;
                                requestAnimationFrame(() => {
                                    const target = options.querySelector<HTMLElement>('input[aria-invalid="true"], .calc-studio-control-error .custom-select-trigger');
                                    target?.focus(); target?.scrollIntoView({block: 'nearest'});
                                });
                            }
                            return;
                        }
                        try {
                            const nextScenarios = calculateScenarios(inputs);
                            const rows = nextScenarios[0].rows;
                            setScenarios(nextScenarios); setSelectedScenario(0);
                            setResults(rows); setError('');
                            try { localStorage.setItem(PROJECTION_STORAGE_KEY, JSON.stringify({...inputs, profileNameOverridden: nameOverriddenRef.current})); } catch { /* Calculation works without storage. */ }
                            void persistProjection({inputs, profileNameOverridden: nameOverriddenRef.current}).catch(() => toast.warning(t('calcStudio.backupSaveFailed')));
                        } catch { setError(t('calcStudio.invalid')); }
                    }}>
                        <div className="calc-studio-form-content">
                        <div className="wealth-saved-plans">
                            <div className="wealth-saved-plan-label"><BookmarkPlus size={15}/><span>{t('calcStudio.savedPlans')}</span></div>
                            <div className="wealth-saved-plan-controls">
                                <CustomSelect value={selectedPlanId} options={plans.map(plan => ({value: plan.id, label: plan.name}))}
                                    disabled={plansLoading || plansFailed || plans.length === 0} searchable portal clearable
                                    ariaLabel={t('calcStudio.savedPlans')}
                                    placeholder={t(plansLoading ? 'calcStudio.loadingPlans' : plansFailed ? 'calcStudio.planError' : plans.length ? 'calcStudio.choosePlan' : 'calcStudio.noPlans')}
                                    onClear={() => setSelectedPlanId('')}
                                    onChange={id => {
                                        const plan = plans.find(item => item.id === id);
                                        if (!plan) return;
                                        const next = withIncomeSources({...createEmptyProjection(), ...plan.inputs});
                                        nameOverriddenRef.current = plan.profileNameOverridden;
                                        setSelectedPlanId(id); setInputs(next); setError(''); setIncomeValidationAttempted(false);
                                        try {localStorage.setItem(PROJECTION_STORAGE_KEY, JSON.stringify({...next, profileNameOverridden: plan.profileNameOverridden}));} catch { /* Keep the loaded inputs usable. */ }
                                    }}/>
                                {plansFailed && <button type="button" className="modal-action-cancel wealth-plan-icon" aria-label={t('calcStudio.retryPlans')} onClick={() => void refreshPlans()}><RefreshCw size={16}/></button>}
                                {selectedPlan && <button type="button" className="modal-action-cancel wealth-plan-icon" aria-label={t('calcStudio.deletePlan')} onClick={() => setDeleteDialog(true)}><Trash2 size={16}/></button>}
                            </div>
                        </div>
                        <div className="calc-studio-profile">
                            <div className="calc-studio-fields">
                                <div className="calc-studio-field">
                                    <label htmlFor="wealth-profile-name">{t('calcStudio.profileName')}</label>
                                    <input id="wealth-profile-name" type="text" maxLength={80} value={inputs.profileName} onChange={event => {
                                        nameOverriddenRef.current = true;
                                        setInputs(previous => ({...previous, profileName: event.target.value}));
                                    }}/>
                                </div>
                                <div className="calc-studio-field">
                                    <label htmlFor="wealth-start-year">{t('calcStudio.startYear')}<Asterisk className="calc-studio-required" size={12} strokeWidth={3} aria-hidden="true"/></label>
                                    <input id="wealth-start-year" type="number" inputMode="numeric" required min={MIN_START_YEAR} max={MAX_START_YEAR} step={1} value={inputs.startYear} onChange={event => {
                                        setInputs(previous => ({...previous, startYear: event.target.value})); setResults(null); setError('');
                                    }}/>
                                </div>
                                {(['birthYear', 'endAge'] as const).map(field => <div className="calc-studio-field" key={field}>
                                    <label htmlFor={`wealth-${field}`}>{t(`calcStudio.${field}`)}<Asterisk className="calc-studio-required" size={12} strokeWidth={3} aria-hidden="true"/></label>
                                    <input id={`wealth-${field}`} type="number" inputMode="numeric" required min={field === 'endAge' ? Math.max(0, currentAge + 1) : 1} max={field === 'birthYear' ? Number(inputs.startYear) || MAX_START_YEAR : undefined} step={1} value={inputs[field]} onChange={event => {
                                        setInputs(previous => ({...previous, [field]: event.target.value, withdrawalAge: ''})); setResults(null); setError('');
                                    }}/>
                                </div>)}
                            </div>
                            {(showCurrentAge || validAgeRange) && <div className="calc-studio-profile-summary" aria-live="polite">
                                {showCurrentAge && <span>{t('calcStudio.currentAgeSummary', {year: thisYear, age: displayedAge})}</span>}
                                {showCurrentAge && validAgeRange && <span className="calc-studio-summary-divider" aria-hidden="true">·</span>}
                                {validAgeRange && <strong>{t('calcStudio.horizon', {years: endAge - currentAge})}</strong>}
                            </div>}
                        </div>
                        <div className="calc-studio-fields">
                            {inputFieldOrder.map(field => <div className={`calc-studio-field${field === 'initialAmount' ? ' calc-studio-full-row' : ''}`} key={field}>
                                {field === 'inflationRate' ? <div className="calc-studio-help-label">
                                    <SettingLabel label={t('calcStudio.inflationRate')} help={<span className="calc-studio-inflation-help">
                                        <strong>{t('calcStudio.inflationRate')}</strong>
                                        <span>{t('calcStudio.inflationHelpIntro')}</span>
                                        <span>{t('calcStudio.inflationHelpApplication')}</span>
                                        <span className="calc-studio-inflation-example">{t('calcStudio.inflationHelpExample')}</span>
                                        <span className="calc-studio-inflation-note">{t('calcStudio.inflationHelpNote')}</span>
                                    </span>}/>
                                </div> : <label htmlFor={`calc-studio-${field}`}>
                                <span>{t(`calcStudio.${field === 'withdrawalStartYear' ? 'withdrawalAge' : field}`)}</span>
                                    {requiredFields.has(field) && <Asterisk className="calc-studio-required" size={12} strokeWidth={3} aria-hidden="true"/>}
                                </label>}
                                {field === 'withdrawalStartYear' ? <CustomSelect
                                    value={inputs.withdrawalAge}
                                    disabled={!validAgeRange || endAge - currentAge < MIN_WITHDRAWAL_YEAR}
                                    options={Array.from({length: validAgeRange ? Math.max(0, endAge - currentAge - MIN_WITHDRAWAL_YEAR + 1) : 0}, (_, index) => {
                                        const value = String(currentAge + MIN_WITHDRAWAL_YEAR + index);
                                        return {value, label: t('calcStudio.ageAndYear', {age: Number(value), year: Number(inputs.birthYear) + Number(value)})};
                                    })}
                                    searchable portal clearable className={`calc-studio-withdrawal-age${withdrawalAgeError ? ' calc-studio-control-error' : ''}`} ariaLabel={t(withdrawalAgeError ? 'calcStudio.selectWithdrawalAge' : 'calcStudio.withdrawalAge')}
                                    placeholder={t(withdrawalAgeError ? 'calcStudio.selectWithdrawalAge' : 'calcStudio.withdrawalAge')}
                                    onClear={() => {setInputs(previous => ({...previous, withdrawalAge: ''})); setResults(null); setError('');}}
                                    onChange={value => {setInputs(previous => ({...previous, withdrawalAge: value})); setResults(null); setError('');}}
                                /> : amountFields.has(field) ? <AmountInput
                                    id={`calc-studio-${field}`} required={requiredFields.has(field)} value={inputs[field]}
                                    onChange={value => {setInputs(previous => ({...previous, [field]: value})); setResults(null); setError('');}}
                                /> : <input id={`calc-studio-${field}`} type="number" aria-label={t(`calcStudio.${field}`)} inputMode={yearFields.has(field) ? 'numeric' : 'decimal'} required={requiredFields.has(field)}
                                    min={field === 'annualReturn' ? -100 : 0}
                                    max={rateFields.has(field) ? field === 'annualReturn' ? 1000 : 100 : undefined}
                                    step={yearFields.has(field) ? 1 : 'any'} value={inputs[field]}
                                    onChange={event => {setInputs(previous => ({...previous, [field]: event.target.value})); setResults(null); setError('');}}/>}
                                {amountFields.has(field) && <AmountButtons fieldLabel={t(`calcStudio.${field}`)} onAdjust={amount => {
                                    setInputs(previous => {
                                        const current = Number(previous[field] || 0);
                                        const next = amount === null ? '' : String((Number.isFinite(current) ? current : 0) + amount);
                                        return {...previous, [field]: next};
                                    });
                                    setResults(null); setError('');
                                }}/>}
                            </div>)}
                        </div>
                        <details className="calc-studio-options" open={incomeSources.length > 0 || optionalFields.some(field => inputs[field] !== '')}>
                            <summary>{t('calcStudio.optionalSettings')}</summary>
                            <div className="calc-studio-fields">
                                {(['comparisonReturn1', 'comparisonReturn2'] as const).map(field => <div className="calc-studio-field" key={field}>
                                    <label htmlFor={`wealth-${field}`}>{t(`calcStudio.${field}`)}</label>
                                    <input id={`wealth-${field}`} type="number" min={-100} max={1000} step="any" value={inputs[field]} onChange={event => setInputs(previous => ({...previous, [field]: event.target.value}))}/>
                                </div>)}
                            </div>
                            <IncomeSources sources={incomeSources} currentAge={currentAge} endAge={endAge} birthYear={Number(inputs.birthYear)} validAgeRange={validAgeRange} showErrors={incomeValidationAttempted}
                                onChange={sources => setInputs(previous => withIncomeSources(previous, sources))}/>
                            <p className="calc-studio-description">{t('calcStudio.incomeHelp')}</p>
                        </details>
                        <p className="calc-studio-description">{t('calcStudio.timing')}</p>
                        {error && <p className="calc-studio-error" role="alert">{error}</p>}
                        </div>
                        <div className="modal-action-footer">
                            <button type="button" className="modal-action-cancel" onClick={() => {
                                nameOverriddenRef.current = false;
                                setIncomeValidationAttempted(false); setSelectedPlanId('');
                                setInputs({...createEmptyProjection(), profileName: profileNicknameRef.current}); setResults(null); setError('');
                                try {localStorage.removeItem(PROJECTION_STORAGE_KEY);} catch { /* Storage may be unavailable. */ }
                                void persistProjection(null).catch(() => toast.warning(t('calcStudio.backupSaveFailed')));
                            }}>{t('calcStudio.reset')}</button>
                            <button type="submit" className="modal-action-submit">{t('calcStudio.calculate')}</button>
                        </div>
                    </form>}
                    {last && totals && <section key="wealth-results-without-tooltips" aria-live="polite" className="calc-studio-results" data-tooltip-disabled>
                        <div className="calc-studio-export">
                            <button type="button" className="modal-action-cancel calc-studio-edit-button" onClick={() => setResults(null)}><SlidersHorizontal size={15} aria-hidden="true"/>{t('calcStudio.editConditions')}</button>
                            <div className="wealth-result-actions">
                            <button type="button" className="modal-action-cancel wealth-save-button" onClick={() => setSaveDialog(true)}><BookmarkPlus size={15}/>{t('calcStudio.savePlan')}</button>
                            <ChatAttachButton onClick={() => {
                                window.dispatchEvent(new CustomEvent(WEALTH_LAB_CHAT_DRAFT_EVENT, {detail: {text: exportProjectionToChat(inputs, t)}}));
                            }}/>
                            </div>
                        </div>
                        {scenarios.length > 1 && <div className="calc-studio-comparison">
                            <table><thead><tr>{['annualReturn', 'balance', 'presentValue', 'depletionAge'].map(key => <th key={key}>{t(`calcStudio.${key}`)}</th>)}</tr></thead>
                            <tbody>{scenarios.map((scenario, index) => {
                                const final = scenario.rows[scenario.rows.length - 1];
                                const summary = summarizeProjection(scenario.rows);
                                return <tr key={scenario.annualReturn} aria-selected={selectedScenario === index} onClick={() => {setSelectedScenario(index); setResults(scenario.rows);}}>
                                    <td><button type="button" className="modal-action-cancel" aria-pressed={selectedScenario === index}>{format(scenario.annualReturn)}%</button></td>
                                    <td>{formatProjectionAmount(final.balance, i18n.language)}</td>
                                    <td>{formatProjectionAmount(final.presentValue, i18n.language)}</td>
                                    <td>{summary.depleted ? (summary.depleted.age !== undefined ? t('calcStudio.ageValue', {age: format(summary.depleted.age)}) : String(summary.depleted.calendarYear)) : t('calcStudio.fundedThroughEnd')}</td>
                                </tr>;
                            })}</tbody></table>
                        </div>}
                        <div className="calc-studio-summary">
                            {[['balance', last.balance], ['presentValue', last.presentValue], ['principal', last.principal], ['interest', totals.interest], ['withdrawal', totals.withdrawal], ['totalShortfall', totals.shortfall]].filter(([key]) => (key !== 'totalShortfall' || totals.shortfall > 0) && (scenarios.length <= 1 || (key !== 'balance' && key !== 'presentValue'))).map(([key, value]) =>
                                <div key={key} className={`calc-studio-summary-${key}${Number(value) < 0 ? ' calc-studio-summary-negative' : ''}`}><span>{t(`calcStudio.${key}`)}</span><strong>{formatProjectionAmount(Number(value), i18n.language)}</strong></div>)}
                        </div>
                        {totals.shortfall > 0 && totals.depleted && <p className="calc-studio-funding-status calc-studio-funding-status--depleted">
                            {t('calcStudio.depletedAt', {year: totals.depleted.calendarYear, age: totals.depleted.age})}
                        </p>}
                        <div className="calc-studio-table-heading">
                            <h3 className="calc-studio-table-title" id="wealth-yearly-results">{t('calcStudio.yearlyResults')}</h3>
                            <span className="calc-studio-table-assumptions">{t('calcStudio.resultAssumptions', {rate: format(scenarios[selectedScenario]?.annualReturn ?? Number(inputs.annualReturn)), inflation: format(Number(inputs.inflationRate || 0))})}</span>
                        </div>
                        <div className="calc-studio-table"><table aria-labelledby="wealth-yearly-results">
                            <thead><tr>{visibleColumns.map(({key, label}) => <th key={key} className={`calc-studio-column-${key}`}>{t(`calcStudio.${label}`)}</th>)}</tr></thead>
                            <tbody>{results?.map(row => <tr key={row.year}>{visibleColumns.map(({key}) => {
                                const value = row[key] ?? 0;
                                const isAmount = key !== 'calendarYear' && key !== 'age';
                                return <td key={key} className={`calc-studio-column-${key}${isAmount && value < 0 ? ' calc-studio-value-negative' : isAmount && value === 0 ? ' calc-studio-value-zero' : ''}`}>
                                    {key === 'calendarYear' ? String(value) : key === 'age' ? format(value) : formatProjectionAmount(value, i18n.language)}
                                </td>;
                            })}</tr>)}</tbody>
                        </table></div>
                    </section>}
                </div>
                {saveDialog && <SavedPlanDialog plan={selectedPlan} onClose={() => setSaveDialog(false)} onSave={async (name, overwrite) => {
                    const plan = await savePlan(name, inputs, nameOverriddenRef.current, overwrite ? selectedPlanId : undefined);
                    setPlans(previous => [plan, ...previous.filter(item => item.id !== plan.id)]);
                    setSelectedPlanId(plan.id); toast.success(t('calcStudio.planSaved'));
                }}/>}
                {deleteDialog && selectedPlan && <ConfirmModal title={t('calcStudio.deletePlan')} description={t('calcStudio.deletePlanConfirm', {name: selectedPlan.name})}
                    actionLayout="horizontal" loading={deleting} loadingValue="delete" options={[
                        {label: t('calcStudio.cancelPlan'), value: 'cancel'},
                        {label: t('calcStudio.deletePlan'), value: 'delete', variant: 'danger'},
                    ]} onClose={() => setDeleteDialog(false)} onSelect={value => {
                        if (value !== 'delete') {setDeleteDialog(false); return;}
                        setDeleting(true);
                        void deletePlan(selectedPlan.id).then(() => {
                            setPlans(previous => previous.filter(plan => plan.id !== selectedPlan.id));
                            setSelectedPlanId(''); setDeleteDialog(false);
                        }).catch(() => toast.error(t('calcStudio.planError'))).finally(() => setDeleting(false));
                    }}/>}
            </aside>
    );
}
