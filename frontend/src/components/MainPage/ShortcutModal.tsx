import React from 'react';
import {useTranslation} from 'react-i18next';
import './ShortcutModal.css';

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
        {keys: ['Cmd', 'Shift', 'B'], desc: t('moreMenu.browser')},
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
    <div className="shortcut-modal-overlay" onClick={onClose}>
        <div
            onClick={e => e.stopPropagation()}
            className="shortcut-modal"
        >
            <div className="shortcut-modal-header">
                <span className="shortcut-modal-title">{t('shortcutModal.title')}</span>
                <button className="shortcut-modal-close" onClick={onClose}>×
                </button>
            </div>

            <div className="shortcut-modal-list">
                {SHORTCUTS.map(({keys, desc}) => (
                    <div className="shortcut-modal-row" key={desc}>
                        <span>{desc}</span>
                        <div className="shortcut-modal-keys">
                            {keys.map((k, i) => (
                                <kbd key={i}>{k}</kbd>
                            ))}
                        </div>
                    </div>
                ))}
            </div>

            <div className="shortcut-modal-footer">
                {t('shortcutModal.windowsNote')}
            </div>
        </div>
    </div>
    );
};

export default ShortcutModal;
