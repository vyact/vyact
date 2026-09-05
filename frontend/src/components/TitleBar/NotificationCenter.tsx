import {microsoftRequest, OPEN_MICROSOFT_WORKSPACE} from '../../services/microsoftWorkspace';
import {Bell, CalendarDays, CheckCircle2, FileText, Info, Mail, Sparkles, TriangleAlert} from 'lucide-react';
import {useCallback, useEffect, useLayoutEffect, useRef, useState} from 'react';
import {createPortal} from 'react-dom';
import {useTranslation} from 'react-i18next';
import {api} from '../../services/api';
import {getConfiguredGoogleWorkspaceAccountIds, refreshGoogleWorkspaceStatus} from '../../services/googleWorkspaceStatus';
import {playNotificationSound} from '../../utils/notificationSound';
import {toast} from '../common/ToastNotifications/ToastNotifications';
import ProductReleaseModal from './ProductReleaseModal';
import './NotificationCenter.css';

type NotificationItem = {
    id: string;
    type: string;
    source_id: string;
    title: string;
    message: string;
    is_read: boolean;
    created_at: string;
    occurred_at?: string;
    account_id?: string;
    account_email?: string;
    translations?: Record<string, {title?: string; message?: string}>;
    url?: string;
    important?: boolean;
};
const PAGE_SIZE = 30;
const POPOVER_GAP = 6;
const VIEWPORT_MARGIN = 8;
const MAX_POPOVER_HEIGHT = 560;
const NOTIFICATION_STREAM_URL = '/api/notifications/stream';
const KNOWN_NOTIFICATION_IDS_STORAGE_KEY = 'vyact:known-notification-ids';
const MAX_PERSISTED_NOTIFICATION_IDS = 500;

function loadKnownNotificationIds(): {ids: Set<string>; initialized: boolean} {
    try {
        const storedValue = window.localStorage.getItem(KNOWN_NOTIFICATION_IDS_STORAGE_KEY);
        if (storedValue === null) return {ids: new Set(), initialized: false};
        const parsedValue = JSON.parse(storedValue);
        return {
            ids: new Set(Array.isArray(parsedValue) ? parsedValue.filter(id => typeof id === 'string') : []),
            initialized: true,
        };
    } catch {
        return {ids: new Set(), initialized: false};
    }
}

function persistKnownNotificationIds(ids: string[]): void {
    try {
        window.localStorage.setItem(
            KNOWN_NOTIFICATION_IDS_STORAGE_KEY,
            JSON.stringify(ids.slice(0, MAX_PERSISTED_NOTIFICATION_IDS)),
        );
    } catch {
        // Notification polling remains functional when persistent storage is unavailable.
    }
}

function NotificationTypeIcon({type}: {type: string}) {
    const Icon = (type === 'google_mail' || type === 'microsoft_mail') ? Mail
        : (type === 'google_calendar' || type === 'microsoft_calendar') ? CalendarDays
        : type === 'document' || type === 'file' ? FileText
            : type === 'success' || type === 'task_complete' ? CheckCircle2
                : type === 'warning' || type === 'error' ? TriangleAlert
                    : type === 'product_release' ? Sparkles
                    : type === 'system' ? Info : Bell;
    return <Icon size={18} strokeWidth={2} aria-hidden="true"/>;
}

function formatNotificationDate(value: string, locale: string): string {
    return new Date(value).toLocaleString(locale, {
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
    });
}

function localizeNotification(item: NotificationItem, language: string): {title: string; message: string} {
    const translations = item.translations;
    if (!translations) return {title: item.title, message: item.message};
    const baseLanguage = language.toLowerCase().split('-')[0];
    const translation = translations[language] || translations[baseLanguage]
        || translations.en || translations.ko || Object.values(translations)[0];
    return {
        title: translation?.title || item.title,
        message: translation?.message || item.message,
    };
}

function resolveNotificationGoogleAccountId(
    item: NotificationItem,
    googleStatus: Awaited<ReturnType<typeof refreshGoogleWorkspaceStatus>>,
): string | null {
    const configuredAccountIds = getConfiguredGoogleWorkspaceAccountIds(googleStatus.config);
    const connectedAccountIds = new Set(
        googleStatus.accounts
            .filter(account => account.authenticated)
            .map(account => account.id),
    );

    // 기존 알림은 앱 내부의 계정 슬롯 ID를 저장한다. 계정을 삭제한 뒤 같은
    // Google 계정을 다시 추가하면 슬롯 ID가 바뀌므로, 저장된 이메일로 한 번 더
    // 매칭해 이전 알림도 계속 열 수 있게 한다.
    if (configuredAccountIds.includes(item.account_id || '')
        && connectedAccountIds.has(item.account_id || '')) {
        return item.account_id || null;
    }

    const notificationEmail = item.account_email?.trim().toLowerCase();
    if (!notificationEmail) return null;
    const matchedAccount = googleStatus.accounts.find(account =>
        account.authenticated && account.email?.trim().toLowerCase() === notificationEmail,
    );
    return matchedAccount?.id || null;
}

interface NotificationCenterProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

