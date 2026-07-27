import {ExternalLink, X} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import {VYACT_ICON_URL} from '../../../constants/assets';
import ModalOverlay from '../ModalOverlay/ModalOverlay';
import './SupportModal.css';

interface SupportModalProps {
    onClose: () => void;
}

const SUPPORT_OPTIONS = [
    {href: 'https://paypal.me/vyact', labelKey: 'supportModal.paypal'},
    {href: 'https://ko-fi.com/vyact', labelKey: 'supportModal.kofi'},
] as const;

const SupportModal = ({onClose}: SupportModalProps) => {
    const {t} = useTranslation('main');

    return (
        <ModalOverlay className="support-modal-overlay" onClose={onClose} closeOnBackdrop blur={3}>
            <section className="support-modal" aria-labelledby="support-modal-title">
                <header className="support-modal-header">
                    <h2 id="support-modal-title">{t('supportModal.title')}</h2>
                    <button type="button" onClick={onClose} aria-label={t('supportModal.close')}>
                        <X size={18} aria-hidden="true"/>
                    </button>
                </header>
                <div className="support-modal-body">
                    <img className="support-modal-logo" src={VYACT_ICON_URL} alt="" aria-hidden="true"/>
                    <p className="support-modal-message">{t('supportModal.message')}</p>
                    <div className="support-modal-options">
                        {SUPPORT_OPTIONS.map(option => (
                            <a key={option.href} href={option.href} target="_blank" rel="noopener noreferrer">
                                <span>{t(option.labelKey)}</span>
                                <ExternalLink size={15} aria-hidden="true"/>
                            </a>
                        ))}
                    </div>
                    <p className="support-modal-note">{t('supportModal.note')}</p>
                </div>
            </section>
        </ModalOverlay>
    );
};

export default SupportModal;
