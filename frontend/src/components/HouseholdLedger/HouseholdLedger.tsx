import '../common/WorkspaceLayout/WorkspaceBrand.css';
import ChatAttachButton from '../common/ChatAttachButton/ChatAttachButton';
import {addToChat} from '../../utils/chatDraft';
import {useEffect, useMemo, useRef, useState, type CSSProperties} from 'react';
import {useTranslation} from 'react-i18next';
import {ChevronLeft, ChevronRight, Plus, RefreshCw, PiggyBank, X} from 'lucide-react';
import CustomSelect from '../CustomSelect/CustomSelect';
import LedgerFilters from './LedgerFilters';
import LedgerCurrencySelect from './LedgerCurrencySelect';
import {searchLedger, VYVOW_TOKEN_CHANGED, type LedgerFilter, type LedgerData, type LedgerEntry, type LedgerPeriod} from '../../services/vyvow';
import {groupEntries, ledgerBalanceClass, ledgerTotals, localDate} from './ledgerGroups';
import ToggleSwitch from '../common/ToggleSwitch/ToggleSwitch';
import LedgerMoney from './LedgerMoney';
import LedgerTransactionList from './LedgerTransactionList';
import LedgerEntryForm, {ledgerErrorKey} from './LedgerEntryForm';
import '../common/ModalOverlay/ModalActions.css';
import './HouseholdLedger.css';

