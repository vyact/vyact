import React, {useCallback, useEffect, useRef, useState} from 'react';
import {PackagePlus, Plug, Trash2, Upload} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import {api} from '../../services/api';
import {emitMcpServersChanged} from '../../utils/mcpEvents';
import {toast} from '../common/ToastNotifications/ToastNotifications';
import ConfirmModal from '../common/ConfirmModal/ConfirmModal';
import './PluginsSection.css';
import PluginSettingsFields from './PluginSettingsFields';
import type {InstalledPlugin} from '../../types';

const getErrorMessage = (error: unknown, fallback: string): string =>
    error instanceof Error && error.message ? error.message : fallback;

const PluginsSection: React.FC = () => {
    const {t} = useTranslation('settings');
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [plugins, setPlugins] = useState<InstalledPlugin[]>([]);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [confirmPlugin, setConfirmPlugin] = useState<InstalledPlugin | null>(null);

    const loadPlugins = useCallback(async () => {
        setLoading(true);
        try {
            const result = await api.getPlugins();
            setPlugins(result.plugins || []);
        } catch (error: unknown) {
            toast.error(getErrorMessage(error, t('plugins.loadFailed')));
        } finally {
            setLoading(false);
        }
    }, [t]);

    useEffect(() => {
        void Promise.resolve().then(loadPlugins);
    }, [loadPlugins]);

    const installPlugin = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file || busy) return;
        setBusy(true);
        try {
            const result = await api.installPlugin(file);
            await loadPlugins();
            emitMcpServersChanged();
            window.dispatchEvent(new Event('vyact:plugins-changed'));
            toast.success(t('plugins.installSuccess', {name: result.plugin.name}));
        } catch (error: unknown) {
            toast.error(getErrorMessage(error, t('plugins.installFailed')));
        } finally {
            setBusy(false);
        }
    };

    const uninstallPlugin = async () => {
        if (!confirmPlugin || busy) return;
        setBusy(true);
        try {
            await api.uninstallPlugin(confirmPlugin.id);
            const removedName = confirmPlugin.name;
            setConfirmPlugin(null);
            await loadPlugins();
            emitMcpServersChanged();
            window.dispatchEvent(new Event('vyact:plugins-changed'));
            toast.success(t('plugins.deleteSuccess', {name: removedName}));
        } catch (error: unknown) {
            toast.error(getErrorMessage(error, t('plugins.deleteFailed')));
        } finally {
            setBusy(false);
        }
    };

    return (
        <section className="plugins-section">
            <div className="plugins-header">
                <div>
                    <h4>{t('plugins.title')}</h4>
                    <p>{t('plugins.description')}</p>
                </div>
                <button
                    type="button"
                    className="plugins-upload-button"
                    disabled={busy}
                    onClick={() => fileInputRef.current?.click()}
                >
                    <Upload size={15}/>
                    {busy ? t('plugins.processing') : t('plugins.upload')}
                </button>
                <input
                    ref={fileInputRef}
                    className="plugins-file-input"
                    type="file"
                    accept=".zip,application/zip"
                    onChange={installPlugin}
                />
            </div>

            <div className="plugins-security-note">
                <PackagePlus size={16}/>
                <span>{t('plugins.securityNote')}</span>
            </div>

            {loading ? (
                <div className="plugins-empty">{t('plugins.loading')}</div>
            ) : plugins.length === 0 ? (
                <div className="plugins-empty">
                    <Plug size={28}/>
                    <strong>{t('plugins.empty')}</strong>
                    <span>{t('plugins.emptyDescription')}</span>
                </div>
            ) : (
                <div className="plugins-list">
                    {plugins.map(plugin => (
                        <article className="plugins-card" key={plugin.id}>
                            <div className="plugins-card-icon"><Plug size={18}/></div>
                            <div className="plugins-card-content">
                                <div className="plugins-card-title">
                                    <strong>{plugin.name}</strong>
                                    <span>v{plugin.version}</span>
                                </div>
                                <p>{plugin.description || plugin.id}</p>
                                {plugin.settings && (
                                    <PluginSettingsFields definition={plugin.settings}/>
                                )}
                                {!!plugin.mcp_types?.length && (
                                    <div className="plugins-tags">
                                        {plugin.mcp_types.map(type => (
                                            <span key={type}>{t('plugins.internalTool')}</span>
                                        ))}
                                    </div>
                                )}
                            </div>
                            <button
                                type="button"
                                className="plugins-delete-button"
                                disabled={busy}
                                onClick={() => setConfirmPlugin(plugin)}
                                title={t('plugins.delete')}
                            >
                                <Trash2 size={16}/>
                            </button>
                        </article>
                    ))}
                </div>
            )}

            {confirmPlugin && <ConfirmModal
                title={t('plugins.confirmTitle', {name: confirmPlugin.name})}
                description={t('plugins.confirmDescription')}
                details={confirmPlugin.removal_items}
                options={[
                    {label: t('plugins.cancel'), value: 'cancel'},
                    {label: t('plugins.deleteAll'), value: 'delete', variant: 'danger'},
                ]}
                actionLayout="horizontal"
                loading={busy}
                loadingValue="delete"
                loadingLabel={t('plugins.processing')}
                onClose={() => setConfirmPlugin(null)}
                onSelect={value => {
                    if (value === 'delete') void uninstallPlugin();
                    else setConfirmPlugin(null);
                }}
            />}
        </section>
    );
};

export default PluginsSection;
