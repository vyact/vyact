import React, {useEffect, useRef, useState, useCallback} from 'react';
import {useTranslation} from 'react-i18next';
import {Grid2x2Plus} from 'lucide-react';
import {api} from '../../services/api';
import {
    getGoogleWorkspaceStatus,
    refreshGoogleWorkspaceStatus,
    updateGoogleWorkspaceServerStatus,
} from '../../services/googleWorkspaceStatus';
import {emitMcpServersChanged, onMcpServersChanged} from '../../utils/mcpEvents';
import type {McpCatalogEntry, McpServer} from '../../types';
import './McpMenu.css';

interface McpMenuProps {
    disabled?: boolean;
}

const McpMenu: React.FC<McpMenuProps> = ({disabled = false}) => {
    const [open, setOpen] = useState(false);
    const [servers, setServers] = useState<McpServer[]>([]);
    const [labels, setLabels] = useState<Record<string, string>>({});
    const [loading, setLoading] = useState(false);
    const [busyId, setBusyId] = useState<string | null>(null);
    const [googleConnected, setGoogleConnected] = useState<boolean | null>(null);
    const {t} = useTranslation(['main', 'settings']);
    const menuRef = useRef<HTMLDivElement>(null);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const [s, c] = await Promise.all([
                api.getMcpServers(),
                api.getMcpCatalog().catch(() => ({catalog: {}})),
            ]);
            setServers(s.servers || []);
            const lbl: Record<string, string> = {};
            const catalog: Record<string, McpCatalogEntry> = c.catalog || {};
            Object.entries(catalog).forEach(([type, entry]) => {
                lbl[type] = entry.label || type;
            });
            setLabels(lbl);
        } catch {
            /* noop */
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (open) {
            void Promise.resolve().then(load);
        }
    }, [open, load]);

    // 마운트 시 서버와 Google 연결 상태를 함께 불러온다.
    // 연결 확인 전/미연결 상태의 Google Workspace는 MCP 목록과 뱃지에서 제외한다.
    useEffect(() => {
        const refreshBadge = (fresh?: McpServer[]) => {
            if (fresh) {
                setServers(fresh);
                const googleStatus = updateGoogleWorkspaceServerStatus(fresh);
                setGoogleConnected(Boolean(googleStatus.connected));
                return;
            }
            refreshGoogleWorkspaceStatus()
                .then(googleStatus => {
                    setServers(googleStatus.mcpServers);
                    setGoogleConnected(Boolean(googleStatus.connected));
                })
                .catch(() => {/* noop */});
        };
        getGoogleWorkspaceStatus()
            .then(googleStatus => {
                setServers(googleStatus.mcpServers);
                setGoogleConnected(Boolean(googleStatus.connected));
            })
            .catch(() => {/* noop */});
        const unsubscribeMcp = onMcpServersChanged(refreshBadge);
        const refreshGoogleStatus = (event: Event) => {
            const status = (event as CustomEvent).detail?.status;
            if (status) {
                setGoogleConnected(Boolean(status.connected));
                return;
            }
            refreshGoogleWorkspaceStatus()
                .then(status => setGoogleConnected(Boolean(status.connected)))
                .catch(() => setGoogleConnected(false));
        };
        window.addEventListener('vyact:google-workspace-status-changed', refreshGoogleStatus);
        return () => {
            unsubscribeMcp();
            window.removeEventListener('vyact:google-workspace-status-changed', refreshGoogleStatus);
        };
    }, []);

    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
        };
        if (open) document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [open]);

    const toggle = async (srv: McpServer) => {
        if (busyId) return;
        const next = !srv.enabled;

        setBusyId(srv.id);
        // 낙관적 업데이트
        setServers(prev => prev.map(s => s.id === srv.id ? {...s, enabled: next} : s));
        try {
            const res = await api.updateMcpServer(srv.id, {enabled: next});
            if (res?.servers) setServers(res.servers);
            emitMcpServersChanged(res?.servers);
        } catch {
            // 롤백
            setServers(prev => prev.map(s => s.id === srv.id ? {...s, enabled: srv.enabled} : s));
            emitMcpServersChanged();
        } finally {
            setBusyId(null);
        }
    };

    const serverName = (srv: McpServer): string => {
        const customName = srv.config?.name;
        if (srv.type === 'custom' && typeof customName === 'string') return customName;
        return t('settings:mcpCatalog.servers.' + srv.type, {defaultValue: labels[srv.type] || srv.type});
    };

    const visibleServers = servers.filter(
        server => server.type !== 'google_workspace' || googleConnected === true,
    );
    const enabledCount = visibleServers.filter(server => server.enabled).length;

    return (
        <div className="mcp-menu" ref={menuRef}>
            <button
                className={`mcp-menu-trigger${enabledCount > 0 ? ' active' : ''}`}
                onClick={() => setOpen(v => !v)}
                disabled={disabled}
                aria-label={t('mcpMenu.title')}
            >
                <Grid2x2Plus size={18}/>
                {enabledCount > 0 && (
                    <span className="mcp-menu-count">{enabledCount}</span>
                )}
            </button>

            {open && (
                <div className="mcp-menu-popover">
                    <div className="mcp-menu-header">
                        {t('mcpMenu.title')}
                    </div>

                    <div className="mcp-menu-list">
                        {loading && visibleServers.length === 0 && (
                            <div className="mcp-menu-empty">{t('mcpMenu.loading')}</div>
                        )}

                        {!loading && visibleServers.length === 0 && (
                            <div className="mcp-menu-empty">
                                {t('mcpMenu.empty')}<br/>{t('mcpMenu.emptyHint')}
                            </div>
                        )}

                        {visibleServers.map(srv => (
                            <div
                                key={srv.id}
                                onClick={() => toggle(srv)}
                                className={`mcp-menu-server${busyId ? ' busy' : ''}`}
                            >
                                <div className="mcp-menu-server-info">
                                    <div className="mcp-menu-server-name">{serverName(srv)}</div>
                                </div>

                                {/* switch */}
                                <div className={`mcp-menu-switch${srv.enabled ? ' enabled' : ''}${busyId === srv.id ? ' busy' : ''}`}>
                                    <div className="mcp-menu-switch-knob"/>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};

export default McpMenu;
