import React, {useRef, useEffect} from 'react';
import {useTranslation} from 'react-i18next';
import {VYACT_ICON_URL} from '../../constants/assets';
import {
    getGoogleWorkspaceStatus,
    refreshGoogleWorkspaceStatus,
    updateGoogleWorkspaceServerStatus,
    type GoogleWorkspaceStatus,
} from '../../services/googleWorkspaceStatus';
import {onMcpServersChanged} from '../../utils/mcpEvents';
import {CHAT_FILE_ACCEPT} from '../../utils/fileValidation';
import ReasoningToggle from '../common/ReasoningToggle/ReasoningToggle';
import './InputMenu.css';
import {usePluginExtensions} from '../../plugins/usePluginExtensions';
import {openPluginModal, openPluginPanel} from '../../plugins/registry';

const GOOGLE_STATUS_UNAVAILABLE: GoogleWorkspaceStatus = {
    registered: false,
    enabled: false,
    connected: false,
    accounts: [],
};
const CHAT_FILE_INPUT_ID = 'chat-file-input';

interface InputMenuProps {
    modelType: 'chat' | 'image_gen' | 'image_edit';
    fileInputRef: React.RefObject<HTMLInputElement>;
    onFileSelect: React.ChangeEventHandler<HTMLInputElement>;
    onOpenDocumentModal: () => void;
    onOpenCommandModal: () => void;
    onOpenShortcuts: () => void;
    onOpenSupport: () => void;
    onOpenMemo: () => void;
    onOpenQuickMemo: () => void;
    onOpenGoogleWorkspace: () => void;
}