export default function NotificationCenter({open, onOpenChange}: NotificationCenterProps) {
    const {t, i18n} = useTranslation('main');
    const [persistedNotificationState] = useState(loadKnownNotificationIds);
    const [items, setItems] = useState<NotificationItem[]>([]);
    const [total, setTotal] = useState(0);
    const [unread, setUnread] = useState(0);
    const [loading, setLoading] = useState(false);
    const [selectedRelease, setSelectedRelease] = useState<NotificationItem | null>(null);
    const [popoverPosition, setPopoverPosition] = useState({top: 0, right: VIEWPORT_MARGIN, maxHeight: MAX_POPOVER_HEIGHT});
    const loadingRef = useRef(false);
    const pendingRefreshRef = useRef(false);
    const knownNotificationIdsRef = useRef(persistedNotificationState.ids);
    const notificationsInitializedRef = useRef(persistedNotificationState.initialized);
    const centerRef = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const popoverRef = useRef<HTMLDivElement>(null);
    const listRef = useRef<HTMLDivElement>(null);

    const load = async (offset = 0, updateUnreadCount = true) => {
        if (loadingRef.current) {
            if (offset === 0) pendingRefreshRef.current = true;
            return;
        }
        loadingRef.current = true;
        setLoading(true);
        try {
            const result = await api.getNotifications(PAGE_SIZE, offset);
            const notifications: NotificationItem[] = result.notifications || [];
            if (offset === 0) {
                if (notificationsInitializedRef.current) {
                    const hasNewUnreadNotification = notifications.some(
                        item => !item.is_read && !knownNotificationIdsRef.current.has(item.id),
                    );
                    if (hasNewUnreadNotification) playNotificationSound();
                }
                const persistedIds = [
                    ...notifications.map(item => item.id),
                    ...knownNotificationIdsRef.current,
                ].filter((id, index, allIds) => allIds.indexOf(id) === index);
                knownNotificationIdsRef.current = new Set(
                    persistedIds.slice(0, MAX_PERSISTED_NOTIFICATION_IDS),
                );
                notificationsInitializedRef.current = true;
                persistKnownNotificationIds(persistedIds);
            }
            setItems(current => offset ? [...current, ...notifications] : notifications);
            setTotal(result.total || 0);
            if (updateUnreadCount) setUnread(result.unread || 0);
        } finally {
            loadingRef.current = false;
            setLoading(false);
            if (pendingRefreshRef.current) {
                pendingRefreshRef.current = false;
                void load();
            }
        }
    };

    useEffect(() => {
        void load();
        const refresh = () => void load();
        const notificationEvents = new EventSource(NOTIFICATION_STREAM_URL);
        notificationEvents.addEventListener('changed', refresh);
        window.addEventListener('vyact:notifications-changed', refresh);
        return () => {
            notificationEvents.removeEventListener('changed', refresh);
            notificationEvents.close();
            window.removeEventListener('vyact:notifications-changed', refresh);
        };
    }, []);

    useEffect(() => {
        if (!open) return;
        const closeOnOutsideClick = (event: MouseEvent) => {
            const target = event.target as Node;
            const clickedCenter = centerRef.current?.contains(target);
            const clickedPopover = popoverRef.current?.contains(target);
            if (!clickedCenter && !clickedPopover) {
                onOpenChange(false);
            }
        };
        document.addEventListener('mousedown', closeOnOutsideClick);
        return () => document.removeEventListener('mousedown', closeOnOutsideClick);
    }, [open, onOpenChange]);

    const updatePopoverPosition = useCallback(() => {
        const triggerRect = triggerRef.current?.getBoundingClientRect();
        if (!triggerRect) return;
        const top = triggerRect.bottom + POPOVER_GAP;
        setPopoverPosition({
            top,
            right: Math.max(VIEWPORT_MARGIN, window.innerWidth - triggerRect.right),
            maxHeight: Math.max(120, Math.min(MAX_POPOVER_HEIGHT, window.innerHeight - top - VIEWPORT_MARGIN)),
        });
    }, []);

    useLayoutEffect(() => {
        if (!open) return;
        updatePopoverPosition();
        window.addEventListener('resize', updatePopoverPosition);
        window.addEventListener('scroll', updatePopoverPosition, true);
        return () => {
            window.removeEventListener('resize', updatePopoverPosition);
            window.removeEventListener('scroll', updatePopoverPosition, true);
        };
    }, [open, updatePopoverPosition]);

    useEffect(() => {
        if (!open) return;
        const openNotificationCenter = async () => {
            setUnread(0);
            await load(0, false);
            await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
            await api.markNotificationsRead();
        };
        void openNotificationCenter();
    }, [open]);

    const toggle = useCallback(() => {
        onOpenChange(!open);
    }, [onOpenChange, open]);

    const selectNotification = useCallback(async (item: NotificationItem) => {
        if (item.type === 'microsoft_mail') {
            try {
                const status = await microsoftRequest('/status');
                const account = status.accounts.find(account => account.authenticated && account.id === item.account_id)
                    || status.accounts.find(account => account.authenticated && account.email.toLowerCase() === item.account_email?.toLowerCase());
                if (!account) throw new Error('disconnected');
                await microsoftRequest(`/accounts/${account.id}/activate`, 'POST');
                window.dispatchEvent(new CustomEvent(OPEN_MICROSOFT_WORKSPACE, {detail: {messageId: item.source_id, accountId: account.id}}));
                onOpenChange(false);
            } catch { toast.warning(t('settings:microsoft.title'), t('settings:microsoft.requestFailed')); }
            return;
        }
        if (item.type === 'product_release') {
            setSelectedRelease(item);
            onOpenChange(false);
            return;
        }
        if (item.account_id && (item.type === 'google_mail' || item.type === 'google_calendar')) {
            // 연결 직후에는 캐시가 이전 슬롯 ID를 유지할 수 있어 매번 최신 상태를
            // 확인한다. 특히 계정 삭제 후 같은 Google 계정을 다시 추가한 경우다.
            const googleStatus = await refreshGoogleWorkspaceStatus();
            const accountId = resolveNotificationGoogleAccountId(item, googleStatus);
            if (!accountId) {
                toast.warning(
                    t('notificationCenter.googleAccountUnavailableTitle'),
                    t('notificationCenter.googleAccountUnavailableMessage'),
                );
                onOpenChange(false);
                return;
            }
            try {
                await api.activateGoogleAccount(accountId);
            } catch {
                toast.warning(
                    t('notificationCenter.googleAccountUnavailableTitle'),
                    t('notificationCenter.googleAccountUnavailableMessage'),
                );
                onOpenChange(false);
                return;
            }
            window.dispatchEvent(new CustomEvent('vyact:google-account-changed', {
                detail: {accountId},
            }));
        }
        if (item.type === 'google_mail') {
            window.dispatchEvent(new CustomEvent('vyact:notification-selected', {
                detail: {type: item.type, sourceId: item.source_id},
            }));
        } else if (item.type === 'google_calendar') {
            const sourceMatch = item.source_id.match(/^primary:([^:]+):(.+):\d+$/);
            if (sourceMatch) {
                window.dispatchEvent(new CustomEvent('vyact:notification-selected', {
                    detail: {
                        type: item.type,
                        eventId: sourceMatch[1],
                        startAt: sourceMatch[2],
                        requestId: Date.now(),
                    },
                }));
            }
        }
        onOpenChange(false);
    }, [onOpenChange]);

    useEffect(() => {
        if (!open) return;
        const closeOnEscape = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            event.stopImmediatePropagation();
            onOpenChange(false);
        };
        window.addEventListener('keydown', closeOnEscape, true);
        return () => window.removeEventListener('keydown', closeOnEscape, true);
    }, [open, onOpenChange]);

    const popover = <div className="notification-center-popover" ref={popoverRef} style={popoverPosition}>
            <header>{t('notificationCenter.title')}</header>
            <div className="notification-center-list" ref={listRef} onScroll={event => {
                const target = event.currentTarget;
                if (target.scrollHeight - target.scrollTop - target.clientHeight < 48 && items.length < total) void load(items.length);
            }}>
                {!items.length && !loading && <p>{t('notificationCenter.empty')}</p>}
                {items.map(item => {
                    const localizedItem = localizeNotification(item, i18n.language);
                    const provider = item.type === 'google_mail' || item.type === 'google_calendar'
                        ? 'google'
                        : item.type === 'microsoft_mail' || item.type === 'microsoft_calendar'
                            ? 'microsoft' : null;
                    return <button key={item.id}
                    className={`notification-center-item${item.is_read ? '' : ' unread'}`}
                    onClick={() => void selectNotification(item)}>
                    <span className="notification-center-item-icon"><NotificationTypeIcon type={item.type}/></span>
                    <span className="notification-center-item-content">
                        <strong>{provider && <span
                            className="notification-center-provider"
                            aria-label={t(provider === 'google' ? 'settings:tabs.google' : 'settings:microsoft.title')}
                        >{provider === 'google' ? 'G' : 'M'}</span>}{item.account_email ? `[${item.account_email.split('@')[0]}] ` : ''}{localizedItem.title}</strong>
                        <span>{localizedItem.message}</span>
                        <small>{formatNotificationDate(
                            item.type === 'product_release' ? item.created_at : item.occurred_at || item.created_at,
                            i18n.language,
                        )}</small>
                    </span>
                </button>;
                })}
            </div>
        </div>;

    return <>
        <div className="notification-center" ref={centerRef}>
            <button ref={triggerRef} className="titlebar-btn notification-center-trigger" onClick={toggle}
                    aria-label={t('notificationCenter.toggle')}>
                <Bell size={16}/>{unread > 0 && <span className="notification-center-badge">{Math.min(unread, 99)}</span>}
            </button>
        </div>
        {open && createPortal(popover, document.body)}
        {selectedRelease && (() => {
            const localizedRelease = localizeNotification(selectedRelease, i18n.language);
            return <ProductReleaseModal
                title={localizedRelease.title}
                message={localizedRelease.message}
                url={selectedRelease.url}
                important={selectedRelease.important}
                onClose={() => setSelectedRelease(null)}/>;
        })()}
    </>;
}
