import {ArrowUpRight, Sparkles, X} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import ModalOverlay from '../common/ModalOverlay/ModalOverlay';
import './ProductReleaseModal.css';

interface ProductReleaseModalProps {
    title: string;
    message: string;
    url?: string;
    important?: boolean;
    onClose: () => void;
}

function openReleaseUrl(url: string): void {
    let parsedUrl: URL;
    try {
        parsedUrl = new URL(url);
    } catch {
        return;
    }
    if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') return;
    if (window.ragAPI?.openExternal) {
        void window.ragAPI.openExternal(parsedUrl.toString());
        return;
    }
    window.open(parsedUrl.toString(), '_blank', 'noopener,noreferrer');
}

export default function ProductReleaseModal({
    title,
    message,
    url,
    important = false,
    onClose,
}: ProductReleaseModalProps) {
    const {t} = useTranslation('main');

    return (
        <ModalOverlay className="product-release-overlay" onClose={onClose} closeOnBackdrop blur={5}>
            <article className="product-release-modal" aria-labelledby="product-release-title">
                <div className="product-release-hero">
                    <div className={`product-release-icon${important ? ' important' : ''}`}>
                        <Sparkles size={28} strokeWidth={1.8} aria-hidden="true"/>
                    </div>
                    <button className="product-release-close" type="button" onClick={onClose}
                            aria-label={t('productReleaseModal.close')}>
                        <X size={19} aria-hidden="true"/>
                    </button>
                    <span className="product-release-eyebrow">{t('productReleaseModal.eyebrow')}</span>
                    <h2 id="product-release-title">{title}</h2>
                </div>

                <div className="product-release-body">
                    <div className="product-release-message">{message}</div>
                    <footer className="product-release-footer">
                        <button className="product-release-dismiss" type="button" onClick={onClose}>
                            {t('productReleaseModal.confirm')}
                        </button>
                        {url && <button className="product-release-link" type="button"
                            onClick={() => openReleaseUrl(url)}>
                            {t('productReleaseModal.viewDetails')}
                            <ArrowUpRight size={16} aria-hidden="true"/>
                        </button>}
                    </footer>
                </div>
            </article>
        </ModalOverlay>
    );
}
