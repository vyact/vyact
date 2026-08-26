import {useEffect, useState} from 'react';
import {X} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import {api, type VyactModelProfile} from '../../services/api';
import ModalOverlay from '../common/ModalOverlay/ModalOverlay';
import './ModelSettingsModal.css';

interface Props {
    modelPath: string;
    runtime: 'gguf' | 'mlx';
    repository?: string;
    recommendedContext?: number;
    activateOnApply?: boolean;
    mtpEnabled?: boolean;
    onClose: () => void;
    onApplied: () => Promise<void>;
}

export default function ModelSettingsModal({modelPath, runtime, repository, recommendedContext = 32768, activateOnApply = false, mtpEnabled = false, onClose, onApplied}: Props) {
    const {t} = useTranslation('main');
    const [profile, setProfile] = useState<VyactModelProfile | null>(null);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        void api.getVyactModelProfile(modelPath, runtime, repository, recommendedContext)
            .then(value => setProfile({...value, cache_quantization: mtpEnabled ? false : value.cache_quantization}))
            .catch(value => setError(String(value)));
    }, [modelPath, runtime, repository, recommendedContext, mtpEnabled]);

    const updateNumber = (key: keyof VyactModelProfile, value: string, nullable = false) => {
        if (!profile) return;
        setProfile({...profile, [key]: nullable && value === '' ? null : Number(value)});
    };
    const apply = async () => {
        if (!profile) return;
        setSaving(true);
        setError('');
        try {
            const saved = await api.saveVyactModelProfile(profile);
            if (activateOnApply) await api.activateVyactModel(modelPath, saved.context_size, undefined, runtime, repository, saved);
            await onApplied();
            onClose();
        } catch (value) {
            setError(String(value));
        } finally {
            setSaving(false);
        }
    };

    return <ModalOverlay className="model-settings-overlay" onClose={onClose} closeOnBackdrop>
        <div className="model-settings-modal">
            <header><div><h2>{t('modelSettings.title')}</h2><p title={modelPath}>{modelPath.split('/').pop()}</p></div><button type="button" onClick={onClose} aria-label={t('modelSettings.close')}><X size={20}/></button></header>
            {!profile ? <div className="model-settings-loading">{error || t('modelSettings.loading')}</div> : <div className="model-settings-body">
                <p className="model-settings-description">{t('modelSettings.description')}</p>
                <label><span>{t('modelSettings.context')}</span><input className="model-settings-input" type="number" min="512" max="131072" value={profile.context_size} onChange={e => updateNumber('context_size', e.target.value)}/></label>
                <label><span>{t('modelSettings.maxOutput')}</span><input className="model-settings-input" type="number" min="1" max="32768" value={profile.max_output_tokens} onChange={e => updateNumber('max_output_tokens', e.target.value)}/></label>
                <label><span>{t('modelSettings.temperature')}</span><input className="model-settings-input" type="number" min="0" max="1" step="0.01" value={profile.temperature} onChange={e => updateNumber('temperature', e.target.value)}/></label>
                <label><span>{t('modelSettings.topK')}</span><input className="model-settings-input" type="number" min="0" max="100" value={profile.top_k ?? ''} placeholder={t('modelSettings.modelDefault')} onChange={e => updateNumber('top_k', e.target.value, true)}/></label>
                <label><span>{t('modelSettings.topP')}</span><input className="model-settings-input" type="number" min="0" max="1" step="0.01" value={profile.top_p ?? ''} placeholder={t('modelSettings.modelDefault')} onChange={e => updateNumber('top_p', e.target.value, true)}/></label>
                <div className={`model-settings-toggle${mtpEnabled ? ' is-disabled' : ''}`}><span><strong>{t('modelSettings.cacheQuantization')}</strong><small>{t(mtpEnabled ? 'modelSettings.cacheQuantizationMtpHelp' : 'modelSettings.cacheQuantizationHelp')}</small></span><button type="button" className={`model-settings-switch${profile.cache_quantization ? ' is-on' : ''}`} role="switch" aria-checked={profile.cache_quantization} disabled={mtpEnabled} onClick={() => setProfile({...profile, cache_quantization: !profile.cache_quantization})}><span/></button></div>
                {error && <div className="model-settings-error">{error}</div>}
            </div>}
            <footer><button type="button" onClick={onClose}>{t('modelSettings.cancel')}</button><button className="primary" type="button" disabled={!profile || saving} onClick={() => void apply()}>{saving ? t('modelSettings.applying') : t('modelSettings.apply')}</button></footer>
        </div>
    </ModalOverlay>;
}