export default function HouseholdLedger({onClose, style}: {onClose: () => void; style?: CSSProperties}) {
    const {t, i18n} = useTranslation('main');
    const metadataLoaded = useRef(false);
    const [month, setMonth] = useState(() => localDate().slice(0, 7));
    const [filter, setFilter] = useState<LedgerFilter>({kind: 'default'});
    const [period, setPeriod] = useState<LedgerPeriod>('daily');
    const [excludeTagged, setExcludeTagged] = useState(false);
    const [currency, setCurrency] = useState('KRW');
    const [data, setData] = useState<LedgerData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [revision, setRevision] = useState(0);
    const [editing, setEditing] = useState<LedgerEntry | null | undefined>(undefined);
    useEffect(() => {
        const controller = new AbortController();
        setLoading(true); setError(''); setEditing(undefined);
        if (filter.kind === 'tag' && !filter.tag) {
            setData(previous => ({entries: [], currencies: previous?.currencies || [], tags: previous?.tags || []}));
            setLoading(false);
            return () => controller.abort();
        }
        searchLedger(`${month}-01`, period, currency, controller.signal, filter, !metadataLoaded.current).then(result => {
            if (!controller.signal.aborted) {
                const initialized = !metadataLoaded.current;
                metadataLoaded.current = true;
                setData(previous => ({...result,
                    currencies: initialized ? result.currencies : previous?.currencies || result.currencies,
                    tags: initialized ? result.tags : previous?.tags || result.tags,
                }));
            }
        }).catch(cause => { if (!controller.signal.aborted) setError(ledgerErrorKey(cause)); })
            .finally(() => { if (!controller.signal.aborted) setLoading(false); });
        return () => controller.abort();
    }, [month, period, currency, revision, filter]);
    useEffect(() => {
        const handleChange = () => {metadataLoaded.current = false; setEditing(undefined); setData(null); setRevision(value => value + 1);};
        window.addEventListener(VYVOW_TOKEN_CHANGED, handleChange);
        return () => window.removeEventListener(VYVOW_TOKEN_CHANGED, handleChange);
    }, []);
    const visibleEntries = useMemo(() => (data?.entries || []).filter(entry => filter.kind === 'tag' ? entry.tag === filter.tag : period === 'daily' || !excludeTagged || !entry.tag), [data, period, excludeTagged, filter]);
    const groups = useMemo<[string, LedgerEntry[]][]>(() => {
        if (filter.kind === 'tag' && visibleEntries.length) {
            return [['tag', groupEntries(visibleEntries, 'monthly').flatMap(([, entries]) => entries)]];
        }
        return groupEntries(visibleEntries, period);
    }, [visibleEntries, period, filter.kind]);
    const totals = useMemo(() => ledgerTotals(visibleEntries, currency), [visibleEntries, currency]);
    const movePeriod = (direction: number) => {
        const date = new Date(`${month}-01T12:00:00`);
        if (period === 'monthly') date.setFullYear(date.getFullYear() + direction);
        else date.setMonth(date.getMonth() + direction);
        setMonth(localDate(date).slice(0, 7));
    };
    const exportToChat = () => {
        if (loading || error || !data || !visibleEntries.length || editing !== undefined) return;
        const viewLabel = filter.kind === 'tag' ? t('vyvowLedger.tagOnly') : t(`vyvowLedger.${period}`);
        const title = `${t('vyvowLedger.title')} (${viewLabel})`;
        const snapshot = {
            month, period, filter, excludeTagged, currency,
            totals: totals.missing ? null : {income: totals.income, expense: totals.expense, balance: totals.balance},
            missingExchangeRate: totals.missing,
            entries: visibleEntries.map(({createdAt, txType, houseLedgerOptionId, currency: entryCurrency, amount, memo, tag, rate, targetRate}) => ({
                date: createdAt, type: txType, category: t(`vyvowLedger.categories.op${houseLedgerOptionId}`), currency: entryCurrency, amount, memo, tag, rate, targetRate,
            })),
        };
        addToChat({title, text: `## ${title}\n\n` + JSON.stringify(snapshot, null, 2)});
    };
    return <aside className="household-ledger" style={style} aria-labelledby="household-ledger-title">
        <header className="ledger-header"><span className="workspace-brand-icon"><PiggyBank size={18} aria-hidden="true"/></span><h2 id="household-ledger-title">{t('vyvowLedger.title')}</h2>
            <ChatAttachButton disabled={loading || !!error || !data || !visibleEntries.length || editing !== undefined} onClick={exportToChat}/>
            <button className="ledger-add-button" disabled={loading || !!error || editing !== undefined} onClick={() => setEditing(null)}><Plus size={15}/>{t('vyvowLedger.add')}</button>
            <button className="titlebar-btn" onClick={onClose} aria-label={t('windowControls.close')}><X size={18}/></button></header>
        <div className="ledger-body">
            <div className="ledger-toolbar">
                <LedgerCurrencySelect value={currency} currencies={data?.currencies || []} onChange={setCurrency}/>
                <div className="ledger-period-nav">
                    {filter.kind === 'default' ? <>
                    <button className="titlebar-btn" onClick={() => movePeriod(-1)} aria-label={t('vyvowLedger.previous')}><ChevronLeft size={18}/></button>
                    <strong>{new Intl.DateTimeFormat(i18n.language, period === 'monthly' ? {year: 'numeric'} : {year: 'numeric', month: 'long'}).format(new Date(`${month}-01T12:00:00`))}</strong>
                    <button className="titlebar-btn" onClick={() => movePeriod(1)} aria-label={t('vyvowLedger.next')}><ChevronRight size={18}/></button>
                    </> : <strong className="ledger-filter-caption">{filter.kind === 'range' ? `${filter.from} – ${filter.to}` : t('vyvowLedger.tagOnly')}</strong>}
                </div>
                <button className="titlebar-btn" disabled={loading} onClick={() => setRevision(value => value + 1)} aria-label={t('vyvowLedger.refresh')}><RefreshCw size={16}/></button>
            </div>
            <div className="ledger-view-controls">{filter.kind === 'tag' ? <CustomSelect searchable ariaLabel={t('vyvowLedger.tag')} placeholder={t('vyvowLedger.tag')} value={filter.tag} options={(data?.tags || []).map(tag => ({value: tag, label: tag}))} onChange={tag => setFilter({kind: 'tag', tag})}/> : <div className="ledger-tabs" role="group" aria-label={t('vyvowLedger.period')}>
                {(['daily', 'weekly', 'monthly'] as const).map(value => <button key={value} aria-pressed={period === value} onClick={() => setPeriod(value)}>{t(`vyvowLedger.${value}`)}</button>)}
            </div>}{filter.kind !== 'tag' && period !== 'daily' && <div className="ledger-tag-filter"><span>{t('vyvowLedger.excludeTagged')}</span><ToggleSwitch checked={excludeTagged} onChange={setExcludeTagged} label={t('vyvowLedger.excludeTagged')}/></div>}</div>
            {loading && <p role="status" className="ledger-status">{t('vyvowLedger.loading')}</p>}
            {error && <p role="alert" className="ledger-error">{t(error)}</p>}
            {!loading && !error && data && <>

                <div className="ledger-summary">{(['income', 'expense', 'balance'] as const).map(key => <div key={key}><span>{t(`vyvowLedger.${key === 'balance' ? 'balance' : key === 'income' ? 'INCOME' : 'EXPENSE'}`)}</span><strong className={key === 'balance' ? ledgerBalanceClass(totals.balance, totals.missing) : `ledger-${key}`}>{totals.missing ? '—' : <LedgerMoney amount={totals[key]} currency={currency} currencies={data.currencies}/>}</strong></div>)}</div>
                {totals.missing && <p className="ledger-status">{t('vyvowLedger.missingRate')}</p>}
                {editing !== undefined && <LedgerEntryForm key={editing?.id || 'new'} entry={editing} currency={currency} currencies={data.currencies} tags={data.tags}
                    onCancel={() => setEditing(undefined)} onSaved={() => {setEditing(undefined); setRevision(value => value + 1);}}/>}
                {!groups.length && <p className="ledger-status ledger-empty">{t('vyvowLedger.empty')}</p>}
                <LedgerTransactionList key={`${month}-${period}-${currency}-${excludeTagged}-${JSON.stringify(filter)}`} groups={groups} period={filter.kind === 'tag' ? 'weekly' : period} currency={currency} currencies={data.currencies} onEdit={setEditing}/>
            </>}
        </div>
        <LedgerFilters filter={filter} firstTag={data?.tags[0] || ''} onChange={setFilter}/>
    </aside>;
}
