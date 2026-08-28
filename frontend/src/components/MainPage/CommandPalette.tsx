import React from 'react';
import {useTranslation} from 'react-i18next';
import type { Conversation } from '../../types';
import {usePluginExtensions} from '../../plugins/usePluginExtensions';
import {openPluginModal, openPluginPanel} from '../../plugins/registry';
import './CommandPalette.css';

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

    return (
        <div className="command-palette-overlay" onClick={onClose}>
            <div
                onClick={e => e.stopPropagation()}
                className="command-palette"
            >
                {/* 검색 입력 */}
                <div className="command-palette-search">
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
                        placeholder={t('common:search')}
                        aria-label={t('commandPalette.searchPlaceholder')}
                        className="command-palette-input"
                    />
                    <button className="command-palette-close" onClick={onClose}>✕</button>
                </div>

                <div className="command-palette-results">
                    {/* 빠른 작업 */}
                    {filteredQuick.length > 0 && (
                        <>
                            <div className="command-palette-section-label">{t('commandPalette.quickActions')}</div>
                            {filteredQuick.map(a => (
                                <div className="command-palette-item" key={a.label} onClick={a.action}>
                                    <span className="command-palette-icon">{a.icon}</span>
                                    <span className="command-palette-item-label">{a.label}</span>
                                    {a.badge && (
                                        <div className="command-palette-badges">
                                            {a.badge.map((b, i) => (
                                                <kbd key={i}>{b}</kbd>
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
                            <div className="command-palette-section-label separated">{t('commandPalette.recent')}</div>
                            {filteredConvs.map(conv => (
                                <div className="command-palette-item" key={conv.conv_id}
                                     onClick={() => { onLoadConversation(conv); onClose(); }}>
                                    <span className="command-palette-icon">
                                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                                        </svg>
                                    </span>
                                    <span className="command-palette-item-label truncated">
                                        {conv.title || t('commandPalette.newChat')}
                                    </span>
                                </div>
                            ))}
                        </>
                    )}

                    {/* 작업 */}
                    {filteredTasks.length > 0 && (
                        <>
                            <div className="command-palette-section-label separated">{t('commandPalette.tasks')}</div>
                            {filteredTasks.map(a => (
                                <div className="command-palette-item" key={a.label} onClick={a.action}>
                                    <span className="command-palette-icon">{a.icon}</span>
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
