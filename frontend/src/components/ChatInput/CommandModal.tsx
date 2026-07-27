import React from 'react';
import {useTranslation} from 'react-i18next';
import { COMMANDS } from '../../constants/commands';
import {usePluginExtensions} from '../../plugins/usePluginExtensions';

interface CommandModalProps {
    onClose: () => void;
    onSelect: (cmd: string) => void;
}

const CommandModal: React.FC<CommandModalProps> = ({ onClose, onSelect }) => {
    const {t} = useTranslation('main');
    const {commands: pluginCommands} = usePluginExtensions();
    const availableCommands = [...COMMANDS, ...pluginCommands];
    return (
    <div
        style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(0,0,0,0.6)', display: 'flex',
            alignItems: 'center', justifyContent: 'center',
            zIndex: 10000, padding: '20px',
        }}
    >
        <div
            onClick={e => e.stopPropagation()}
            style={{
                background: 'var(--modal-bg)', border: '1px solid var(--border)',
                borderRadius: '14px', width: '100%', maxWidth: '520px',
                maxHeight: '50vh', display: 'flex', flexDirection: 'column',
                boxShadow: '0 20px 60px rgba(0,0,0,0.5)', overflow: 'hidden',
            }}
        >
            <div style={{
                padding: '18px 20px', borderBottom: '1px solid var(--border)',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2">
                        <polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>
                    </svg>
                    <span style={{ fontWeight: 600, fontSize: 'var(--modal-title)', color: 'var(--text)' }}>{t('commandModal.title')}</span>
                </div>
                <button
                    onClick={onClose}
                    style={{
                        background: 'transparent', border: 'none', color: 'var(--muted)',
                        cursor: 'pointer', fontSize: '20px', lineHeight: 1,
                        width: '28px', height: '28px', display: 'flex',
                        alignItems: 'center', justifyContent: 'center', borderRadius: '6px',
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = 'var(--surface2)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >×</button>
            </div>

            <div style={{
                padding: '10px 12px', display: 'flex', flexDirection: 'column',
                gap: '6px', maxHeight: '40vh', overflowY: 'auto',
            }}>
                {availableCommands.map(c => {
                    const Icon = c.icon;
                    return (
                    <div
                        key={c.cmd}
                        onClick={() => onSelect(c.cmd)}
                        style={{
                            padding: '12px 14px', borderRadius: '10px',
                            border: '1px solid var(--border)', cursor: 'pointer',
                            transition: 'all 0.15s', background: 'var(--modal-inset)',
                        }}
                        onMouseEnter={e => {
                            (e.currentTarget as HTMLDivElement).style.background = 'rgba(255,120,50,0.08)';
                            (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--accent)';
                        }}
                        onMouseLeave={e => {
                            (e.currentTarget as HTMLDivElement).style.background = 'var(--modal-inset)';
                            (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--border)';
                        }}
                    >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '5px' }}>
                            <Icon size={18} strokeWidth={1.9} color="var(--muted)" aria-hidden />
                            <code style={{ fontSize: 'var(--modal-sub)', fontWeight: 700, color: 'var(--accent)', fontFamily: 'monospace' }}>{t('commands.' + c.cmd.slice(1) + '_usage', {defaultValue: c.usage})}</code>
                        </div>
                        <p style={{ margin: 0, fontSize: 'var(--modal-sub)', color: 'var(--muted)', lineHeight: 1.5 }}>{t('commands.' + c.cmd.slice(1) + '_desc', {defaultValue: c.desc})}</p>
                        <div style={{
                            marginTop: '6px', padding: '5px 10px',
                            background: 'rgba(255,255,255,0.04)', borderRadius: '6px',
                            fontSize: '11px', color: 'var(--muted)', fontFamily: 'monospace',
                        }}>{t('commandModal.examplePrefix')}) {t('commands.' + c.cmd.slice(1) + '_example', {defaultValue: c.example})}</div>
                    </div>
                    );
                })}
            </div>

            <div style={{
                padding: '12px 20px', borderTop: '1px solid var(--border)',
                fontSize: 'var(--modal-label)', color: 'var(--muted)', textAlign: 'center',
            }}>
                {t('commandModal.footer')}
            </div>
        </div>
    </div>
    );
};

export default CommandModal;
