import React from 'react';
import {useTranslation} from 'react-i18next';
import {STOCK_ANALYSIS_SHORTCUT_KEY, STOCK_MARKETS} from '../../services/stockAnalysis';
import ModalOverlay from '../common/ModalOverlay/ModalOverlay';
import './ShortcutModal.css';

interface ShortcutModalProps {
    onClose: () => void;
    scope?: 'stock-analysis';
}

const ShortcutModal: React.FC<ShortcutModalProps> = ({onClose, scope}) => {
    const {t} = useTranslation('main');
    const SHORTCUTS = scope === 'stock-analysis' ? [
        ...STOCK_MARKETS.map((market, index) => ({keys: ['Cmd', String(index + 1)], desc: t(`stockAnalysis.${market}`)})),
        {keys: ['Cmd', 'Shift', 'I'], desc: t('stockAnalysis.discussion.togglePanel')},
        {keys: ['Cmd', 'Shift', 'S'], desc: t('shortcutModal.toggleSidebar')},
        {keys: ['Cmd', 'Shift', 'H'], desc: t('stockAnalysis.discussion.historyTitle')},
        {keys: ['Cmd', '/'], desc: t('shortcutModal.showShortcuts')},
        {keys: ['Cmd', 'Shift', STOCK_ANALYSIS_SHORTCUT_KEY], desc: t('stockAnalysis.title')},
        {keys: ['Cmd'], desc: t('stockAnalysis.shortcuts.sortPreview')},
    ] : [
        {keys: ['Cmd', 'K'], desc: t('shortcutModal.quickLaunch')},
        {keys: ['Cmd', '1'], desc: t('shortcutModal.newChat')},
        {keys: ['Cmd', '/'], desc: t('shortcutModal.showShortcuts')},
        {keys: ['Cmd', 'Shift', 'G'], desc: t('shortcutModal.googleWorkspace')},
        {keys: ['Cmd', 'Shift', 'M'], desc: t('shortcutModal.quickMemo')},
        {keys: ['Cmd', 'Shift', 'N'], desc: t('shortcutModal.memo')},
        {keys: ['Cmd', 'Shift', 'B'], desc: t('novelStudio.title')},
        {keys: ['Cmd', 'Shift', STOCK_ANALYSIS_SHORTCUT_KEY], desc: t('stockAnalysis.title')},
        {keys: ['Cmd', 'Shift', 'D'], desc: t('shortcutModal.documents')},
        {keys: ['Cmd', 'Shift', 'L'], desc: t('knowledgeCollections.title')},
        {keys: ['Cmd', 'Shift', 'A'], desc: t('shortcutModal.notifications')},
        {keys: ['Cmd', 'Shift', 'J'], desc: t('shortcutModal.chatSummary')},
        {keys: ['Cmd', 'Shift', 'S'], desc: t('shortcutModal.toggleSidebar')},
        {keys: ['Cmd', 'Shift', ','], desc: t('shortcutModal.openSettings')},
    ];
    const sortedShortcuts = [...SHORTCUTS].sort((first, second) => first.keys.length - second.keys.length);
    return (
    <ModalOverlay className="shortcut-modal-overlay" onClose={onClose} closeOnBackdrop>
        <div
            onClick={e => e.stopPropagation()}
            className="shortcut-modal"
        >
            <div className="shortcut-modal-header">
                <span className="shortcut-modal-title">{scope === 'stock-analysis' ? `${t('stockAnalysis.title')} · ${t('shortcutModal.title')}` : t('shortcutModal.title')}</span>
                <button className="shortcut-modal-close" onClick={onClose}>×
                </button>
            </div>

            <div className="shortcut-modal-list">
                {sortedShortcuts.map(({keys, desc}) => (
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
    </ModalOverlay>
    );
};

export default ShortcutModal;
