import React, { useEffect, useMemo, useRef, useState } from 'react';
import {Eye, EyeOff, ExternalLink, Plus} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { LogEntry } from '../../types';
import { syncPendingLanguageAfterSetup } from '../../i18n';
import EsModeSelector from './EsModeSelector';
import CustomSelect from '../CustomSelect/CustomSelect';
import {CUSTOM_PROTOCOL_OPTIONS, OPENAI_COMPATIBLE_DOCS_URL} from '../../constants/customProviders';
import {api, type VyactHubModel} from '../../services/api';
import './SetupPage.css';

interface SetupPageProps {
    onInstallComplete: () => void;
}

type Provider = 'vyact' | 'openai' | 'gemini' | 'claude' | 'custom';
type CustomProtocol = 'openai-compatible';

const DEFAULT_MODELS: Record<Exclude<Provider, 'vyact' | 'custom'>, string> = {
    openai: 'gpt-4o-mini',
    gemini: 'gemini-3.1-flash-lite-preview',
    claude: 'claude-3-5-sonnet',
};

const SetupPage: React.FC<SetupPageProps> = ({ onInstallComplete }) => {
    const { t } = useTranslation(['setup', 'main']);
    const [provider, setProvider] = useState<Provider>('vyact');
    const [esMode, setEsMode] = useState<'docker' | 'native'>('docker');
    // null = 확인 중(상태 조회 완료 전). 확인 전에는 선택지를 잠가 "됐다 안 됐다"처럼 보이는 것을 방지.
    const [dockerAvailable, setDockerAvailable] = useState<boolean | null>(null);
    const [nativeSupported, setNativeSupported] = useState<boolean | null>(null);
    const [selectedModel, setSelectedModel] = useState<string>('');
    const [apiKey, setApiKey] = useState<string>('');
    const [huggingFaceToken, setHuggingFaceToken] = useState<string>('');
    const [huggingFaceQuery, setHuggingFaceQuery] = useState('');
    const [huggingFaceModels, setHuggingFaceModels] = useState<VyactHubModel[]>([]);
    const [isSearchingHub, setIsSearchingHub] = useState(false);
    const [downloadingHubFile, setDownloadingHubFile] = useState('');
    const [isApiKeyVisible, setIsApiKeyVisible] = useState(false);
    const [connectionName, setConnectionName] = useState<string>('');
    const [baseUrl, setBaseUrl] = useState<string>('');
    const [customProtocol, setCustomProtocol] = useState<CustomProtocol>('openai-compatible');
    const [customHeaders, setCustomHeaders] = useState<Array<{id: string; name: string; value: string; isValueVisible: boolean}>>([]);

    const addCustomHeader = () => {
        setCustomHeaders(current => [
            ...current,
            {id: `setup-${Date.now()}-${current.length}`, name: '', value: '', isValueVisible: false},
        ]);
    };

    const [isInstalling, setIsInstalling] = useState(false);
    const [progress, setProgress] = useState(0);

    const [logs, setLogs] = useState<LogEntry[]>([]);
    const [errorLogs, setErrorLogs] = useState<string[]>([]);

    const logRef = useRef<HTMLDivElement>(null);
    const shouldFollowLogTailRef = useRef(true);

    const isCloud = provider !== 'vyact';

    // 시스템 상태 조회 — Docker 설치 여부/네이티브 지원 여부에 따라 ES 방식 선택지 제어
    useEffect(() => {
        fetch('/api/setup/status')
            .then(res => res.json())
            .then(data => {
                const dockerOk = data.docker_available ?? false;
                const nativeOk = data.native_supported ?? false;
                setDockerAvailable(dockerOk);
                setNativeSupported(nativeOk);
                // 확인이 끝난 시점에 기본 선택을 확정한다.
                // Docker 사용 가능하면 docker, 아니면 네이티브(가능할 때)로.
                setEsMode(dockerOk ? 'docker' : (nativeOk ? 'native' : 'docker'));
            })
            .catch(err => {
                console.error('Failed to load setup status:', err);
                // 조회 실패 시 선택지를 잠그지 않도록 둘 다 허용으로 처리
                setDockerAvailable(true);
                setNativeSupported(true);
            });
    }, []);

    // 사용자가 이전 로그를 읽는 동안에는 자동 스크롤을 멈춘다.
    useEffect(() => {
        if (logRef.current && shouldFollowLogTailRef.current) {
            logRef.current.scrollTop = logRef.current.scrollHeight;
        }
    }, [logs]);

    const handleLogScroll = () => {
        const element = logRef.current;
        if (!element) return;
        shouldFollowLogTailRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 8;
    };

    useEffect(() => {
        if (provider === 'vyact') {
            setSelectedModel('');
            setApiKey('');
        } else if (provider === 'custom') {
            setSelectedModel('');
            setApiKey('');
            setConnectionName('');
            setBaseUrl('');
            setCustomHeaders([]);
        } else {
            setSelectedModel(DEFAULT_MODELS[provider]);
        }
    }, [provider]);

    const addLog = (type: LogEntry['type'], message: string, displayErrorMessage = message) => {
        if (type === 'log') {
            // 진행률 로그는 마지막 줄 덮어쓰기
            setLogs(prev => {
                const newLogs = [...prev];
                if (newLogs.length > 0 && newLogs[newLogs.length - 1].type === 'log') {
                    // 마지막이 log면 덮어쓰기
                    newLogs[newLogs.length - 1] = { type, message };
                } else {
                    // 새로 추가
                    newLogs.push({ type, message });
                }
                return newLogs;
            });
        } else {
            // 다른 타입은 새 줄 추가
            setLogs(prev => [...prev, { type, message }]);
        }

        if (type === 'error') {
            setErrorLogs(prev => [...prev, displayErrorMessage]);
        }
    };

    const isInstallDisabled = useMemo(() => {
        if (provider === 'custom') return !connectionName.trim() || !baseUrl.trim() || !selectedModel.trim()
            || customHeaders.some(header => !header.name.trim() || !header.value.trim());
        if (isCloud) return !apiKey.trim() || !selectedModel.trim();
        return !selectedModel.trim();
    }, [provider, isCloud, apiKey, selectedModel, connectionName, baseUrl, customHeaders]);

    const changeProvider = (next: Provider) => {
        setProvider(next);
        setLogs([]);
        setProgress(0);
        setIsInstalling(false);
    };

    const handleInstall = async () => {
        if (isCloud && isInstallDisabled) {
            addLog('error', provider === 'custom' ? t('customConnection.required') : t('apiKeyModelRequired'));
            return;
        }
        setIsInstalling(true);
        setProgress(0);
        setLogs([]);
        setErrorLogs([]); // 🔥 설치 시작 시 초기화

        const payload =
            provider === 'vyact'
                    ? {
                        type: 'vyact',
                        model: selectedModel,
                        config: {es_mode: esMode, model_path: selectedModel},
                    }
                : provider === 'custom'
                    ? {
                        type: 'custom',
                        model: selectedModel,
                        api_key: apiKey,
                        config: {es_mode: esMode, name: connectionName, protocol: customProtocol, base_url: baseUrl, headers: customHeaders.map(({name, value}) => ({name, value}))},
                    }
                    : {
                    type: provider,
                    model: selectedModel,
                    api_key: apiKey,
                    config: { es_mode: esMode },
                };

        try {
            const response = await fetch('/api/setup/install', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });

            if (!response.ok) throw new Error(`Installation request failed (${response.status})`);
            if (!response.body) throw new Error('Stream not supported');

            const reader = response.body.getReader();
            const decoder = new TextDecoder();

            let hasError = false;
            let pendingChunk = '';

            while (true) {
                const { value, done } = await reader.read();
                if (done) break;

                pendingChunk += decoder.decode(value, {stream: true});
                const lines = pendingChunk.split('\n');
                pendingChunk = lines.pop() ?? '';

                for (const line of lines) {
                    if (!line.startsWith('data: ')) continue;

                    const raw = line.replace('data: ', '').trim();
                    if (!raw) continue;

                    const parsed = JSON.parse(raw);

                    if (parsed.progress !== undefined) {
                        setProgress(parsed.progress);
                    }

                    if (parsed.message) {
                        const type = parsed.type;
                        const localizedMessage = parsed.i18nKey
                            ? t(parsed.i18nKey, parsed.i18nParams ?? {})
                            : parsed.message;

                        if (type === 'error') {
                            hasError = true;
                            const alertMessage = parsed.i18nKey
                                ? localizedMessage
                                : t('installationFailed');
                            addLog('error', localizedMessage, alertMessage);
                            alert(alertMessage);
                            await reader.cancel();
                            setIsInstalling(false);
                            return;
                        }

                        if (type === 'done') {
                            addLog('ok', parsed.message);

                            if (!hasError) {
                                // setup 라우터가 ES 초기화와 .setup_done 생성을 끝낸 뒤에
                                // 전송하는 이벤트다. 이 시점에 초기 언어를 바로 저장한다.
                                await syncPendingLanguageAfterSetup();
                                onInstallComplete();
                            }

                            setIsInstalling(false);
                            return;
                        }

                        const logType: LogEntry['type'] = (
                            type === 'info' || type === 'ok' || type === 'log' || type === 'error'
                        ) ? type : 'log';
                        addLog(logType, parsed.message);
                    }
                }
            }

            if (!hasError) {
                throw new Error('Installation stream ended before completion');
            }
            setIsInstalling(false);

        } catch (err) {
            addLog('error', String(err), t('installationFailed'));
            setIsInstalling(false);
        }
    };

    return (
        <div className="setup-page">
            <div className={`setup-card ${isInstalling ? 'installing' : ''}`}>
                <header className="setup-header">
                    <div className="setup-brand-mark" aria-hidden="true">
                        <span>V</span>
                    </div>
                    <div className="setup-wordmark">VYACT</div>
                </header>

                {/* 🔥 GLOBAL ERROR (항상 표시) */}
                {errorLogs.length > 0 && (
                    <div className="global-error-box">
                        {errorLogs.map((e, i) => (
                            <div key={i} className="global-error">
                                ⚠ {e}
                            </div>
                        ))}
                    </div>
                )}

                <div className="sec-label">{t('provider')}</div>

                <div className="provider-grid">
                    {(['vyact', 'openai', 'gemini', 'claude', 'custom'] as const).map(id => ({
                        id,
                        name: id === 'vyact' ? 'Vyact' : t(`providers.${id}.name`),
                        desc: id === 'vyact' ? t('localExec') : t(`providers.${id}.desc`),
                    })).map(p => (
                        <div
                            key={p.id}
                            className={`provider-item ${provider === p.id ? 'selected' : ''} ${isInstalling && provider !== p.id ? 'disabled' : ''}`}
                            onClick={() => !isInstalling && changeProvider(p.id as Provider)}
                            aria-disabled={isInstalling}
                        >
                            <div className="provider-name">{p.name}</div>
                            <div className="provider-desc">{p.desc}</div>
                        </div>
                    ))}
                </div>

                {!isInstalling && (
                    <>
                        {provider === 'vyact' && (
                            <section className="setup-connection-panel">
                                <div className="setup-connection-heading"><div><strong>Vyact</strong><span>{t('localExec')}</span></div></div>
                                <label className="setup-field"><span>{t('apiKey')}</span><div className="setup-secret-field"><input className="input" type={isApiKeyVisible ? 'text' : 'password'} placeholder={t('apiKey')} value={huggingFaceToken} onChange={event => setHuggingFaceToken(event.target.value)} onBlur={() => huggingFaceToken.trim() && api.saveVyactHuggingFaceToken(huggingFaceToken.trim()).catch(error => console.error('Failed to save Hugging Face token:', error))}/><button type="button" onClick={() => setIsApiKeyVisible(current => !current)} aria-label={t(isApiKeyVisible ? 'main:customProvider.hideApiKey' : 'main:customProvider.showApiKey')}>{isApiKeyVisible ? <EyeOff size={16}/> : <Eye size={16}/>}</button></div></label>
                                <div className="setup-field"><span>{t('main:modelSelector.modelSearch')}</span><div className="setup-hub-search"><input className="input" value={huggingFaceQuery} onChange={event => setHuggingFaceQuery(event.target.value)} onKeyDown={async event => { if (event.key !== 'Enter' || !huggingFaceQuery.trim()) return; setIsSearchingHub(true); try { setHuggingFaceModels((await api.searchVyactModels(huggingFaceQuery)).models); } finally { setIsSearchingHub(false); } }} placeholder={t('main:modelSelector.modelSearch')}/><button type="button" disabled={isSearchingHub || !huggingFaceQuery.trim()} onClick={async () => { setIsSearchingHub(true); try { setHuggingFaceModels((await api.searchVyactModels(huggingFaceQuery)).models); } finally { setIsSearchingHub(false); } }}>{isSearchingHub ? '…' : t('main:modelSelector.add')}</button></div></div>
                                {huggingFaceModels.map(model => <div className="setup-hub-result" key={model.id}><strong>{model.id}</strong>{model.files.map(file => { const fileKey = `${model.id}/${file}`; return <button key={file} type="button" disabled={!!downloadingHubFile} onClick={async () => { setDownloadingHubFile(fileKey); try { await api.streamVyactModelDownload(model.id, file, () => undefined); setSelectedModel(fileKey); } finally { setDownloadingHubFile(''); } }}>{downloadingHubFile === fileKey ? t('main:modelDownload.downloading') : file}</button>; })}</div>)}
                                <label className="setup-field"><span>{t('modelId')}</span><input className="input" placeholder={t('modelIdPlaceholder')} value={selectedModel} onChange={event => setSelectedModel(event.target.value)}/></label>
                            </section>
                        )}

                        {isCloud && <section className={`setup-connection-panel${provider === 'custom' ? ' setup-custom-connection-panel' : ''}`}>
                            <div className="setup-connection-heading">
                                <div><strong>{provider === 'custom' ? t('customConnection.title') : t('cloudConnection.title')}</strong></div>
                                {provider !== 'custom' && <span className="setup-protocol-badge">{t(`providers.${provider}.name`)}</span>}
                            </div>
                            {provider === 'custom' && <div className="setup-field-row">
                                <label className="setup-field"><span>{t('customConnection.name')}</span><input className="input" placeholder={t('customConnection.namePlaceholder')} value={connectionName} onChange={e => setConnectionName(e.target.value)}/></label>
                                <label className="setup-field"><span>{t('main:customProvider.protocol')}</span><CustomSelect className="setup-protocol-select" options={CUSTOM_PROTOCOL_OPTIONS} value={customProtocol} onChange={value => setCustomProtocol(value as CustomProtocol)} ariaLabel={t('main:customProvider.protocol')}/></label>
                            </div>}
                            {provider === 'custom' && <div className="setup-protocol-help"><span>{t('main:customProvider.hint')}</span><a href={OPENAI_COMPATIBLE_DOCS_URL} target="_blank" rel="noreferrer">{t('main:customProvider.protocolDocs')}<ExternalLink size={13}/></a></div>}
                            {provider === 'custom' && <label className="setup-field"><span>{t('customConnection.baseUrl')}</span><input className="input" placeholder="http://localhost:8000/v1" value={baseUrl} onChange={e => setBaseUrl(e.target.value)}/></label>}
                            <div className={provider === 'custom' ? 'setup-field-row' : 'setup-cloud-fields'}>
                                <label className="setup-field"><span>{t('apiKey')}{provider === 'custom' && <small>{t('customConnection.optional')}</small>}</span><div className="setup-secret-field"><input className="input" type={isApiKeyVisible ? 'text' : 'password'} placeholder={t('apiKey')} value={apiKey} onChange={e => setApiKey(e.target.value)}/><button type="button" onClick={() => setIsApiKeyVisible(current => !current)} aria-label={t(isApiKeyVisible ? 'main:customProvider.hideApiKey' : 'main:customProvider.showApiKey')}>{isApiKeyVisible ? <EyeOff size={16}/> : <Eye size={16}/>}</button></div></label>
                                <label className="setup-field"><span>{t('modelId')}</span><input className="input" placeholder={t('modelIdPlaceholder')} value={selectedModel} onChange={e => setSelectedModel(e.target.value)}/></label>
                            </div>
                            {provider === 'custom' && <div className="setup-custom-headers">
                                <div className="setup-custom-headers-heading"><span>{t('main:customProvider.headers')}</span><button type="button" onClick={addCustomHeader}>+ {t('main:customProvider.addHeader')}</button></div>
                                {customHeaders.length === 0 ? <button type="button" className="setup-custom-headers-empty" onClick={addCustomHeader}><Plus size={18}/><span>{t('main:customProvider.noHeaders')}</span></button> : customHeaders.map(header => <div className="setup-custom-header-row" key={header.id}>
                                    <input className="input" value={header.name} onChange={event => setCustomHeaders(current => current.map(item => item.id === header.id ? {...item, name: event.target.value} : item))} placeholder="X-API-Key"/>
                                    <div className="setup-secret-field"><input className="input" type={header.isValueVisible ? 'text' : 'password'} value={header.value} onChange={event => setCustomHeaders(current => current.map(item => item.id === header.id ? {...item, value: event.target.value} : item))} placeholder={t('main:customProvider.headerValuePlaceholder')}/><button type="button" onClick={() => setCustomHeaders(current => current.map(item => item.id === header.id ? {...item, isValueVisible: !item.isValueVisible} : item))} aria-label={t(header.isValueVisible ? 'main:customProvider.hideHeaderValue' : 'main:customProvider.showHeaderValue')}>{header.isValueVisible ? <EyeOff size={16}/> : <Eye size={16}/>}</button></div>
                                    <button type="button" onClick={() => setCustomHeaders(current => current.filter(item => item.id !== header.id))} aria-label={t('main:customProvider.removeHeader')}>×</button>
                                </div>)}
                            </div>}
                        </section>}

                        {/* ES 설치 방식은 프로바이더와 무관하게 항상 표시 (RAG에 ES 필요) */}
                        <EsModeSelector
                            esMode={esMode}
                            onChange={setEsMode}
                            dockerAvailable={dockerAvailable}
                            nativeSupported={nativeSupported}
                        />

                        <button
                            className="btn-install"
                            onClick={handleInstall}
                            disabled={isInstallDisabled || (dockerAvailable === null && nativeSupported === null)}
                        >
                            {t('startInstall')}
                        </button>
                    </>
                )}

                {isInstalling && (
                    <div className="progress-wrap active">
                        <div className="pbar-bg">
                            <div
                                className="pbar-fill"
                                style={{ width: `${progress}%` }}
                            />
                        </div>

                        <div className="progress-log" ref={logRef} onScroll={handleLogScroll}>
                            {logs.map((log, i) => (
                                <div key={i} className={`log-${log.type}`}>
                                    {log.message}
                                </div>
                            ))}
                        </div>
                    </div>
                )}

            </div>
        </div>
    );
};

export default SetupPage;
