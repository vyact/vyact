import React, {lazy, Suspense, useEffect, useState} from 'react';
import ToastContainer from './components/common/ToastNotifications/ToastNotifications';
import {api} from './services/api';
import {fetchTtsSettings} from './services/tts/ttsSettings';
import {ttsService} from './services/tts/ttsService';
import {refreshGoogleWorkspaceStatus} from './services/googleWorkspaceStatus';
import {initializeKnowledgeCollections} from './services/knowledgeCollectionsCache';
import ConfirmModal from './components/common/ConfirmModal/ConfirmModal';
import {useTranslation} from 'react-i18next';
import './App.css';

const SetupPage = lazy(() => import('./components/SetupPage'));
const MainPage = lazy(() => import('./components/MainPage'));
const CHROME_EXTENSION_STORE_URL = 'https://chromewebstore.google.com/detail/vyact/opfbakfhoojmdkbbhcglolkpgmenjbib';

const App: React.FC = () => {
    const {t} = useTranslation('settings');
    const isInitialSetupLaunch = new URLSearchParams(window.location.search).get('initialSetup') === '1';
    // `initialSetup=1` BrowserView is retained after setup. On a renderer
    // refresh, do not assume setup is incomplete or the wizard flashes before
    // the restored setup status is fetched.
    const [isSetupComplete, setIsSetupComplete] = useState<boolean | undefined>(undefined);
    const [dictionaryRequest, setDictionaryRequest] = useState<{resolve: (installed: boolean) => void} | null>(null);
    const [isInstallingDictionary, setIsInstallingDictionary] = useState(false);
    const [dictionaryProgress, setDictionaryProgress] = useState(0);
    const [showBrowserExtensionPrompt, setShowBrowserExtensionPrompt] = useState(false);
    const [runtimeUpdate, setRuntimeUpdate] = useState<Awaited<ReturnType<typeof api.getRuntimeStartupStatus>> | null>(null);
    const [runtimeUpdateAction, setRuntimeUpdateAction] = useState<'update' | 'skip' | null>(null);
    const [runtimeUpdateError, setRuntimeUpdateError] = useState('');

    useEffect(() => {
        checkStatus();
        fetchTtsSettings().catch(() => {});
        void ttsService.preload();
    }, []);

    useEffect(() => {
        if (!isSetupComplete) return;
        // Elasticsearch-backed startup data must only be requested after the
        // initial setup has installed and started Elasticsearch.
        void refreshGoogleWorkspaceStatus().catch(() => {});
        void initializeKnowledgeCollections();
        api.getRuntimeStartupStatus().then(status => {
            if (status.status === 'update_available') setRuntimeUpdate(status);
        }).catch(() => {});
    }, [isSetupComplete]);

    useEffect(() => {
        const handleRequest = (event: Event) => setDictionaryRequest((event as CustomEvent<{resolve: (installed: boolean) => void}>).detail);
        window.addEventListener('vyact:japanese-tts-dictionary-required', handleRequest);
        return () => window.removeEventListener('vyact:japanese-tts-dictionary-required', handleRequest);
    }, []);

    useEffect(() => {
        const showInstallPrompt = () => setShowBrowserExtensionPrompt(true);
        window.addEventListener('vyact:browser-extension-required', showInstallPrompt);
        return () => window.removeEventListener('vyact:browser-extension-required', showInstallPrompt);
    }, []);

    const handleBrowserExtensionChoice = async (choice: string) => {
        setShowBrowserExtensionPrompt(false);
        if (choice !== 'install') return;
        try {
            if (!window.ragAPI?.openExternal) throw new Error('External link bridge unavailable');
            await window.ragAPI.openExternal(CHROME_EXTENSION_STORE_URL);
        } catch {
            window.open(CHROME_EXTENSION_STORE_URL, '_blank', 'noopener,noreferrer');
        }
    };

    const handleDictionaryChoice = async (choice: string) => {
        if (!dictionaryRequest) return;
        if (choice !== 'download') {
            dictionaryRequest.resolve(false);
            setDictionaryRequest(null);
            return;
        }
        setIsInstallingDictionary(true);
        setDictionaryProgress(0);
        try {
            const response = await fetch('/api/tts/japanese-dictionary/install', {method: 'POST'});
            if (!response.ok || !response.body) throw new Error('Japanese TTS dictionary installation failed');

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            let installed = false;
            while (true) {
                const {done, value} = await reader.read();
                buffer += decoder.decode(value, {stream: !done});
                const events = buffer.split('\n\n');
                buffer = events.pop() || '';
                for (const event of events) {
                    const data = event.split('\n').find(line => line.startsWith('data: '));
                    if (!data) continue;
                    const status = JSON.parse(data.slice(6)) as {progress?: number; installed?: boolean};
                    setDictionaryProgress(status.progress || 0);
                    installed = status.installed === true;
                }
                if (done) break;
            }
            dictionaryRequest.resolve(installed);
        } catch {
            dictionaryRequest.resolve(false);
        } finally {
            setIsInstallingDictionary(false);
            setDictionaryRequest(null);
        }
    };

    const handleRuntimeUpdateChoice = async (choice: string) => {
        const shouldUpdate = choice === 'update';
        setRuntimeUpdateAction(shouldUpdate ? 'update' : 'skip');
        setRuntimeUpdateError('');
        try {
            await api.chooseRuntimeStartupUpdate(shouldUpdate);
            setRuntimeUpdate(null);
        } catch (error) {
            setRuntimeUpdateError(error instanceof Error ? error.message : t('general.runtimeUpdateFailed'));
        } finally {
            setRuntimeUpdateAction(null);
        }
    };

    const checkStatus = async () => {
        try {
            const setup = await api.getSetupStatus();
            if (setup.setup_done && setup.config?.model) {
                setIsSetupComplete(true);
            } else {
                setIsSetupComplete(false);
            }
        } catch {
            setIsSetupComplete(false);
        }
    };

    if (isSetupComplete === undefined) return null;

    return (
        <div className="app">
            <Suspense fallback={null}>
                {isSetupComplete ? (
                    <MainPage onModelChange={() => {}}/>
                ) : (
                    <SetupPage
                        onInstallComplete={() => setIsSetupComplete(true)}
                        notifyAppReadyOnMount={isInitialSetupLaunch}
                    />
                )}
            </Suspense>
            <ToastContainer/>
            {runtimeUpdate && <ConfirmModal
                title={t('general.runtimeUpdateTitle')}
                description={runtimeUpdateError || t('general.runtimeUpdateDescription')}
                details={runtimeUpdate.packages.map(pkg => pkg.installed && pkg.available
                    ? `${pkg.name}  ${pkg.installed} → ${pkg.available}`
                    : pkg.name)}
                options={[
                    {value: 'skip', label: t('general.runtimeUpdateLater')},
                    {value: 'update', label: t('general.runtimeUpdateNow'), variant: 'primary'},
                ]}
                loading={runtimeUpdateAction !== null}
                loadingValue={runtimeUpdateAction || undefined}
                loadingLabel={t(runtimeUpdateAction === 'update'
                    ? 'general.runtimeUpdatingAndLoading'
                    : 'general.runtimeLoadingModel')}
                actionLayout="horizontal"
                onSelect={choice => void handleRuntimeUpdateChoice(choice)}
                onClose={() => void handleRuntimeUpdateChoice('skip')}
            />}
            {dictionaryRequest && <ConfirmModal
                title={t('general.japaneseTtsDictionaryTitle')}
                description={t('general.japaneseTtsDictionaryDescription')}
                options={[
                    {value: 'cancel', label: t('general.japaneseTtsDictionaryCancel')},
                    {value: 'download', label: t('general.japaneseTtsDictionaryDownload')},
                ]}
                loading={isInstallingDictionary}
                loadingValue="download"
                loadingLabel={`${t('general.japaneseTtsDictionaryDownloading')} ${dictionaryProgress}%`}
                loadingProgress={dictionaryProgress}
                actionLayout="horizontal"
                onSelect={choice => void handleDictionaryChoice(choice)}
                onClose={() => void handleDictionaryChoice('cancel')}
            />}
            {showBrowserExtensionPrompt && <ConfirmModal
                title={t('general.browserExtensionRequiredTitle')}
                description={t('general.browserExtensionRequiredDescription')}
                options={[
                    {value: 'cancel', label: t('general.browserExtensionCancel')},
                    {value: 'install', label: t('general.browserExtensionInstall')},
                ]}
                actionLayout="horizontal"
                onSelect={choice => void handleBrowserExtensionChoice(choice)}
                onClose={() => setShowBrowserExtensionPrompt(false)}
            />}
        </div>
    );
};

export default App;
