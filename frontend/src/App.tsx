import React, {lazy, Suspense, useEffect, useState} from 'react';
import ToastContainer from './components/common/ToastNotifications/ToastNotifications';
import {api} from './services/api';
import {fetchTtsSettings} from './services/tts/ttsSettings';
import {ttsService} from './services/tts/ttsService';
import ConfirmModal from './components/common/ConfirmModal/ConfirmModal';
import {useTranslation} from 'react-i18next';
import './App.css';

const SetupPage = lazy(() => import('./components/SetupPage'));
const MainPage = lazy(() => import('./components/MainPage'));

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

    useEffect(() => {
        checkStatus();
        fetchTtsSettings().catch(() => {});
        void ttsService.preload();
    }, []);

    useEffect(() => {
        if (!isInitialSetupLaunch || isSetupComplete === undefined) return;

        // The initial setup page is prepared in an unattached BrowserView.
        // requestAnimationFrame is paused there, so notify after React commits
        // the SetupPage tree instead of waiting for a browser frame.
        window.ragAPI?.notifyAppReady?.();
    }, [isInitialSetupLaunch, isSetupComplete]);

    useEffect(() => {
        const handleRequest = (event: Event) => setDictionaryRequest((event as CustomEvent<{resolve: (installed: boolean) => void}>).detail);
        window.addEventListener('vyact:japanese-tts-dictionary-required', handleRequest);
        return () => window.removeEventListener('vyact:japanese-tts-dictionary-required', handleRequest);
    }, []);

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
                    <SetupPage onInstallComplete={() => setIsSetupComplete(true)}/>
                )}
            </Suspense>
            <ToastContainer/>
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
        </div>
    );
};

export default App;
