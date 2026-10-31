import '../common/HelpIcon.css';
import {orderMcpServersForDisplay} from '../../utils/mcpOrder';
import {getCustomMcpName} from '../../utils/mcpDisplayName';
import React, {useEffect, useRef, useState, useCallback} from 'react';
import {useTranslation} from 'react-i18next';
import {Wrench} from 'lucide-react';
import {api} from '../../services/api';
import {
    getGoogleWorkspaceStatus,
    refreshGoogleWorkspaceStatus,
    updateGoogleWorkspaceServerStatus,
} from '../../services/googleWorkspaceStatus';
import {emitMcpServersChanged, onMcpServersChanged} from '../../utils/mcpEvents';
import type {McpCatalogEntry, McpServer} from '../../types';
import {Tooltip} from '../common/Tooltip/Tooltip';
import './McpMenu.css';

interface McpMenuProps {
    disabled?: boolean;
    selection?: {
        servers: McpServer[];
        onChange: (servers: McpServer[]) => void;
        scopeHelp: string;
    };
}

const McpMenu: React.FC<McpMenuProps> = ({disabled = false, selection}) => {
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
        if (disabled || busyId) return;
        if (selection) {
            selection.onChange(selection.servers.some(server => server.id === srv.id)
                ? selection.servers.filter(server => server.id !== srv.id)
                : [...selection.servers, srv]);
            return;
        }
        const next = !srv.enabled;
        const apiKey = srv.config?.api_key;
        if (next && srv.type === 'web_search' && !(typeof apiKey === 'string' && apiKey.trim())) {
            setOpen(false);
            window.dispatchEvent(new CustomEvent('vyact:open-settings', {
                detail: {tab: 'api', mcpServerId: srv.id},
            }));
            return;
        }

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
        const customName = getCustomMcpName(srv);
        if (customName) return customName;
        return t('settings:mcpCatalog.servers.' + srv.type, {defaultValue: labels[srv.type] || srv.type});
    };

    const visibleServers = orderMcpServersForDisplay(servers).filter(
        server => server.type !== 'google_workspace' || googleConnected === true,
    );
    const isSelected = (server: McpServer) => selection
        ? selection.servers.some(selected => selected.id === server.id)
        : server.enabled;
    const enabledCount = visibleServers.filter(isSelected).length;
    const scopeHelp = selection?.scopeHelp ?? t('mcpMenu.scopeHelp');

    return (
        <div className="mcp-menu" ref={menuRef}>
            <button
                type="button"
                aria-expanded={open}
                className={`mcp-menu-trigger${enabledCount > 0 ? ' active' : ''}`}
                onClick={() => setOpen(v => !v)}
                disabled={disabled}
                aria-label={t('mcpMenu.title')}
            >
                <Wrench size={17} strokeWidth={2} aria-hidden="true"/>
                {enabledCount > 0 && (
                    <span className="mcp-menu-count">{enabledCount}</span>
                )}
            </button>

            {open && !disabled && (
                <div className="mcp-menu-popover">
                    <div className="mcp-menu-header">
                        <Tooltip content={scopeHelp} multiline>
                            <button type="button" className="help-icon-button" aria-label={scopeHelp}>?</button>
                        </Tooltip>
                        <span>{t('mcpMenu.title')}</span>
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
                                role="switch"
                                aria-checked={isSelected(srv)}
                                aria-label={serverName(srv)}
                                tabIndex={0}
                                onKeyDown={event => {
                                    if (event.key === 'Enter' || event.key === ' ') {
                                        event.preventDefault();
                                        void toggle(srv);
                                    }
                                }}
                                onClick={() => void toggle(srv)}
                                className={`mcp-menu-server${busyId ? ' busy' : ''}`}
                            >
                                <div className="mcp-menu-server-info">
                                    <div className="mcp-menu-server-name">{serverName(srv)}</div>
                                </div>

                                {/* switch */}
                                <div className={`mcp-menu-switch${isSelected(srv) ? ' enabled' : ''}${busyId === srv.id ? ' busy' : ''}`}>
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
