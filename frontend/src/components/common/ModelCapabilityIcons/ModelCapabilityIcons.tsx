import {Image, Mic} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import './ModelCapabilityIcons.css';

export default function ModelCapabilityIcons({image = false, audio = false}: {image?: boolean; audio?: boolean}) {
    const {t} = useTranslation('main');
    if (!image && !audio) return null;
    return <span className="model-capability-icons">
        {image && <span role="img" aria-label={t('modelSelector.visionCapability')}><Image size={11} strokeWidth={1.7} aria-hidden="true"/></span>}
        {audio && <span role="img" aria-label={t('modelSelector.audioCapability')}><Mic size={11} strokeWidth={1.7} aria-hidden="true"/></span>}
    </span>;
}
