import {useEffect, useRef, useState} from 'react';
import {ChartNoAxesCombined, ArrowUp, Square, X} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import type {StockMarket, StockSymbol} from '../../services/stockAnalysis';
import {assertOk} from '../../utils/apiError';
import {Tooltip} from '../common/Tooltip/Tooltip';
import ModalTabs from '../common/ModalTabs/ModalTabs';
import {MARKET_INDEX_LABELS} from './marketIndexLabels';
import useStockDirectory from './useStockDirectory';
import CustomSelect from '../CustomSelect/CustomSelect';
import McpPromptInput from '../common/McpPromptInput';
import useSelectedMcpTools from '../common/useSelectedMcpTools';
import '../common/HelpIcon.css';
import './StockDiscussionSidebar.css';

type ChatMessage = {role: 'user' | 'assistant'; content: string};
const MAX_REFERENCE_STOCKS = 5;
const HISTORY_LIMIT = 20;
const DEFAULT_CONTEXT_DAYS = 60;
const MAX_CONTEXT_DAYS = 500;
const PREFERENCES_KEY = 'vyact:stock-discussion:preferences';
function readPreferences(): {days: number; toolIds: string[]} {
    try {
        const value = JSON.parse(localStorage.getItem(PREFERENCES_KEY) ?? '{}');
        return {days: Number.isInteger(value.days) && value.days >= 1 && value.days <= MAX_CONTEXT_DAYS ? value.days : DEFAULT_CONTEXT_DAYS,
            toolIds: Array.isArray(value.toolIds) ? value.toolIds.filter((id: unknown): id is string => typeof id === 'string') : []};
    } catch {return {days: DEFAULT_CONTEXT_DAYS, toolIds: []};}
}

function readMessages(key: string): ChatMessage[] {
    try {
        const value: unknown = JSON.parse(sessionStorage.getItem(key) ?? '[]');
        return Array.isArray(value) ? value.filter((item): item is ChatMessage =>
            item && (item.role === 'user' || item.role === 'assistant') && typeof item.content === 'string').slice(-HISTORY_LIMIT) : [];
    } catch {return [];}
}

