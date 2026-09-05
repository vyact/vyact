import {notifyWorkspaceError} from '../../utils/workspaceError';
import {lazy, Suspense, useCallback, useEffect, useState, useMemo} from 'react';
import {useTranslation} from 'react-i18next';
import {api as googleApi, createWorkspaceApi} from '../../services/api';
import {microsoftRequest, MICROSOFT_WORKSPACE_CHANGED} from '../../services/microsoftWorkspace';
import {WorkspaceContext} from './WorkspaceContext';
import PanelResizer from '../common/PanelResizer/PanelResizer';
import CustomSelect from '../CustomSelect/CustomSelect';
import type {DriveFile} from './DrivePanel';
import type {GoogleCalendarSelection, GoogleDriveSelection} from '../../types/googleWorkspace';
import {getGoogleWorkspaceStatus, refreshGoogleWorkspaceStatus} from '../../services/googleWorkspaceStatus';
import './GoogleWorkspacePanel.css';

const PANEL_WIDTH_STORAGE_KEY = 'vyact-google-workspace-panel-width';
const DEFAULT_PANEL_WIDTH = 860;
const MIN_PANEL_WIDTH = 560;
const VIEWPORT_GUTTER = 120;
const MailPanel = lazy(() => import('./MailPanel'));
const DrivePanel = lazy(() => import('./DrivePanel'));
const CalendarPanel = lazy(() => import('./CalendarPanel'));

const clampPanelWidth = (width: number) => Math.max(MIN_PANEL_WIDTH, Math.min(window.innerWidth - VIEWPORT_GUTTER, width));

const getSavedPanelWidth = () => {
    try {
        const savedWidth = Number(localStorage.getItem(PANEL_WIDTH_STORAGE_KEY));
        if (Number.isFinite(savedWidth)) return clampPanelWidth(savedWidth);
    } catch { /* localStorage may be unavailable */ }
    return clampPanelWidth(DEFAULT_PANEL_WIDTH);
};