const InputMenu: React.FC<InputMenuProps> = ({
                                                 modelType,
                                                 fileInputRef,
                                                 onFileSelect,
                                                 onOpenDocumentModal,
                                                 onOpenCommandModal,
                                                 onOpenShortcuts,
                                                 onOpenSupport,
                                                 onOpenMemo,
                                                 onOpenQuickMemo,
                                                 onOpenGoogleWorkspace,
                                             }) => {
    const {t} = useTranslation('main');
    const {inputMenu: pluginMenuItems} = usePluginExtensions();
    const [open, setOpen] = React.useState(false);
    const [google, setGoogle] = React.useState<GoogleWorkspaceStatus>(GOOGLE_STATUS_UNAVAILABLE);
    const menuRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
        };
        if (open) document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [open]);

    useEffect(() => {
        const loadGoogleStatus = () => {
            getGoogleWorkspaceStatus().then(setGoogle).catch(() => setGoogle(GOOGLE_STATUS_UNAVAILABLE));
        };
        loadGoogleStatus();
        const refreshStatus = (event: Event) => {
            const status = (event as CustomEvent).detail?.status;
            if (status) {
                setGoogle(status);
                return;
            }
            refreshGoogleWorkspaceStatus().then(setGoogle).catch(() => setGoogle(GOOGLE_STATUS_UNAVAILABLE));
        };
        window.addEventListener('vyact:google-workspace-status-changed', refreshStatus);
        const unsubscribeMcp = onMcpServersChanged(servers => {
            if (servers) setGoogle(updateGoogleWorkspaceServerStatus(servers));
            refreshGoogleWorkspaceStatus().then(setGoogle)
                .catch(() => setGoogle(GOOGLE_STATUS_UNAVAILABLE));
        });
        return () => {
            window.removeEventListener('vyact:google-workspace-status-changed', refreshStatus);
            unsubscribeMcp();
        };
    }, []);

    const menuItem = (
        icon: React.ReactNode,
        label: React.ReactNode,
        onClick: () => void,
        disabled?: boolean,
        inputId?: string,
    ) => {
        const itemStyle: React.CSSProperties = {
            width: '100%', padding: '11px 14px', background: 'transparent',
            border: 'none', color: disabled ? 'var(--muted)' : 'var(--text)', textAlign: 'left',
            cursor: disabled ? 'not-allowed' : 'pointer', fontSize: '13px',
            display: 'flex', alignItems: 'center', gap: '10px',
            transition: 'background 0.15s', opacity: disabled ? 0.4 : 1,
        };
        const contents = <><span className="input-menu-icon">{icon}</span>{label}</>;

        if (inputId && !disabled) {
            return <label
                htmlFor={inputId}
                style={itemStyle}
                onClick={() => setOpen(false)}
                onMouseEnter={event => { event.currentTarget.style.background = 'rgba(255,255,255,0.05)'; }}
                onMouseLeave={event => { event.currentTarget.style.background = 'transparent'; }}
            >
                {contents}
            </label>;
        }

        return <button
            onClick={() => {
                if (!disabled) {
                    onClick();
                    setOpen(false);
                }
            }}
            disabled={disabled}
            style={itemStyle}
            onMouseEnter={e => {
                if (!disabled) e.currentTarget.style.background = 'rgba(255,255,255,0.05)';
            }}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
        >
            {contents}
        </button>
    };

    const divider = <div style={{height: '1px', background: 'var(--border)', margin: '0 10px'}}/>;

    return (
        <div ref={menuRef} style={{position: 'relative', flexShrink: 0}}>
            <button
                onClick={() => setOpen(v => !v)}
                style={{
                    width: '30px', height: '30px', background: 'transparent',
                    border: 'none', borderRadius: '10px', cursor: 'pointer',
                    color: '#b0b0b8', display: 'flex', alignItems: 'center',
                    justifyContent: 'center', transition: 'background 0.2s', flexShrink: 0,
                }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--surface2)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="12" y1="5" x2="12" y2="19"/>
                    <line x1="5" y1="12" x2="19" y2="12"/>
                </svg>
            </button>

            {/* hidden file input */}
                <input
                id={CHAT_FILE_INPUT_ID}
                ref={fileInputRef}
                type="file"
                accept={CHAT_FILE_ACCEPT}
                multiple
                onChange={onFileSelect}
                style={{display: 'none'}}
            />

            {open && (
                <div style={{
                    position: 'absolute', bottom: '45px', left: '0',
                    background: 'var(--surface)', border: '1px solid var(--border)',
                    borderRadius: '10px', boxShadow: '0 4px 16px rgba(0,0,0,0.35)',
                    minWidth: '180px', zIndex: 1000, overflow: 'visible',
                }}>
                    {menuItem(
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                             strokeWidth="2">
                            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                            <circle cx="8.5" cy="8.5" r="1.5"/>
                            <polyline points="21 15 16 10 5 21"/>
                        </svg>,
                        t('inputMenu.addFiles'),
                        () => {},
                        modelType === 'image_gen',
                        CHAT_FILE_INPUT_ID,
                    )}
                    {google.registered && <>
                        {divider}
                        {menuItem(
                            google.connected
                                ? <span style={{color: '#62b5f6', fontWeight: 800}}>G</span>
                                : <span title={t('inputMenu.googleConnectionRequired')} style={{
                                    width: '18px', height: '18px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                    border: '1px solid #f2c14e', borderRadius: '50%', color: '#f2c14e', fontSize: '12px', fontWeight: 800,
                                }}>!</span>,
                            <span>{t('inputMenu.googleWorkspace')}</span>,
                            () => {
                                if (google.connected) { onOpenGoogleWorkspace(); return; }
                                window.dispatchEvent(new CustomEvent('vyact:open-settings', {
                                    detail: {tab: 'api'},
                                }));
                            },
                            false
                        )}
                    </>}
                    {divider}
                    {menuItem(
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                             strokeWidth="2">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                            <polyline points="14 2 14 8 20 8"/>
                            <line x1="12" y1="18" x2="12" y2="12"/>
                            <line x1="9" y1="15" x2="15" y2="15"/>
                        </svg>,
                        t('inputMenu.documents'), onOpenDocumentModal
                    )}
                    {pluginMenuItems.map(item => {
                        const Icon = item.icon;
                        return <React.Fragment key={item.id}>
                            {divider}
                            {menuItem(<Icon size={16}/>, item.label, () => {
                                if (item.panelId) openPluginPanel(item.panelId);
                                else openPluginModal(item.modalId);
                            })}
                        </React.Fragment>;
                    })}
                    {divider}
                    {menuItem(
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                             strokeWidth="2">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                            <polyline points="14 2 14 8 20 8"/>
                            <line x1="16" y1="13" x2="8" y2="13"/>
                            <line x1="16" y1="17" x2="8" y2="17"/>
                        </svg>,
                        t('inputMenu.memo'), onOpenMemo
                    )}
                    {divider}
                    {menuItem(
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                             strokeWidth="2">
                            <path d="M9 11l3 3L22 4"/>
                            <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
                        </svg>,
                        t('inputMenu.quickMemo'), onOpenQuickMemo
                    )}
                    {divider}
                    {menuItem(
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                             strokeWidth="2">
                            <polyline points="4 17 10 11 4 5"/>
                            <line x1="12" y1="19" x2="20" y2="19"/>
                        </svg>,
                        t('inputMenu.commandList'), onOpenCommandModal
                    )}
                    {divider}
                    {menuItem(
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                             strokeWidth="2">
                            <rect x="2" y="6" width="20" height="12" rx="2"/>
                            <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8"/>
                        </svg>,
                        t('inputMenu.shortcuts'), onOpenShortcuts
                    )}
                    {divider}
                    {menuItem(
                        <img src={VYACT_ICON_URL} width="16" height="16" alt="" aria-hidden="true"/>,
                        t('inputMenu.supportVyact'), onOpenSupport
                    )}
                    {divider}
                    <div className="input-menu-reasoning">
                        <ReasoningToggle/>
                    </div>
                </div>
            )}
        </div>
    );
};

export default InputMenu;
