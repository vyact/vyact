import React, {useEffect, useState} from 'react';
import SetupPage from './components/SetupPage';
import MainPage from './components/MainPage';
import ToastContainer from './components/common/ToastNotifications/ToastNotifications';
import {api} from './services/api';
import {fetchTtsSettings} from './services/tts/ttsSettings';
import {ttsService} from './services/tts/ttsService';
import './App.css';

const App: React.FC = () => {
    const [isSetupComplete, setIsSetupComplete] = useState<boolean | undefined>(undefined);

    useEffect(() => {
        checkStatus();
        fetchTtsSettings().catch(() => {});
        void ttsService.preload();
    }, []);

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
            {isSetupComplete ? (
                <MainPage onModelChange={() => {}}/>
            ) : (
                <SetupPage onInstallComplete={() => setIsSetupComplete(true)}/>
            )}
            <ToastContainer/>
        </div>
    );
};

export default App;
