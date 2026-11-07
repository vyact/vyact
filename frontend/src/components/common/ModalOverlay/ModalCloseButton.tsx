import type {ButtonHTMLAttributes} from 'react';
import {X} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import './ModalCloseButton.css';

export default function ModalCloseButton({className = '', ...props}: ButtonHTMLAttributes<HTMLButtonElement>) {
    const {t} = useTranslation('common');
    return <button type="button" aria-label={t('close')} {...props} className={`app-modal-close ${className}`.trim()}>
        <X size={20} strokeWidth={2} aria-hidden="true"/>
    </button>;
}
