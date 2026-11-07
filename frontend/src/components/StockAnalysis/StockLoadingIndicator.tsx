import {LoaderCircle} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import './StockLoadingIndicator.css';

export default function StockLoadingIndicator({title, overlay = false, iconOnly = false}: {title: string; overlay?: boolean; iconOnly?: boolean}) {
    const {t} = useTranslation('main');
    return <div className={`stock-loading${overlay ? ' stock-loading-overlay' : ''}${iconOnly ? ' stock-loading-icon-only' : ''}`} role="status" aria-live="polite" aria-label={t('stockAnalysis.loading')}>
        <div className="stock-loading-card">
            <span className="stock-loading-icon"><LoaderCircle size={28} aria-hidden="true"/></span>
            {!iconOnly && <><strong>{title}</strong><p>{t('stockAnalysis.loading')}</p></>}
        </div>
    </div>;
}
