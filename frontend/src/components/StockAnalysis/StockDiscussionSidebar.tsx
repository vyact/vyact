import './StockSymbolLabel.css';
import type {ChartSnapshotContext, ChartSnapshot} from './chartSnapshot';
import {useEffect, useRef, useState, type RefObject} from 'react';
import {ChartNoAxesCombined, ArrowUp, Square, X, History, Camera} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import StockChatHistory from './StockChatHistory';
import ImageAttachmentPreview from '../common/ImageAttachmentPreview/ImageAttachmentPreview';
import ImageViewer from '../ImageViewer/ImageViewer';
import Message from '../Message/Message';
import type {Message as ChatMessage, ToolActivity, MessageAttachment} from '../../types';
import {readStockChatStream} from '../../services/stockChatStream';
import {getToolActivityLabel, getToolActivityDetail, isToolActivityResultFailed} from '../../utils/toolActivity';
import type {StockMarket, StockSymbol} from '../../services/stockAnalysis';
import {assertOk} from '../../utils/apiError';
import {Tooltip} from '../common/Tooltip/Tooltip';
import StockMarketSelect from './StockMarketSelect';
import ToggleSwitch from '../common/ToggleSwitch/ToggleSwitch';
import {MARKET_INDEX_LABELS} from './marketIndexLabels';
import useStockDirectory from './useStockDirectory';
import CustomSelect from '../CustomSelect/CustomSelect';
import McpPromptInput from '../common/McpPromptInput';
import useSelectedMcpTools from '../common/useSelectedMcpTools';
import '../common/HelpIcon.css';
import './StockDiscussionSidebar.css';

const MAX_REFERENCE_STOCKS = 5;
const HISTORY_LIMIT = 20;
const DEFAULT_CONTEXT_DAYS = 60;
const MAX_CONTEXT_DAYS = 500;
const PREFERENCES_KEY = 'vyact:stock-discussion:preferences';
function readPreferences(): {days: number; toolIds: string[]; includeFinancials: boolean} {
    try {
        const value = JSON.parse(localStorage.getItem(PREFERENCES_KEY) ?? '{}');
        return {includeFinancials: value.includeFinancials === true, days: Number.isInteger(value.days) && value.days >= 1 && value.days <= MAX_CONTEXT_DAYS ? value.days : DEFAULT_CONTEXT_DAYS,
            toolIds: Array.isArray(value.toolIds) ? value.toolIds.filter((id: unknown): id is string => typeof id === 'string') : []};
    } catch {return {days: DEFAULT_CONTEXT_DAYS, toolIds: [], includeFinancials: false};}
}