export default function GoogleWorkspacePanel({provider = 'google', requestedAccountId, onAccountSwitch, onClose, selectedMessageId, selectedCalendarEvent, selectedDriveFolder, embedded = false, style, onAttachDriveFileToChat, onAttachMailFilesToChat, onIndexDriveDocument}: {
    provider?: 'google' | 'microsoft';
    requestedAccountId?: string;
    onAccountSwitch?: (provider: 'google' | 'microsoft', accountId: string) => void;
    onClose: () => void;
    selectedMessageId?: string | null;
    selectedCalendarEvent?: GoogleCalendarSelection | null;
    selectedDriveFolder?: GoogleDriveSelection | null;
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
    const [accounts, setAccounts] = useState<Array<{id: string; email?: string; mailMode?: string}>>([]);
    const [otherAccounts, setOtherAccounts] = useState<Array<{id: string; email?: string}>>([]);
    const [otherActiveAccountId, setOtherActiveAccountId] = useState('');
    const [switchingAccount, setSwitchingAccount] = useState(false);
    useEffect(() => {
        let active = true;
        const refresh = async () => {
            try {
                const status = provider === 'google' ? await microsoftRequest('/status') : await getGoogleWorkspaceStatus();
                if (active) {
                    setOtherAccounts(status.accounts.filter(account => account.authenticated));
                    setOtherActiveAccountId(typeof status.config?.active_account_id === 'string'
                        ? status.config.active_account_id : '');
                }
            } catch { if (active) setOtherAccounts([]); }
        };
        void refresh();
        window.addEventListener(MICROSOFT_WORKSPACE_CHANGED, refresh);
        window.addEventListener('vyact:google-workspace-status-changed', refresh);
        return () => {
            active = false;
            window.removeEventListener(MICROSOFT_WORKSPACE_CHANGED, refresh);
            window.removeEventListener('vyact:google-workspace-status-changed', refresh);
        };
    }, [provider]);
    const [activeAccountId, setActiveAccountId] = useState(requestedAccountId || '');
    const [dismissedDriveRequestId, setDismissedDriveRequestId] = useState<number | null>(null);
    const activeDriveSelection = selectedDriveFolder?.requestId === dismissedDriveRequestId
        ? null : selectedDriveFolder;
    const api = useMemo(() => provider === 'microsoft' ? createWorkspaceApi('microsoft-workspace', activeAccountId) : googleApi, [provider, activeAccountId]);

    const loadAccounts = useCallback(async (forceRefresh = false) => {
        if (provider === 'microsoft') {
            const status = await microsoftRequest('/status');
            const connected = status.accounts.filter(account => account.authenticated);
            setAccounts(connected.map(account => ({...account, mailMode: status.config.accounts.find(item => item.id === account.id)?.mail_mode || 'readonly'})));
            const preferredAccountId = requestedAccountId || status.config.active_account_id;
            setActiveAccountId(current => connected.some(account => account.id === current)
                ? current : connected.some(account => account.id === preferredAccountId)
                    ? preferredAccountId : connected[0]?.id || '');
            return;
        }
        const workspaceStatus = await (forceRefresh
            ? refreshGoogleWorkspaceStatus()
            : getGoogleWorkspaceStatus());
        const connectedAccounts = workspaceStatus.accounts.filter(account => account.authenticated);
        const server = workspaceStatus.mcpServers.find(item => item.type === 'google_workspace');
        const configuredActiveAccountId = typeof server?.config?.active_account_id === 'string'
            ? server.config.active_account_id
            : '';
        const activeAccountId = connectedAccounts.some(account => account.id === configuredActiveAccountId)
            ? configuredActiveAccountId
            : connectedAccounts[0]?.id || '';

        setAccounts(connectedAccounts);
        setActiveAccountId(current => connectedAccounts.some(account => account.id === current) ? current : activeAccountId);

        // 예전 설정이나 연결 해제 때문에 활성 슬롯이 미연결 계정을 가리키면
        // 패널을 여는 시점에 실제 연결된 첫 계정으로 복구한다.
        if (activeAccountId && activeAccountId !== configuredActiveAccountId) {
            await api.activateGoogleAccount(activeAccountId);
        }
    }, [provider]);

    useEffect(() => {
        void loadAccounts().catch(notifyWorkspaceError);
        const handleAccountChanged = (event: Event) => {
            const accountId = (event as CustomEvent).detail?.accountId;
            if (provider === 'google' && accountId) setActiveAccountId(accountId);
        };
        const handleWorkspaceStatusChanged = () => void loadAccounts(true).catch(notifyWorkspaceError);
        window.addEventListener(MICROSOFT_WORKSPACE_CHANGED, handleWorkspaceStatusChanged);
        window.addEventListener('vyact:google-account-changed', handleAccountChanged);
        window.addEventListener('vyact:google-workspace-status-changed', handleWorkspaceStatusChanged);
        return () => {
            window.removeEventListener(MICROSOFT_WORKSPACE_CHANGED, handleWorkspaceStatusChanged);
            window.removeEventListener('vyact:google-account-changed', handleAccountChanged);
            window.removeEventListener('vyact:google-workspace-status-changed', handleWorkspaceStatusChanged);
        };
    }, [loadAccounts]);

    const changeAccount = useCallback(async (accountId: string) => {
        if (provider === 'microsoft') await microsoftRequest(`/accounts/${accountId}/activate`, 'POST');
        else await api.activateGoogleAccount(accountId);
        setActiveAccountId(accountId);
        if (provider === 'google') window.dispatchEvent(new CustomEvent('vyact:google-account-changed', {detail: {accountId}}));
    }, [provider, api]);

    const accountOptions = [
        ...accounts.map(account => ({...account, provider})),
        ...otherAccounts.map(account => ({...account, provider: provider === 'google' ? 'microsoft' as const : 'google' as const})),
    ].sort((a, b) => {
        const priority = (account: {provider: string; id: string}) => {
            const lastSelectedAccountId = account.provider === provider ? activeAccountId : otherActiveAccountId;
            return (account.provider === 'google' ? 0 : 2) + (account.id === lastSelectedAccountId ? 0 : 1);
        };
        return priority(a) - priority(b);
    });
    const selectWorkspaceAccount = async (value: string) => {
        const target = accountOptions.find(account => `${account.provider}:${account.id}` === value);
        if (!target || switchingAccount) return;
        setSwitchingAccount(true);
        try {
            if (target.provider === provider) {
                await changeAccount(target.id);
                setDismissedDriveRequestId(selectedDriveFolder?.requestId ?? null);
            }
            else {
                if (target.provider === 'microsoft') await microsoftRequest(`/accounts/${target.id}/activate`, 'POST');
                else await googleApi.activateGoogleAccount(target.id);
                onAccountSwitch?.(target.provider, target.id);
            }
        } catch (error) {
            notifyWorkspaceError(error);
        } finally { setSwitchingAccount(false); }
    };
    const renderAccountLabel = (value: string, label: string) => <span className="gwp-account-label">
        <span className="gwp-account-provider" aria-label={value.startsWith('google:') ? t('settings:tabs.google') : t('settings:microsoft.title')}>{value.startsWith('google:') ? 'G' : 'M'}</span>
        <span className="gwp-account-email">{label}</span>
    </span>;

    useEffect(() => {
        if (!activeDriveSelection) return;
        setTab('drive');
        if (activeDriveSelection.accountId && activeDriveSelection.accountId !== activeAccountId) {
            void changeAccount(activeDriveSelection.accountId).catch(notifyWorkspaceError);
        }
    }, [activeAccountId, changeAccount, activeDriveSelection]);

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

    const openDriveRoot = () => {
        setDismissedDriveRequestId(selectedDriveFolder?.requestId ?? null);
        setTab('drive');
    };

    return <WorkspaceContext.Provider value={{api, provider, accountId: activeAccountId, mailMode: accounts.find(account => account.id === activeAccountId)?.mailMode || (provider === 'google' ? 'send' : 'readonly')}}><aside className={`google-workspace-panel${embedded ? ' google-workspace-panel--embedded' : ''}`} style={embedded ? style : {width: panelWidth}}>
        {!embedded && <PanelResizer className="gwp-panel-resizer" onWidthChange={resizePanel} getWidth={event => window.innerWidth - event.clientX} onReset={resetPanelWidth} title={t('googleWorkspace.resizePanel')}/>}
        <header className="gwp-header">
            {accounts.length > 0 && <div className="gwp-account-select">
                <CustomSelect
                    options={accountOptions.map((account, index) => ({
                        value: `${account.provider}:${account.id}`,
                        group: account.provider,
                        label: account.email || t('googleWorkspace.accountNumber', {number: index + 1}),
                    }))}
                    value={`${provider}:${activeAccountId}`}
                    dropdownClassName="gwp-account-dropdown"
                    disabled={switchingAccount}
                    onChange={value => void selectWorkspaceAccount(value)}
                    renderTrigger={(label, open) => <>{renderAccountLabel(`${provider}:${activeAccountId}`, label)}<span className="custom-select-arrow">{open ? '▲' : '▼'}</span></>}
                    renderOption={(option, selected) => <>{renderAccountLabel(option.value, option.label)}{selected && <span className="custom-select-check">✓</span>}</>}
                />
            </div>}
            <div className="gwp-tabs">
                <button className={tab === 'mail' ? 'active' : ''} onClick={() => setTab('mail')}>{t('googleWorkspace.mail')}</button>
                <button className={tab === 'drive' ? 'active' : ''} onClick={openDriveRoot}>{provider === 'microsoft' ? t('settings:microsoft.drive') : t('googleWorkspace.drive')}</button>
                <button className={tab === 'calendar' ? 'active' : ''} onClick={() => setTab('calendar')}>{t('googleWorkspace.calendar.title')}</button>
            </div>
            <button className="gwp-header-close" aria-label={t(provider === 'microsoft' ? 'settings:microsoft.closePanel' : 'googleWorkspace.closePanel')} onClick={onClose}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
            </button>
        </header>
        <div key={activeAccountId} className="gwp-account-content">
        <Suspense fallback={null}>
            {activeAccountId && (!activeDriveSelection?.accountId || activeDriveSelection.accountId === activeAccountId) && (tab === 'mail' ? <MailPanel accountId={activeAccountId} selectedMessageId={selectedMessageId} onAttachFilesToChat={onAttachMailFilesToChat}/> : tab === 'drive' ? <DrivePanel key={activeDriveSelection?.requestId ?? 'drive'} initialFolder={activeDriveSelection ? {id: activeDriveSelection.folderId, name: activeDriveSelection.folderName} : undefined} onAttachToChat={onAttachDriveFileToChat} onIndexDocument={onIndexDriveDocument}/> : (
                <CalendarPanel
                    selectedEvent={pendingCalendarEvent}
                    onSelectedEventHandled={requestId => {
                        setPendingCalendarEvent(current => current?.requestId === requestId ? null : current);
                    }}
                />
            ))}
        </Suspense>
        </div>
    </aside></WorkspaceContext.Provider>;
}
