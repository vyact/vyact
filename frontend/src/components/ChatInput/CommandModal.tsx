import React from 'react';
import {useTranslation} from 'react-i18next';
import { COMMANDS } from '../../constants/commands';
import {usePluginExtensions} from '../../plugins/usePluginExtensions';
import './CommandModal.css';

interface CommandModalProps {
    onClose: () => void;
    onSelect: (cmd: string) => void;
}

const CommandModal: React.FC<CommandModalProps> = ({ onClose, onSelect }) => {
    const {t} = useTranslation('main');
    const {commands: pluginCommands} = usePluginExtensions();
    const availableCommands = [...COMMANDS, ...pluginCommands];
    return (
    <div className="command-modal-overlay">
        <div
            onClick={e => e.stopPropagation()}
            className="command-modal"
        >
            <div className="command-modal-header">
                <div className="command-modal-heading">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2">
                        <polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>
                    </svg>
                    <span>{t('commandModal.title')}</span>
                </div>
                <button
                    className="command-modal-close"
                    onClick={onClose}
                >×</button>
            </div>

            <div className="command-modal-list">
                {availableCommands.map(c => {
                    const Icon = c.icon;
                    return (
                    <div
                        key={c.cmd}
                        onClick={() => onSelect(c.cmd)}
                        className="command-modal-item"
                    >
                        <div className="command-modal-item-heading">
                            <Icon size={18} strokeWidth={1.9} color="var(--muted)" aria-hidden />
                            <code>{t('commands.' + c.cmd.slice(1) + '_usage', {defaultValue: c.usage})}</code>
                        </div>
                        <p>{t('commands.' + c.cmd.slice(1) + '_desc', {defaultValue: c.desc})}</p>
                        <div className="command-modal-example">{t('commandModal.examplePrefix')}) {t('commands.' + c.cmd.slice(1) + '_example', {defaultValue: c.example})}</div>
                    </div>
                    );
                })}
            </div>

            <div className="command-modal-footer">
                {t('commandModal.footer')}
            </div>
        </div>
    </div>
    );
};

export default CommandModal;
