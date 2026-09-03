import {Download, ExternalLink, RefreshCw, RotateCcw} from 'lucide-react';
import {useEffect, useState} from 'react';
import {useTranslation} from 'react-i18next';
import './AppUpdateNotice.css';

export default function AppUpdateNotice() {
    const {t} = useTranslation('main');
    const [update, setUpdate] = useState<AppUpdateState | null>(null);

    useEffect(() => {
        let active = true;
        const unsubscribe = window.ragAPI?.onAppUpdateState?.(state => {
            if (active) setUpdate(state);
        });
        void window.ragAPI?.checkAppUpdate?.().then(state => {
            if (active) setUpdate(state);
        }).catch(() => {});
        return () => {
            active = false;
            unsubscribe?.();
        };
    }, []);

    if (!update?.available || !update.latestVersion) return null;

    const isManual = update.updateMode === 'manual';
    const isDownloading = update.status === 'downloading';
    const isDownloaded = update.status === 'downloaded';
    const isInstalling = update.status === 'installing';
    const hasError = update.status === 'error';
    const actionLabel = isManual
        ? t('sidebar.appUpdate.viewRelease')
        : isInstalling
            ? t('sidebar.appUpdate.restarting')
            : isDownloaded
            ? t('sidebar.appUpdate.restartToUpdate')
            : hasError
                ? t('sidebar.appUpdate.retry')
                : isDownloading
                    ? t('sidebar.appUpdate.downloading', {progress: update.progress ?? 0})
                    : t('sidebar.appUpdate.download');
    const ActionIcon = isManual ? ExternalLink : isDownloaded ? RotateCcw : hasError ? RefreshCw : Download;

    const handleClick = () => {
        if (isManual) {
            if (update.releaseUrl) void window.ragAPI?.openExternal?.(update.releaseUrl);
            return;
        }
        if (isDownloaded) {
            void window.ragAPI?.installAppUpdate?.();
            return;
        }
        void window.ragAPI?.downloadAppUpdate?.();
    };

    return (
        <section className="sidebar-app-update" aria-label={t('sidebar.appUpdate.available', {version: update.latestVersion})}>
            <div className="sidebar-app-update-copy">
                <Download size={16} aria-hidden="true"/>
                <span>
                    <strong>{t('sidebar.appUpdate.title')}</strong>
                    <small>{hasError
                        ? t('sidebar.appUpdate.failed')
                        : t('sidebar.appUpdate.version', {version: update.latestVersion})}</small>
                </span>
            </div>
            {isDownloading && <div className="sidebar-app-update-progress" aria-hidden="true">
                <span style={{width: `${Math.max(0, Math.min(100, update.progress ?? 0))}%`}}/>
            </div>}
            <button type="button" onClick={handleClick} disabled={isDownloading || isInstalling}>
                <ActionIcon size={14} aria-hidden="true"/>
                {actionLabel}
            </button>
        </section>
    );
}