export default function StockDiscussionSidebar({stock, market, directory, captureChart}: {captureChart?: RefObject<(() => ChartSnapshot) | null>; stock: StockSymbol; market: StockMarket; directory: StockSymbol[]}) {
    const {t, i18n} = useTranslation('main');
    const tr = (key: string) => t(`stockAnalysis.discussion.${key}`);
    const [preferences, setPreferences] = useState(readPreferences);
    const [contextDaysInput, setContextDaysInput] = useState(() => String(preferences.days));
    const {selectedServers, setSelectedServers} = useSelectedMcpTools(preferences.toolIds, toolIds => setPreferences(current => ({...current, toolIds})));
    const [referenceStocks, setReferenceStocks] = useState<StockSymbol[]>([]);
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [conversationId, setConversationId] = useState<string>(() => crypto.randomUUID());
    const [historyOpen, setHistoryOpen] = useState(false);
    const [chartAttachment, setChartAttachment] = useState<(MessageAttachment & {chart_context: ChartSnapshotContext}) | null>(null);
    const [chartViewerOpen, setChartViewerOpen] = useState(false);
    const [attachingChart, setAttachingChart] = useState(false);
    const [chartError, setChartError] = useState(false);
    const attachChart = async () => {
        if (!captureChart?.current || attachingChart || busy) return;
        setAttachingChart(true);
        setChartError(false);
        try {
            const snapshot = captureChart.current();
            const canvas = snapshot.canvas;
            const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('capture_failed')), 'image/png'));
            const data = new FormData();
            data.append('file', blob, `${stock.symbol}-chart.png`);
            const response = await fetch('/api/images/upload', {method: 'POST', body: data});
            await assertOk(response);
            const uploaded = await response.json();
            setChartViewerOpen(false);
            setChartAttachment({chart_context: snapshot.context, type: 'image', filename: uploaded.filename, original_name: uploaded.original_name});
        } catch {setChartError(true);} finally {setAttachingChart(false);}
    };
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
    const messageList = useRef<HTMLDivElement>(null);
    const followLatest = useRef(true);
    const previousScrollTop = useRef(0);
    const id = `stock-discussion-${market}-${stock.symbol}`;

    useEffect(() => () => controller.current?.abort(), []);
    useEffect(() => {
        try {localStorage.setItem(PREFERENCES_KEY, JSON.stringify(preferences));} catch { /* Optional preferences. */ }
    }, [preferences]);
    useEffect(() => {
        const frame = requestAnimationFrame(() => {
            const list = messageList.current;
            if (list && followLatest.current) {list.scrollTop = list.scrollHeight; previousScrollTop.current = list.scrollTop;}
        });
        return () => cancelAnimationFrame(frame);
    }, [messages, busy]);

    const send = async () => {
        const text = question.trim();
        if (!text || busy || attachingChart || controller.current) return;
        const request = new AbortController();
        controller.current = request;
        setBusy(true);
        setError(false);
        followLatest.current = true;
        const userId = crypto.randomUUID();
        const assistantId = crypto.randomUUID();
        const startedAt = Date.now();
        setMessages(previous => [...previous, {id: userId, role: 'user', content: text, attachments: chartAttachment ? [chartAttachment] : [], timestamp: new Date(startedAt).toISOString()},
            {id: assistantId, role: 'assistant', content: ''}].slice(-HISTORY_LIMIT) as ChatMessage[]);
        setQuestion('');
        setChartAttachment(null);
        const updateAssistant = (update: (message: ChatMessage) => ChatMessage) => {
            if (request.signal.aborted) return;
            setMessages(previous => previous.map(message => message.id === assistantId ? update(message) : message));
        };
        try {
            const response = await fetch('/api/stock-analysis/chat', {
                method: 'POST', signal: request.signal, headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({attachments: chartAttachment ? [chartAttachment] : [], stream: true, conversation_id: conversationId, symbol: stock.symbol, name: stock.name, market,
                    reference_stocks: referenceStocks.map(item => ({symbol: item.symbol, name: item.name})),
                    context_days: preferences.days, include_financials: preferences.includeFinancials, selected_mcp_ids: selectedServers.map(server => server.id),
                    language: i18n.resolvedLanguage ?? i18n.language, question: text, messages: messages.slice(-HISTORY_LIMIT).map(({role, content, attachments}) => ({role, content, attachments})).filter(message => message.content.trim())}),
            });
            await assertOk(response);
            await readStockChatStream(response, event => {
                if (event.type === 'model') updateAssistant(message => ({...message, model: event.model}));
                if (event.type === 'stats' && !request.signal.aborted) {
                    const {type: _type, ...stats} = event;
                    setMessages(previous => previous.map(message => message.id === userId || message.id === assistantId ? {...message, stats} : message));
                }
                if (event.type === 'reset') updateAssistant(message => ({...message, content: ''}));
                if (event.type === 'token' && event.text) updateAssistant(message => ({...message, content: message.content + event.text}));
                if (event.type === 'tool') {
                    const completed = event.phase === 'end';
                    updateAssistant(message => {
                        const log = [...(message.activityLog ?? [])];
                        let existing = -1;
                        if (completed) {
                            for (let index = log.length - 1; index >= 0; index--) {
                                if (log[index].name === event.name && log[index].phase === 'running') {existing = index; break;}
                            }
                        }
                        const activity: ToolActivity = {
                            id: existing >= 0 ? log[existing].id : crypto.randomUUID(), name: event.name,
                            phase: completed ? 'completed' : 'running', group: 'tool',
                            label: getToolActivityLabel(event.name, (key, options) => t(key, options)),
                            detail: getToolActivityDetail(event.args), startedAt: existing >= 0 ? log[existing].startedAt : Date.now(),
                            ...(completed ? {completedAt: Date.now(), outcome: isToolActivityResultFailed(event.result) ? 'failed' as const : 'success' as const} : {}),
                        };
                        if (existing >= 0) log[existing] = activity;
                        else log.push(activity);
                        return {...message, activityLog: log, toolStatus: activity};
                    });
                }
            });
            updateAssistant(message => ({...message, timestamp: new Date().toISOString()}));
        } catch {
            if (!request.signal.aborted) setError(true);
        } finally {
            if (controller.current === request) controller.current = null;
            if (!request.signal.aborted) setBusy(false);
        }
    };

    const startNewConversation = () => {
        setChartAttachment(null); setChartError(false); setConversationId(crypto.randomUUID()); setMessages([]); setQuestion(''); setError(false); setHistoryOpen(false);
    };

    return <aside className="stock-discussion" aria-label={tr('title')}>
        <header className="stock-discussion-header">
            <div className="stock-discussion-title"><ChartNoAxesCombined size={16} aria-hidden="true"/><h2>{tr('ai')}</h2></div>
            <button type="button" className="stock-discussion-new-button" disabled={busy} aria-label={tr('newConversation')} onClick={startNewConversation}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h7"/><path d="M19 2v6M16 5h6"/></svg></button>
            <div className="stock-discussion-instrument"><strong>{stock.name}</strong><span className="stock-symbol-label">{stock.symbol}</span></div>
        </header>
        <section className="stock-discussion-references" aria-label={tr('references')}>
            <div className="stock-discussion-reference-picker">
            <Tooltip content={tr('referenceHint')} multiline><button type="button" className="help-icon-button" aria-label={tr('referenceHint')}>?</button></Tooltip>
            <CustomSelect optionsPageSize={100} value="" searchable portal disabled={busy || referenceStocks.length >= MAX_REFERENCE_STOCKS}
                ariaLabel={tr('addReference')} placeholder={tr('addReference')}
                header={<div className="stock-reference-market"><StockMarketSelect value={referenceMarket} onChange={setReferenceMarket} compact portal={false}/></div>}
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
                <div className="stock-discussion-messages" ref={messageList} tabIndex={0}
                    onWheel={event => {if (event.deltaY < 0) followLatest.current = false;}}
                    onKeyDown={event => {if (['PageUp', 'ArrowUp', 'Home'].includes(event.key)) followLatest.current = false;}}
                    onScroll={event => {
                        const list = event.currentTarget;
                        if (list.scrollTop < previousScrollTop.current) followLatest.current = false;
                        if (list.scrollHeight - list.scrollTop - list.clientHeight <= 8) followLatest.current = true;
                        previousScrollTop.current = list.scrollTop;
                    }} role="log" aria-label={tr('ai')} aria-busy={busy}>
                    {!messages.length && !busy && <div className="stock-discussion-empty"><h2>{tr('welcome')}</h2><p>{tr('hint')}</p></div>}
                    {messages.map((message, index) => <div key={message.id ?? index} className={`stock-discussion-message-row ${message.role}`}>
                        <Message disableActionTooltips role={message.role} content={message.content} timestamp={message.timestamp ?? ''}
                            isStreaming={busy && index === messages.length - 1 && message.role === 'assistant'}
                            attachments={message.attachments} model={message.model} stats={message.stats} activityLog={message.activityLog} toolStatus={message.toolStatus}/>
                    </div>)}
                </div>
                {error && <p className="stock-discussion-error" role="alert">{tr('error')}</p>}
                <form className="stock-discussion-composer" onSubmit={event => {event.preventDefault(); void send();}}>
                    <div className="stock-discussion-context-settings">
        <div className="stock-discussion-financials-option">
            <span className="stock-discussion-financials-label">{tr('includeFinancials')}</span>
            <ToggleSwitch label={tr('includeFinancials')} checked={preferences.includeFinancials} disabled={busy}
                onChange={includeFinancials => setPreferences(current => ({...current, includeFinancials}))}/>
        </div>
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
                    </div>
                    {chartError && <p role="alert" className="stock-discussion-error">{tr('chartAttachError')}</p>}
                    <McpPromptInput preview={chartAttachment && <div className="attachment-preview-list">
                        <ImageAttachmentPreview src={`/api/images/${encodeURIComponent(chartAttachment.filename!)}`}
                            alt={chartAttachment.original_name ?? stock.symbol} disabled={busy}
                            onOpen={() => setChartViewerOpen(true)} onRemove={() => {setChartAttachment(null); setChartViewerOpen(false);}}/>
                    </div>} id={`${id}-input`} aria-label={tr('placeholder')} placeholder={tr('placeholder')}
                        value={question} onChange={setQuestion} maxLength={4000} disabled={busy} rows={1} textareaRef={textarea}
                        selectedServers={selectedServers} onSelectedServersChange={setSelectedServers}
                        scopeHelp={tr('toolScopeHelp')}
                        onKeyDown={event => {
                            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                                event.preventDefault(); void send();
                            }
                        }}
                        actions={<>
                            <button type="button" className="stock-discussion-history-button" aria-label={tr('attachChart')} title={tr('attachChart')}
                                disabled={busy || attachingChart || !captureChart} onClick={() => {void attachChart();}}><Camera size={18}/></button>
                            <button type="button" className="stock-discussion-history-button" aria-label={tr('historyTitle')} title={tr('historyTitle')} disabled={busy}
                                onClick={() => setHistoryOpen(true)}><History size={18} aria-hidden="true"/></button>

                            {busy ? <button className="stock-discussion-send stock-discussion-stop" type="button" aria-label={tr('stop')}
                                onClick={() => {controller.current?.abort(); controller.current = null; setBusy(false);}}><Square size={12} fill="currentColor" strokeWidth={0} aria-hidden="true"/></button>
                                : <button className="stock-discussion-send" type="submit" disabled={!question.trim() || attachingChart} aria-label={tr('send')}><ArrowUp size={18}/></button>}
                        </>}/>

                </form>

        </div>
        {chartViewerOpen && chartAttachment && <ImageViewer
            images={[{src: `/api/images/${encodeURIComponent(chartAttachment.filename!)}`, alt: chartAttachment.original_name}]}
            currentIndex={0} onIndexChange={() => {}} onClose={() => setChartViewerOpen(false)}/>}
        {historyOpen && <StockChatHistory symbol={stock.symbol} onClose={() => setHistoryOpen(false)}
            onSelect={(id, restoredMessages) => {setChartAttachment(null); setChartError(false); setConversationId(id); setMessages(restoredMessages); setQuestion(''); setError(false); setHistoryOpen(false);}}
/>}
    </aside>;
}
