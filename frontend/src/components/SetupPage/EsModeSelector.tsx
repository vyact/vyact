import React from 'react';
import { useTranslation } from 'react-i18next';

export type EsMode = 'docker' | 'native';

interface EsModeSelectorProps {
    esMode: EsMode;
    onChange: (mode: EsMode) => void;
    dockerAvailable: boolean | null;
    nativeSupported: boolean | null;
}

const EsModeSelector: React.FC<EsModeSelectorProps> = ({
                                                           esMode, onChange, dockerAvailable, nativeSupported,
                                                       }) => {
    const { t } = useTranslation('settings');
    const dockerChecking = dockerAvailable === null;
    const nativeChecking = nativeSupported === null;
    const dockerDisabled = dockerAvailable === false;
    const nativeDisabled = nativeSupported === false;

    return (
        <>
            <div className="sec-label" style={{ marginTop: '14px' }}>{t('esMode.title')}</div>
            <div className="es-mode-grid">
                <div
                    className={`es-mode-item ${esMode === 'docker' ? 'selected' : ''} ${dockerChecking || dockerDisabled ? 'disabled' : ''}`}
                    onClick={() => dockerAvailable === true && onChange('docker')}
                    title={dockerDisabled ? t('esMode.dockerUnavailableTitle') : ''}
                >
                    <div className="es-mode-name">{t('esMode.dockerName')}</div>
                    <div className="es-mode-desc">
                        {dockerChecking
                            ? t('esMode.checking')
                            : dockerDisabled
                                ? t('esMode.dockerUnavailable')
                                : t('esMode.dockerAvailable')}
                    </div>
                </div>
                <div
                    className={`es-mode-item ${esMode === 'native' ? 'selected' : ''} ${nativeChecking || nativeDisabled ? 'disabled' : ''}`}
                    onClick={() => nativeSupported === true && onChange('native')}
                    title={nativeDisabled ? t('esMode.nativeUnavailableTitle') : ''}
                >
                    <div className="es-mode-name">{t('esMode.nativeName')}</div>
                    <div className="es-mode-desc">
                        {nativeChecking
                            ? t('esMode.checking')
                            : nativeDisabled
                                ? t('esMode.nativeUnavailable')
                                : t('esMode.nativeAvailable')}
                    </div>
                </div>
            </div>
        </>
    );
};

export default EsModeSelector;
