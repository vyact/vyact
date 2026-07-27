import React, {useEffect, useRef, useState, useCallback} from 'react';
import {useTranslation} from 'react-i18next';
import {api} from '../../services/api';
import {
    refreshGoogleWorkspaceStatus,
} from '../../services/googleWorkspaceStatus';
import {emitMcpServersChanged, onMcpServersChanged} from '../../utils/mcpEvents';
import type {McpCatalogEntry, McpServer} from '../../types';

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
            }
            Promise.all([
                api.getMcpServers(),
                refreshGoogleWorkspaceStatus().catch(() => ({connected: false})),
            ])
                .then(([serverResult, googleStatus]) => {
                    setServers(serverResult.servers || []);
                    setGoogleConnected(Boolean(googleStatus.connected));
                })
                .catch(() => {/* noop */});
        };
        refreshBadge();
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
        <div ref={menuRef} style={{position: 'relative', flexShrink: 0}}>
            <button
                onClick={() => setOpen(v => !v)}
                disabled={disabled}
                style={{
                    height: '30px', padding: '0 10px', background: 'transparent',
                    border: 'none', borderRadius: '10px', cursor: disabled ? 'not-allowed' : 'pointer',
                    color: enabledCount > 0 ? 'var(--accent)' : '#b0b0b8',
                    display: 'flex', alignItems: 'center', gap: '5px',
                    transition: 'background 0.2s', flexShrink: 0, fontSize: '12px', fontWeight: 600,
                }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--surface2)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="3" width="7" height="7" rx="1"/>
                    <rect x="14" y="3" width="7" height="7" rx="1"/>
                    <rect x="3" y="14" width="7" height="7" rx="1"/>
                    <path d="M17.5 14v3.5M14 17.5h7"/>
                </svg>
                <span>MCP</span>
                {enabledCount > 0 && (
                    <span style={{
                        fontSize: '11px', fontWeight: 700, minWidth: '16px', height: '16px',
                        padding: '0 4px', borderRadius: '8px', background: 'var(--accent)',
                        color: '#fff', display: 'inline-flex', alignItems: 'center',
                        justifyContent: 'center', lineHeight: 1,
                    }}>{enabledCount}</span>
                )}
            </button>

            {open && (
                <div style={{
                    position: 'absolute', bottom: '45px', left: '0',
                    background: 'var(--surface)', border: '1px solid var(--border)',
                    borderRadius: '10px', boxShadow: '0 4px 16px rgba(0,0,0,0.35)',
                    minWidth: '240px', maxWidth: '320px', maxHeight: '50vh',
                    display: 'flex', flexDirection: 'column',
                    zIndex: 1000,
                }}>
                    <div style={{
                        padding: '10px 14px 8px', fontSize: '12px', fontWeight: 600,
                        color: 'var(--muted)', borderBottom: '1px solid var(--border)',
                        flexShrink: 0,
                    }}>
                        {t('mcpMenu.title')}
                    </div>

                    <div style={{overflowY: 'auto', flex: 1}}>
                        {loading && visibleServers.length === 0 && (
                            <div style={{padding: '14px', fontSize: '13px', color: 'var(--muted)'}}>{t('mcpMenu.loading')}</div>
                        )}

                        {!loading && visibleServers.length === 0 && (
                            <div style={{padding: '14px', fontSize: '13px', color: 'var(--muted)'}}>
                                {t('mcpMenu.empty')}<br/>{t('mcpMenu.emptyHint')}
                            </div>
                        )}

                        {visibleServers.map(srv => (
                            <div
                                key={srv.id}
                                onClick={() => toggle(srv)}
                                style={{
                                    padding: '11px 14px', display: 'flex', alignItems: 'center',
                                    gap: '10px', cursor: busyId ? 'wait' : 'pointer',
                                    transition: 'background 0.15s',
                                }}
                                onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
                                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                            >
                                <div style={{flex: 1, minWidth: 0}}>
                                    <div style={{
                                        fontSize: '13px', fontWeight: 600, color: 'var(--text)',
                                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                                    }}>{serverName(srv)}</div>
                                </div>

                                {/* switch */}
                                <div style={{
                                    width: '38px', height: '22px', borderRadius: '11px',
                                    background: srv.enabled ? 'var(--accent)' : 'var(--surface2)',
                                    position: 'relative', transition: 'background 0.2s',
                                    flexShrink: 0, opacity: busyId === srv.id ? 0.6 : 1,
                                }}>
                                    <div style={{
                                        position: 'absolute', top: '2px',
                                        left: srv.enabled ? '18px' : '2px',
                                        width: '18px', height: '18px', borderRadius: '50%',
                                        background: '#fff', transition: 'left 0.2s',
                                        boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
                                    }}/>
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
