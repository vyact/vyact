import {LoaderCircle} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import './StockChatPreparation.css';

export type StockPreparationProgress = {completed: number; total: number; failed: number};

export default function StockChatPreparation({completed, total, failed}: StockPreparationProgress) {
    const {t} = useTranslation('main');
    return <div className="stock-chat-preparation" role="status" aria-live="polite">
        <div className="stock-chat-preparation-heading"><LoaderCircle size={15} aria-hidden="true"/>
            <strong>{t('stockAnalysis.discussion.preparingTitle')}</strong></div>
        <div className="stock-chat-preparation-count">{t('stockAnalysis.discussion.preparingCount', {completed, total})}</div>
        <progress value={completed} max={Math.max(total, 1)} aria-label={t('stockAnalysis.discussion.preparingTitle')}/>
        {failed > 0 && <p>{t('stockAnalysis.discussion.preparingUnavailable', {count: failed})}</p>}
    </div>;
}
