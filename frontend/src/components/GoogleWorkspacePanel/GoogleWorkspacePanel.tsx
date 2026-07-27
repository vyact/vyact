import {useCallback, useEffect, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {api} from '../../services/api';
import PanelResizer from '../common/PanelResizer/PanelResizer';
import CustomSelect from '../CustomSelect/CustomSelect';
import MailPanel from './MailPanel';
import DrivePanel from './DrivePanel';
import type {DriveFile} from './DrivePanel';
import CalendarPanel from './CalendarPanel';
import type {GoogleCalendarSelection} from '../../types/googleWorkspace';
import './GoogleWorkspacePanel.css';

const PANEL_WIDTH_STORAGE_KEY = 'vyact-google-workspace-panel-width';
const DEFAULT_PANEL_WIDTH = 860;
const MIN_PANEL_WIDTH = 560;
const VIEWPORT_GUTTER = 120;

const clampPanelWidth = (width: number) => Math.max(MIN_PANEL_WIDTH, Math.min(window.innerWidth - VIEWPORT_GUTTER, width));

const getSavedPanelWidth = () => {
    try {
        const savedWidth = Number(localStorage.getItem(PANEL_WIDTH_STORAGE_KEY));
        if (Number.isFinite(savedWidth)) return clampPanelWidth(savedWidth);
    } catch { /* localStorage may be unavailable */ }
    return clampPanelWidth(DEFAULT_PANEL_WIDTH);
};

export default function GoogleWorkspacePanel({onClose, selectedMessageId, selectedCalendarEvent, embedded = false, style, onAttachDriveFileToChat, onAttachMailFilesToChat, onIndexDriveDocument}: {
    onClose: () => void;
    selectedMessageId?: string | null;
    selectedCalendarEvent?: GoogleCalendarSelection | null;
    embedded?: boolean;
    style?: React.CSSProperties;
    onAttachDriveFileToChat?: (file: DriveFile) => Promise<void> | void;
    onAttachMailFilesToChat?: (files: File[]) => Promise<void> | void;
    onIndexDriveDocument?: (file: DriveFile) => Promise<void> | void;
}) {
    const {t} = useTranslation('main');
    const [tab, setTab] = useState<'mail' | 'drive' | 'calendar'>('mail');
    const [pendingCalendarEvent, setPendingCalendarEvent] = useState<GoogleCalendarSelection | null>(
        selectedCalendarEvent ?? null,
    );
    const [panelWidth, setPanelWidth] = useState(getSavedPanelWidth);
    const [accounts, setAccounts] = useState<Array<{id: string; email?: string}>>([]);
    const [activeAccountId, setActiveAccountId] = useState('');

    const loadAccounts = useCallback(async () => {
        const [serversResult, authStatus] = await Promise.all([
            api.getMcpServers(),
            api.getGoogleAuthStatus(),
        ]);
        const server = (serversResult.servers || []).find(item => item.type === 'google_workspace');
        const connectedAccounts = (authStatus.accounts || []).filter(account => account.authenticated);
        const configuredActiveAccountId = typeof server?.config?.active_account_id === 'string'
            ? server.config.active_account_id
            : '';
        const activeAccountId = connectedAccounts.some(account => account.id === configuredActiveAccountId)
            ? configuredActiveAccountId
            : connectedAccounts[0]?.id || '';

        setAccounts(connectedAccounts);
        setActiveAccountId(activeAccountId);

        // 예전 설정이나 연결 해제 때문에 활성 슬롯이 미연결 계정을 가리키면
        // 패널을 여는 시점에 실제 연결된 첫 계정으로 복구한다.
        if (activeAccountId && activeAccountId !== configuredActiveAccountId) {
            await api.activateGoogleAccount(activeAccountId);
        }
    }, []);

    useEffect(() => {
        void loadAccounts();
        const handleAccountChanged = (event: Event) => {
            const accountId = (event as CustomEvent).detail?.accountId;
            if (accountId) setActiveAccountId(accountId);
            void loadAccounts();
        };
        window.addEventListener('vyact:google-account-changed', handleAccountChanged);
        window.addEventListener('vyact:google-workspace-status-changed', handleAccountChanged);
        return () => {
            window.removeEventListener('vyact:google-account-changed', handleAccountChanged);
            window.removeEventListener('vyact:google-workspace-status-changed', handleAccountChanged);
        };
    }, [loadAccounts]);

    const changeAccount = useCallback(async (accountId: string) => {
        await api.activateGoogleAccount(accountId);
        setActiveAccountId(accountId);
        window.dispatchEvent(new CustomEvent('vyact:google-account-changed', {detail: {accountId}}));
    }, []);

    useEffect(() => {
        if (selectedMessageId) setTab('mail');
    }, [selectedMessageId]);

    useEffect(() => {
        setPendingCalendarEvent(selectedCalendarEvent ?? null);
        if (selectedCalendarEvent) setTab('calendar');
    }, [selectedCalendarEvent]);

    useEffect(() => {
        const keepPanelInViewport = () => setPanelWidth(current => clampPanelWidth(current));
        window.addEventListener('resize', keepPanelInViewport);
        return () => window.removeEventListener('resize', keepPanelInViewport);
    }, []);

    const resizePanel = useCallback((width: number) => {
        const nextWidth = clampPanelWidth(width);
        setPanelWidth(nextWidth);
        try { localStorage.setItem(PANEL_WIDTH_STORAGE_KEY, String(nextWidth)); } catch { /* ignore */ }
    }, []);
    const resetPanelWidth = useCallback(() => {
        setPanelWidth(clampPanelWidth(DEFAULT_PANEL_WIDTH));
        try { localStorage.removeItem(PANEL_WIDTH_STORAGE_KEY); } catch { /* ignore */ }
    }, []);

    return <aside className={`google-workspace-panel${embedded ? ' google-workspace-panel--embedded' : ''}`} style={embedded ? style : {width: panelWidth}}>
        {!embedded && <PanelResizer className="gwp-panel-resizer" onWidthChange={resizePanel} getWidth={event => window.innerWidth - event.clientX} onReset={resetPanelWidth} title={t('googleWorkspace.resizePanel')}/>}
        <header className="gwp-header">
            {accounts.length > 0 && <div className="gwp-account-select">
                <CustomSelect
                    options={accounts.map((account, index) => ({
                        value: account.id,
                        label: account.email || t('googleWorkspace.accountNumber', {number: index + 1}),
                    }))}
                    value={activeAccountId}
                    onChange={accountId => void changeAccount(accountId)}
                />
            </div>}
            <div className="gwp-tabs">
                <button className={tab === 'mail' ? 'active' : ''} onClick={() => setTab('mail')}>{t('googleWorkspace.mail')}</button>
                <button className={tab === 'drive' ? 'active' : ''} onClick={() => setTab('drive')}>{t('googleWorkspace.drive')}</button>
                <button className={tab === 'calendar' ? 'active' : ''} onClick={() => setTab('calendar')}>{t('googleWorkspace.calendar.title')}</button>
            </div>
            <button className="gwp-header-close" aria-label={t('googleWorkspace.closePanel')} onClick={onClose}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
            </button>
        </header>
        <div key={activeAccountId} className="gwp-account-content">
        {tab === 'mail' ? <MailPanel accountId={activeAccountId} selectedMessageId={selectedMessageId} onAttachFilesToChat={onAttachMailFilesToChat}/> : tab === 'drive' ? <DrivePanel onAttachToChat={onAttachDriveFileToChat} onIndexDocument={onIndexDriveDocument}/> : (
            <CalendarPanel
                selectedEvent={pendingCalendarEvent}
                onSelectedEventHandled={requestId => {
                    setPendingCalendarEvent(current => current?.requestId === requestId ? null : current);
                }}
            />
        )}
        </div>
    </aside>;
}
