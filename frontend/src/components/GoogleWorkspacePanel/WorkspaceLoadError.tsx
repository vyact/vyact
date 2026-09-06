import {useTranslation} from 'react-i18next';
import {AlertCircle, RefreshCw} from 'lucide-react';
import './WorkspaceLoadError.css';

export default function WorkspaceLoadError({message, onRetry, busy = false}: {
    message: string;
    onRetry: () => void;
    busy?: boolean;
}) {
    const {t} = useTranslation('main');
    return <div className="gwp-load-error" role="alert">
        <AlertCircle aria-hidden="true" size={24}/>
        <strong>{t('networkError.requestFailed')}</strong>
        <p>{message}</p>
        <button type="button" className="gwp-refresh" onClick={onRetry} disabled={busy}>
            <RefreshCw aria-hidden="true" size={16}/>{t('common:retry')}
        </button>
    </div>;
}
