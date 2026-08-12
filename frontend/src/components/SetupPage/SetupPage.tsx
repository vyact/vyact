import React, { useEffect, useMemo, useRef, useState } from 'react';
import {Eye, EyeOff, ExternalLink, Plus} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { LogEntry } from '../../types';
import { getRecommendedModelDisplay } from '../../utils/recommendedModels';
import { syncPendingLanguageAfterSetup } from '../../i18n';
import EsModeSelector from './EsModeSelector';
import CustomSelect from '../CustomSelect/CustomSelect';
import {CUSTOM_PROTOCOL_OPTIONS, OPENAI_COMPATIBLE_DOCS_URL} from '../../constants/customProviders';
import './SetupPage.css';

interface SetupPageProps {
    onInstallComplete: () => void;
}

interface RecommendedModel {
    id: string;
    name: string;
    desc: string;
    type?: string;
}

type Provider = 'ollama' | 'openai' | 'gemini' | 'claude' | 'custom';
type CustomProtocol = 'openai-compatible';

const DEFAULT_MODELS: Record<Exclude<Provider, 'ollama' | 'custom'>, string> = {
    openai: 'gpt-4o-mini',
    gemini: 'gemini-3.1-flash-lite-preview',
    claude: 'claude-3-5-sonnet',
};

const SetupPage: React.FC<SetupPageProps> = ({ onInstallComplete }) => {
    const { t } = useTranslation(['setup', 'main']);
    const [provider, setProvider] = useState<Provider>('ollama');
    const [esMode, setEsMode] = useState<'docker' | 'native'>('docker');
    // null = 확인 중(상태 조회 완료 전). 확인 전에는 선택지를 잠가 "됐다 안 됐다"처럼 보이는 것을 방지.
    const [dockerAvailable, setDockerAvailable] = useState<boolean | null>(null);
    const [nativeSupported, setNativeSupported] = useState<boolean | null>(null);
    const [recommendedModels, setRecommendedModels] = useState<RecommendedModel[]>([]);
    const [defaultModel, setDefaultModel] = useState<string>('');

    const [selectedModel, setSelectedModel] = useState<string>('');
    const [customModel, setCustomModel] = useState<string>('');
    const [apiKey, setApiKey] = useState<string>('');
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

    const isCloud = provider !== 'ollama';

    // 추천 모델 리스트 로드
    useEffect(() => {
        fetch('/api/models/recommended')
            .then(res => res.json())
            .then(data => {
                setRecommendedModels(data.models);
                setDefaultModel(data.default);
            })
            .catch(err => console.error('Failed to load models:', err));
    }, []);

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
        if (provider === 'ollama') {
            setSelectedModel(prev => defaultModel || prev || '');
            setCustomModel('');
            setApiKey('');
        } else if (provider === 'custom') {
            setSelectedModel('');
            setCustomModel('');
            setApiKey('');
            setConnectionName('');
            setBaseUrl('');
            setCustomHeaders([]);
        } else {
            setSelectedModel(DEFAULT_MODELS[provider]);
            setCustomModel('');
        }
    }, [provider, defaultModel]);

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
        // Ollama: 모델 미선택 + 커스텀 미입력이면 비활성화
        return !selectedModel.trim() && !customModel.trim();
    }, [provider, isCloud, apiKey, selectedModel, customModel, connectionName, baseUrl, customHeaders]);

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
            provider === 'ollama'
                ? {
                    type: 'ollama',
                    model: customModel || selectedModel,
                    config: { es_mode: esMode },
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
                    {(['ollama', 'openai', 'gemini', 'claude', 'custom'] as const).map(id => ({
                        id,
                        name: t(`providers.${id}.name`),
                        desc: t(`providers.${id}.desc`),
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
                        {provider === 'ollama' && (
                            <>
                                <div className="sec-label">{t('ollamaModel')}</div>
                                <div className="model-grid">
                                    {[
                                        // 1. chat 모델 (DEFAULT_MODEL 최상단)
                                        ...recommendedModels
                                            .filter(m => (!m.type || m.type === 'chat'))
                                            .sort((a, b) => a.id === defaultModel ? -1 : b.id === defaultModel ? 1 : 0),
                                        // 2. 구분자 (sentinel)
                                        { id: '__divider__', name: '', desc: '', type: '__divider__' },
                                        // 3. 이미지 모델
                                        ...recommendedModels.filter(m => m.type === 'image_gen' || m.type === 'image_edit'),
                                    ].map((model) => {
                                        if (model.type === '__divider__') {
                                            return (
                                                <div key="divider" style={{
                                                    display: 'flex', alignItems: 'center', gap: '8px',
                                                    fontSize: '11px', color: 'var(--muted)', margin: '4px 0 2px',
                                                    flexShrink: 0,
                                                }}>
                                                    <div style={{ flex: 1, height: '1px', background: 'var(--border)' }} />
                                                    🎨 {t('imageGenModel')}
                                                    <div style={{ flex: 1, height: '1px', background: 'var(--border)' }} />
                                                </div>
                                            );
                                        }
                                        const displayModel = getRecommendedModelDisplay(model, t);
                                        return (
                                            <div
                                                key={model.id}
                                                className={`model-item ${selectedModel === model.id ? 'selected' : ''}`}
                                                onClick={() => setSelectedModel(model.id)}
                                            >
                                                <div className="model-name">{displayModel.name}</div>
                                                <div className="model-desc">{displayModel.desc}</div>
                                            </div>
                                        );
                                    })}
                                </div>

                                <input
                                    className="input setup-custom-model-input"
                                    placeholder={t('customModel')}
                                    value={customModel}
                                    onChange={e => setCustomModel(e.target.value)}
                                />
                            </>
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
                            {provider === 'custom' && <label className="setup-field"><span>{t('customConnection.baseUrl')}</span><input className="input" placeholder="http://localhost:11434/v1" value={baseUrl} onChange={e => setBaseUrl(e.target.value)}/></label>}
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
