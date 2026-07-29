import React from 'react';
import {useTranslation} from 'react-i18next';

interface ShortcutModalProps {
    onClose: () => void;
}

const ShortcutModal: React.FC<ShortcutModalProps> = ({onClose}) => {
    const {t} = useTranslation('main');
    const SHORTCUTS = [
        {keys: ['Cmd', 'K'], desc: t('shortcutModal.quickLaunch')},
        {keys: ['Cmd', '1'], desc: t('shortcutModal.newChat')},
        {keys: ['Cmd', '/'], desc: t('shortcutModal.showShortcuts')},
        {keys: ['Cmd', 'Shift', 'G'], desc: t('shortcutModal.googleWorkspace')},
        {keys: ['Cmd', 'Shift', 'M'], desc: t('shortcutModal.quickMemo')},
        {keys: ['Cmd', 'Shift', 'N'], desc: t('shortcutModal.memo')},
        {keys: ['Cmd', 'Shift', 'D'], desc: t('shortcutModal.documents')},
        {keys: ['Cmd', 'Shift', 'L'], desc: t('knowledgeCollections.title')},
        {keys: ['Cmd', 'Shift', 'A'], desc: t('shortcutModal.notifications')},
        {keys: ['Cmd', 'Shift', 'J'], desc: t('shortcutModal.chatSummary')},
        {keys: ['Cmd', 'Shift', 'S'], desc: t('shortcutModal.toggleSidebar')},
        {keys: ['Cmd', 'Shift', ','], desc: t('shortcutModal.openSettings')},
    ];
    return (
    <div
        style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 10000, padding: '20px',
        }}
        onClick={onClose}
    >
        <div
            onClick={e => e.stopPropagation()}
            style={{
                background: 'var(--modal-bg)', border: '1px solid var(--border)',
                borderRadius: '14px', width: '100%', maxWidth: '420px',
                boxShadow: '0 20px 60px rgba(0,0,0,0.5)', overflow: 'hidden',
                maxHeight: '60vh', display: 'flex', flexDirection: 'column',
            }}
        >
            <div style={{
                padding: '18px 20px', borderBottom: '1px solid var(--border)',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                flexShrink: 0,
            }}>
                <span style={{fontWeight: 600, fontSize: 'var(--modal-title)', color: 'var(--text)'}}>{t('shortcutModal.title')}</span>
                <button onClick={onClose} style={{
                    background: 'transparent', border: 'none', color: 'var(--muted)',
                    cursor: 'pointer', fontSize: '20px', lineHeight: 1,
                    width: '28px', height: '28px', display: 'flex',
                    alignItems: 'center', justifyContent: 'center', borderRadius: '6px',
                }}>×
                </button>
            </div>

            <div style={{
                padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: '6px',
                overflowY: 'auto', flex: 1, minHeight: 0,
            }}>
                {SHORTCUTS.map(({keys, desc}) => (
                    <div key={desc} style={{
                        display: 'flex', alignItems: 'center',
                        justifyContent: 'space-between', padding: '8px 10px',
                        borderRadius: '8px', background: 'var(--modal-inset)',
                    }}>
                        <span style={{fontSize: 'var(--modal-text)', color: 'var(--text)'}}>{desc}</span>
                        <div style={{display: 'flex', gap: '4px'}}>
                            {keys.map((k, i) => (
                                <kbd key={i} style={{
                                    background: 'var(--surface2)', border: '1px solid var(--border)',
                                    borderRadius: '5px', padding: '2px 7px', fontSize: '12px',
                                    color: 'var(--text)', fontFamily: 'monospace', lineHeight: '1.6',
                                }}>{k}</kbd>
                            ))}
                        </div>
                    </div>
                ))}
            </div>

            <div style={{
                padding: '10px 16px', borderTop: '1px solid var(--border)',
                fontSize: 'var(--modal-label)', color: 'var(--muted)', textAlign: 'center',
                flexShrink: 0,
            }}>
                {t('shortcutModal.windowsNote')}
            </div>
        </div>
    </div>
    );
};

export default ShortcutModal;