export default function StockDiscussionSidebar({stock, market, directory}: {stock: StockSymbol; market: StockMarket; directory: StockSymbol[]}) {
    const {t, i18n} = useTranslation('main');
    const tr = (key: string) => t(`stockAnalysis.discussion.${key}`);
    const storageKey = `vyact:stock-discussion:${market}:${stock.symbol}`;
    const [preferences, setPreferences] = useState(readPreferences);
    const [contextDaysInput, setContextDaysInput] = useState(() => String(preferences.days));
    const {selectedServers, setSelectedServers} = useSelectedMcpTools(preferences.toolIds, toolIds => setPreferences(current => ({...current, toolIds})));
    const [referenceStocks, setReferenceStocks] = useState<StockSymbol[]>([]);
    const [messages, setMessages] = useState<ChatMessage[]>(() => readMessages(storageKey));
    const [question, setQuestion] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(false);
    const [referenceMarket, setReferenceMarket] = useState<StockMarket>(market);
    const language = i18n.resolvedLanguage ?? i18n.language;
    const {rows: referenceDirectory, error: directoryError, reload} = useStockDirectory(referenceMarket, language, true, market, directory);
    const referenceCandidates = [...MARKET_INDEX_LABELS[referenceMarket].map(item => ({symbol: item.symbol, name: t(`stockAnalysis.${item.key}`)})), ...(referenceDirectory ?? [])];
    const textarea = useRef<HTMLTextAreaElement>(null);
    useEffect(() => {
        const input = textarea.current;
        if (!input) return;
        input.style.height = 'auto';
        input.style.height = `${Math.min(input.scrollHeight, 180)}px`;
    }, [question]);
    const controller = useRef<AbortController | null>(null);
    const end = useRef<HTMLDivElement>(null);
    const id = `stock-discussion-${market}-${stock.symbol}`;

    useEffect(() => () => controller.current?.abort(), []);
    useEffect(() => {
        try {localStorage.setItem(PREFERENCES_KEY, JSON.stringify(preferences));} catch { /* Optional preferences. */ }
    }, [preferences]);
    useEffect(() => {
        try {sessionStorage.setItem(storageKey, JSON.stringify(messages.slice(-HISTORY_LIMIT)));} catch { /* Storage may be unavailable. */ }
        end.current?.scrollIntoView({block: 'nearest'});
    }, [messages, busy, storageKey]);

    const send = async () => {
        const text = question.trim();
        if (!text || busy || controller.current) return;
        const request = new AbortController();
        controller.current = request;
        setBusy(true);
        setError(false);
        try {
            const response = await fetch('/api/stock-analysis/chat', {
                method: 'POST', signal: request.signal, headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({symbol: stock.symbol, name: stock.name, market,
                    reference_stocks: referenceStocks.map(item => ({symbol: item.symbol, name: item.name})),
                    context_days: preferences.days, selected_mcp_ids: selectedServers.map(server => server.id),
                    language: i18n.resolvedLanguage ?? i18n.language, question: text, messages: messages.slice(-HISTORY_LIMIT)}),
            });
            await assertOk(response);
            const result = await response.json();
            if (typeof result.answer !== 'string' || !result.answer.trim()) throw new Error('empty_response');
            setMessages(previous => [...previous, {role: 'user', content: text}, {role: 'assistant', content: result.answer}].slice(-HISTORY_LIMIT) as ChatMessage[]);
            setQuestion('');
        } catch {
            if (!request.signal.aborted) setError(true);
        } finally {
            if (controller.current === request) controller.current = null;
            if (!request.signal.aborted) setBusy(false);
        }
    };

    return <aside className="stock-discussion" aria-label={tr('title')}>
        <div className="stock-discussion-title"><ChartNoAxesCombined size={17} aria-hidden="true"/><h2>{tr('ai')}</h2></div>
        <div className="stock-discussion-instrument"><strong>{stock.name}</strong><span>{stock.symbol}</span></div>
        <section className="stock-discussion-references" aria-label={tr('references')}>
            <div className="stock-discussion-reference-picker">
            <Tooltip content={tr('referenceHint')} multiline><button type="button" className="help-icon-button" aria-label={tr('referenceHint')}>?</button></Tooltip>
            <CustomSelect value="" searchable portal disabled={busy || referenceStocks.length >= MAX_REFERENCE_STOCKS}
                ariaLabel={tr('addReference')} placeholder={tr('addReference')}
                header={<ModalTabs tabs={(['KR', 'US'] as const).map(key => ({key, label: t(`stockAnalysis.${key}`)}))}
                    activeKey={referenceMarket} onChange={setReferenceMarket}/>}
                options={referenceCandidates.filter(item => item.symbol !== stock.symbol && !referenceStocks.some(reference => reference.symbol === item.symbol))
                    .map(item => ({value: item.symbol, label: `${item.name} · ${item.symbol}`}))}
                onChange={symbol => {
                    const selected = referenceCandidates.find(item => item.symbol === symbol);
                    if (selected) setReferenceStocks(current => current.length < MAX_REFERENCE_STOCKS && !current.some(item => item.symbol === symbol) ? [...current, selected] : current);
                }}/>
            </div>
            {directoryError && <button type="button" className="modal-action-cancel" onClick={reload}>{t('stockAnalysis.retry')}</button>}
            {referenceStocks.length > 0 && <ul>{referenceStocks.map(item => <li key={item.symbol}>
                <span>{item.name} <small>{item.symbol}</small></span>
                <button type="button" disabled={busy} aria-label={t('stockAnalysis.discussion.removeReference', {name: item.name})}
                    onClick={() => setReferenceStocks(current => current.filter(reference => reference.symbol !== item.symbol))}><X size={13}/></button>
            </li>)}</ul>}
        </section>
        <div className="stock-discussion-panel">
                <div className="stock-discussion-messages" role="log" aria-label={tr('ai')} aria-busy={busy}>
                    {!messages.length && <div className="stock-discussion-empty"><h2>{tr('welcome')}</h2><p>{tr('hint')}</p></div>}
                    {messages.map((message, index) => <article key={index} className={`stock-discussion-message ${message.role}`}><strong>{tr(message.role)}</strong><div>{message.content}</div></article>)}
                    {busy && <p role="status">{tr('thinking')}</p>}
                    <div ref={end}/>
                </div>
                {error && <p className="stock-discussion-error" role="alert">{tr('error')}</p>}
                <form className="stock-discussion-composer" onSubmit={event => {event.preventDefault(); void send();}}>
                    <McpPromptInput id={`${id}-input`} aria-label={tr('placeholder')} placeholder={tr('placeholder')}
                        value={question} onChange={setQuestion} maxLength={4000} disabled={busy} rows={1} textareaRef={textarea}
                        selectedServers={selectedServers} onSelectedServersChange={setSelectedServers}
                        scopeHelp={tr('toolScopeHelp')}
                        onKeyDown={event => {
                            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                                event.preventDefault(); void send();
                            }
                        }}
                        actions={<>
                            <label className="stock-discussion-period" htmlFor={`${id}-days`}>
                                <span>{tr('contextDays')}</span>
                                <input id={`${id}-days`} type="text" inputMode="numeric" pattern="[0-9]*" maxLength={String(MAX_CONTEXT_DAYS).length}
                                    value={contextDaysInput} disabled={busy}
                                    onBlur={() => setContextDaysInput(String(preferences.days))}
                                    onChange={event => {
                                        const value = event.target.value;
                                        if (!/^[0-9]*$/.test(value)) return;
                                        const days = Number(value);
                                        if (value !== '' && (days < 1 || days > MAX_CONTEXT_DAYS)) return;
                                        setContextDaysInput(value);
                                        if (Number.isInteger(days) && days >= 1 && days <= MAX_CONTEXT_DAYS) setPreferences(current => ({...current, days}));
                                    }}/>
                            </label>
                            {busy ? <button className="stock-discussion-send" type="button" aria-label={tr('stop')} title={tr('stop')}
                                onClick={() => {controller.current?.abort(); controller.current = null; setBusy(false);}}><Square size={17}/></button>
                                : <button className="stock-discussion-send" type="submit" disabled={!question.trim()} aria-label={tr('send')} title={tr('send')}><ArrowUp size={20}/></button>}
                        </>}/>

                </form>

        </div>
    </aside>;
}
