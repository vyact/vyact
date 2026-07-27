import React from 'react';
import {useTranslation} from 'react-i18next';
import type { Conversation } from '../../types';
import {usePluginExtensions} from '../../plugins/usePluginExtensions';
import {openPluginModal, openPluginPanel} from '../../plugins/registry';

interface Action {
    icon: React.ReactNode;
    label: string;
    badge?: string[];
    action: () => void;
}

interface CommandPaletteProps {
    query: string;
    onQueryChange: (q: string) => void;
    onClose: () => void;
    conversations: Conversation[];
    onNewConversation: () => void;
    onLoadConversation: (conversation: Conversation) => void;
    onOpenDocument: () => void;
    onOpenMemo: () => void;
    onOpenRemember: () => void;
    onOpenVoiceChat: () => void;
}

const CommandPalette: React.FC<CommandPaletteProps> = ({
                                                           query, onQueryChange, onClose,
                                                           conversations, onNewConversation, onLoadConversation,
                                                           onOpenDocument, onOpenMemo, onOpenRemember, onOpenVoiceChat,
                                                       }) => {
    const {t} = useTranslation('main');
    const {commandPalette: pluginActions} = usePluginExtensions();
    const q = query.trim().toLowerCase();

    const filteredConvs = q
        ? conversations.filter(c => (c.title || t('commandPalette.newChat')).toLowerCase().includes(q)).slice(0, 5)
        : conversations.slice(0, 5);

    const QUICK_ACTIONS: Action[] = [
        {
            icon: (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                </svg>
            ),
            label: t('commandPalette.newChat'),
            badge: ['⌘', '1'],
            action: () => { onNewConversation(); onClose(); },
        },
    ];

    const TASK_ACTIONS: Action[] = [
        ...pluginActions.map(item => ({
            icon: React.createElement(item.icon, {size: 15}),
            label: item.label,
            action: () => {
                if (item.panelId) openPluginPanel(item.panelId);
                else openPluginModal(item.modalId);
                onClose();
            },
        })),
        {
            icon: (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                    <polyline points="14 2 14 8 20 8"/>
                    <line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
                </svg>
            ),
            label: t('commandPalette.documents'),
            action: () => { onOpenDocument(); onClose(); },
        },
        {
            icon: (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                    <polyline points="14 2 14 8 20 8"/>
                    <line x1="16" y1="13" x2="8" y2="13"/>
                    <line x1="16" y1="17" x2="8" y2="17"/>
                </svg>
            ),
            label: t('commandPalette.memo'),
            action: () => { onOpenMemo(); onClose(); },
        },
        {
            icon: (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 2a5 5 0 1 0 0 10A5 5 0 0 0 12 2z"/>
                    <path d="M12 14c-7 0-9 3-9 4v1h18v-1c0-1-2-4-9-4z"/>
                    <path d="M18 8l2 2-6 6-3-3 2-2 1 1z"/>
                </svg>
            ),
            label: t('commandPalette.aiProfile'),
            action: () => { onOpenRemember(); onClose(); },
        },
        {
            icon: (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                    <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                    <line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>
                </svg>
            ),
            label: t('commandPalette.voiceMode'),
            action: () => { onOpenVoiceChat(); onClose(); },
        },
    ];

    const filteredQuick = q ? QUICK_ACTIONS.filter(a => a.label.toLowerCase().includes(q)) : QUICK_ACTIONS;
    const filteredTasks = q ? TASK_ACTIONS.filter(a => a.label.toLowerCase().includes(q)) : TASK_ACTIONS;

    const itemStyle: React.CSSProperties = {
        display: 'flex', alignItems: 'center', gap: '12px',
        padding: '9px 18px', cursor: 'pointer',
        color: 'var(--text)', fontSize: '14px',
        transition: 'background 0.12s',
    };

    const sectionLabelStyle: React.CSSProperties = {
        padding: '8px 18px 4px', fontSize: 'var(--modal-label)',
        color: 'var(--muted)', letterSpacing: '0.5px', fontWeight: 600,
    };

    const onHover = (e: React.MouseEvent<HTMLDivElement>) =>
        (e.currentTarget.style.background = 'rgba(255,255,255,0.06)');
    const offHover = (e: React.MouseEvent<HTMLDivElement>) =>
        (e.currentTarget.style.background = 'transparent');

    return (
        <div
            style={{
                position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
                display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
                zIndex: 20000, paddingTop: '12vh',
            }}
            onClick={onClose}
        >
            <div
                onClick={e => e.stopPropagation()}
                style={{
                    background: 'var(--modal-bg)', border: '1px solid var(--border)',
                    borderRadius: '14px', width: '100%', maxWidth: '640px',
                    boxShadow: '0 24px 80px rgba(0,0,0,0.6)', overflow: 'hidden',
                    margin: '0 20px',
                }}
            >
                {/* 검색 입력 */}
                <div style={{
                    display: 'flex', alignItems: 'center', gap: '10px',
                    padding: '14px 18px', borderBottom: '1px solid var(--border)',
                }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="2">
                        <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                    </svg>
                    <input
                        autoFocus
                        value={query}
                        onChange={e => onQueryChange(e.target.value)}
                        onKeyDown={e => {
                            if (e.key === 'Escape') onClose();
                            if (e.key === 'Enter' && filteredQuick[0]) filteredQuick[0].action();
                        }}
                        placeholder={t('commandPalette.searchPlaceholder')}
                        style={{
                            flex: 1, background: 'transparent', border: 'none', outline: 'none',
                            color: 'var(--text)', fontSize: 'var(--modal-text)',
                        }}
                    />
                    <button onClick={onClose} style={{
                        background: 'var(--surface2)', border: '1px solid var(--border)',
                        borderRadius: '5px', color: 'var(--muted)', cursor: 'pointer',
                        fontSize: '11px', padding: '2px 6px', lineHeight: 1.5,
                    }}>✕</button>
                </div>

                <div style={{ maxHeight: '60vh', overflowY: 'auto', padding: '6px 0' }}>
                    {/* 빠른 작업 */}
                    {filteredQuick.length > 0 && (
                        <>
                            <div style={sectionLabelStyle}>{t('commandPalette.quickActions')}</div>
                            {filteredQuick.map(a => (
                                <div key={a.label} onClick={a.action} style={itemStyle}
                                     onMouseEnter={onHover} onMouseLeave={offHover}>
                                    <span style={{ color: 'var(--muted)', display: 'flex', alignItems: 'center' }}>{a.icon}</span>
                                    <span style={{ flex: 1 }}>{a.label}</span>
                                    {a.badge && (
                                        <div style={{ display: 'flex', gap: '3px', alignItems: 'center' }}>
                                            {a.badge.map((b, i) => (
                                                <kbd key={i} style={{
                                                    background: 'var(--surface2)', border: '1px solid var(--border)',
                                                    borderRadius: '4px', padding: '1px 6px', fontSize: '11px',
                                                    color: 'var(--muted)', fontFamily: 'monospace',
                                                }}>{b}</kbd>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            ))}
                        </>
                    )}

                    {/* 최근 항목 */}
                    {filteredConvs.length > 0 && (
                        <>
                            <div style={{ ...sectionLabelStyle, paddingTop: '12px' }}>{t('commandPalette.recent')}</div>
                            {filteredConvs.map(conv => (
                                <div key={conv.conv_id}
                                     onClick={() => { onLoadConversation(conv); onClose(); }}
                                     style={itemStyle} onMouseEnter={onHover} onMouseLeave={offHover}>
                                    <span style={{ color: 'var(--muted)', display: 'flex', alignItems: 'center' }}>
                                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                                        </svg>
                                    </span>
                                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                        {conv.title || t('commandPalette.newChat')}
                                    </span>
                                </div>
                            ))}
                        </>
                    )}

                    {/* 작업 */}
                    {filteredTasks.length > 0 && (
                        <>
                            <div style={{ ...sectionLabelStyle, paddingTop: '12px' }}>{t('commandPalette.tasks')}</div>
                            {filteredTasks.map(a => (
                                <div key={a.label} onClick={a.action} style={itemStyle}
                                     onMouseEnter={onHover} onMouseLeave={offHover}>
                                    <span style={{ color: 'var(--muted)', display: 'flex', alignItems: 'center' }}>{a.icon}</span>
                                    <span>{a.label}</span>
                                </div>
                            ))}
                        </>
                    )}
                </div>
            </div>
        </div>
    );
};

export default CommandPalette;
