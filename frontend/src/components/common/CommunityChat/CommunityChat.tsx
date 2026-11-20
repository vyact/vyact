import {useEffect, useRef, useState, type ReactNode} from 'react';
import {useTranslation} from 'react-i18next';
import './CommunityChat.css';
import CommunityAvatarMenu from './CommunityAvatarMenu';
import {STOCK_ANALYSIS_SHORTCUT_KEY} from '../../../services/stockAnalysis';

const FRAME_READY_TIMEOUT_MS = 15_000;
const SHORTCUT_MESSAGE = 'vyact:community-shortcut';
const MAX_COMMUNITY_MESSAGE_LENGTH = 2000;
const TRANSLATION_TIMEOUT_MS = 310_000;
const SHIFT_SHORTCUT_KEYS = [STOCK_ANALYSIS_SHORTCUT_KEY, 'A', 'B', 'D', 'G', 'J', 'L', 'M', 'N'];
const COMMUNITY_SHORTCUTS = new Map([
    ...SHIFT_SHORTCUT_KEYS.map(key => [`Shift+Key${key}`, key] as const),
    ['Digit1', '1'],
    ['KeyK', 'k'],
    ['Slash', '/'],
    ['Shift+Comma', '<'],
]);

const STOCK_COMMUNITY_SHORTCUTS = new Map([
    ...COMMUNITY_SHORTCUTS,
    ...Array.from({length: 5}, (_, index) => [`Digit${index + 2}`, String(index + 2)] as const),
    ['Shift+KeyH', 'H'],
    ['Shift+KeyI', 'I'],
    ['ArrowLeft', 'ArrowLeft'],
]);

export type CommunityChatEntry = 'main' | 'stock-analysis' | 'novel-studio';

const THEME_TOKENS = ['--bg', '--bg-secondary', '--surface', '--surface2', '--border', '--accent', '--text', '--muted', '--on-accent', '--warn', '--overlay', '--success', '--action-delete'];
const AVATAR_CDN_ORIGIN = 'https://media.vyact.vyvow.com';
function resolveAvatar(path: unknown, origin: string) {
    if (typeof path !== 'string') return;
    if (/^\/(assets|avatars|src)\/[a-zA-Z0-9_/.-]+$/.test(path)) return new URL(path, origin).href;
    if (!path.startsWith(`${AVATAR_CDN_ORIGIN}/`)) return;
    const pathname = new URL(path).pathname;
    if (/^\/(local|prod)\/profile\/\d+\/[a-f0-9-]+\.jpg$/.test(pathname)
        || /^\/presets\/v1\/preset-[1-6]\.webp$/.test(pathname)) return path;
}
const configuredUrl = import.meta.env.VITE_COMMUNITY_URL?.trim();
const COMMUNITY_URL = configuredUrl || (import.meta.env.DEV ? 'http://localhost:5175' : 'https://vyact.vyvow.com');

export default function CommunityChat({entry = 'main', title, unavailableMessage, loadingIndicator, stockPicker}: {
    entry?: CommunityChatEntry;
    title: string;
    unavailableMessage: string;
    loadingIndicator?: ReactNode;
    stockPicker?: (enabled: boolean, selectScope: (market: string, marketName: string, symbol?: string, stockName?: string) => void, accountMenu: ReactNode) => ReactNode;
}) {
    const {i18n} = useTranslation();
    const shortcuts = entry === 'stock-analysis' ? STOCK_COMMUNITY_SHORTCUTS : COMMUNITY_SHORTCUTS;
    const language = i18n.resolvedLanguage ?? i18n.language;
    const [initialLanguage] = useState(language);
    const [frameReady, setFrameReady] = useState(false);
    const [frameTimedOut, setFrameTimedOut] = useState(false);
    const [picker, setPicker] = useState({visible: false, enabled: false});
    const [account, setAccount] = useState<{nickname: string; nicknameEditLabel?: string; avatarSrc?: string; avatarEditLabel?: string; logoutLabel: string} | null>(null);
    const iframe = useRef<HTMLIFrameElement>(null);
    const [initialTheme] = useState(() => document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');
    const hasLoadingIndicator = loadingIndicator != null;
    useEffect(() => {
        if (frameReady || !hasLoadingIndicator) return;
        const timeout = window.setTimeout(() => setFrameTimedOut(true), FRAME_READY_TIMEOUT_MS);
        return () => window.clearTimeout(timeout);
    }, [frameReady, hasLoadingIndicator]);
    useEffect(() => {
        if (!COMMUNITY_URL) return;
        const origin = new URL(COMMUNITY_URL).origin;
        const translationSession = new AbortController();
        let translating = false;
        const translateMessage = async (frame: HTMLIFrameElement, requestId: string, text: string) => {
            const reply = (result: {translation?: string; error?: 'busy' | 'failed'}) => {
                if (!translationSession.signal.aborted) {
                    frame.contentWindow?.postMessage({type: 'vyact:community-translation-result', requestId, language, ...result}, origin);
                }
            };
            if (translating) {
                reply({error: 'busy'});
                return;
            }
            translating = true;
            try {
                const target = new Intl.DisplayNames(['en'], {type: 'language'}).of(language) ?? language;
                const response = await fetch('/api/translate', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    signal: AbortSignal.any([translationSession.signal, AbortSignal.timeout(TRANSLATION_TIMEOUT_MS)]),
                    body: JSON.stringify({text, target_lang: target, include_response_language: false, save_history: false}),
                });
                if (!response.ok) {
                    reply({error: response.status === 409 ? 'busy' : 'failed'});
                    return;
                }
                const {translated} = await response.json();
                const translation = typeof translated === 'string' ? translated.trim() : '';
                reply(translation ? {translation} : {error: 'failed'});
            } catch {
                reply({error: 'failed'});
            } finally {
                translating = false;
            }
        };
        const sendTheme = () => {
            const root = document.documentElement;
            const styles = getComputedStyle(root);
            iframe.current?.contentWindow?.postMessage({type: 'vyact:community-theme', theme: root.dataset.theme === 'light' ? 'light' : 'dark',
                tokens: Object.fromEntries(THEME_TOKENS.map(token => [token, styles.getPropertyValue(token).trim()])),
                language, shortcuts: [...shortcuts.keys()]}, origin);
        };
        const requestPickerStatus = () => {
            if (entry === 'stock-analysis') {
                iframe.current?.contentWindow?.postMessage({type: 'vyact:community-stock-picker-request'}, origin);
            }
        };
        const syncFrame = () => {
            sendTheme();
            requestPickerStatus();
        };
        const onFrameLoad = () => {
            syncFrame();
            if (entry !== 'stock-analysis') setFrameReady(true);
        };
        const onMessage = (event: MessageEvent) => {
            const frame = iframe.current;
            if (!frame || event.origin !== origin || event.source !== frame.contentWindow) return;
            if (entry === 'stock-analysis' && event.data?.type === 'vyact:community-translate-message') {
                const {requestId, text} = event.data;
                if (typeof requestId === 'string' && /^[\da-f-]{36}$/i.test(requestId)
                    && typeof text === 'string' && text.length <= MAX_COMMUNITY_MESSAGE_LENGTH && text.trim()) {
                    void translateMessage(frame, requestId, text);
                }
                return;
            }
            if (event.data?.type === 'vyact:community-ready') {
                syncFrame();
                return;
            }
            if (event.data?.type === 'vyact:community-pointerdown') {
                frame.dispatchEvent(new PointerEvent('pointerdown', {bubbles: true}));
                return;
            }
            if (entry === 'stock-analysis' && event.data?.type === 'vyact:community-stock-picker') {
                if (event.data.ready !== false) setFrameReady(true);
                setPicker({visible: event.data.visible === true, enabled: event.data.enabled === true});
                const {nickname, nicknameEditLabel, avatarPath, avatarEditLabel, logoutLabel} = event.data;
                setAccount(typeof nickname === 'string' && typeof logoutLabel === 'string' ? {
                    nickname, logoutLabel,
                    nicknameEditLabel: typeof nicknameEditLabel === 'string' ? nicknameEditLabel : undefined,
                    avatarSrc: resolveAvatar(avatarPath, origin),
                    avatarEditLabel: typeof avatarEditLabel === 'string' ? avatarEditLabel : undefined,
                } : null);
                return;
            }
            if (event.data?.type !== SHORTCUT_MESSAGE || document.activeElement !== frame
                || frame.closest('[hidden], [inert]')) return;
            const {code, shiftKey, metaKey, ctrlKey} = event.data;
            if (typeof code !== 'string' || typeof shiftKey !== 'boolean'
                || typeof metaKey !== 'boolean' || typeof ctrlKey !== 'boolean' || metaKey === ctrlKey
                || (code === 'ArrowLeft' && !metaKey)) return;
            const key = shortcuts.get(shiftKey ? `Shift+${code}` : code);
            if (!key) return;
            frame.dispatchEvent(new KeyboardEvent('keydown', {
                key, code, shiftKey, metaKey, ctrlKey, bubbles: true, cancelable: true,
            }));
        };
        const frame = iframe.current;
        frame?.addEventListener('load', onFrameLoad);
        window.addEventListener('message', onMessage);
        const observer = new MutationObserver(sendTheme);
        observer.observe(document.documentElement, {attributes: true, attributeFilter: ['data-theme', 'style', 'class']});
        syncFrame();
        return () => {translationSession.abort(); observer.disconnect(); frame?.removeEventListener('load', onFrameLoad); window.removeEventListener('message', onMessage);};
    }, [entry, language, shortcuts]);
    if (!COMMUNITY_URL) return <p className="community-chat-unavailable">{unavailableMessage}</p>;
    const url = new URL(COMMUNITY_URL);
    url.searchParams.set('embed', 'true');
    url.searchParams.set('entry', entry);
    url.searchParams.set('theme', initialTheme);
    if (initialLanguage) url.searchParams.set('lang', initialLanguage);
    const selectScope = (market: string, marketName: string, symbol?: string, stockName?: string) => {
        iframe.current?.contentWindow?.postMessage({type: 'vyact:community-select-scope', market, marketName, symbol, stockName}, url.origin);
    };
    const accountMenu = account && <CommunityAvatarMenu key={account.nickname} {...account}
        onEditNickname={() => {
            iframe.current?.focus();
            iframe.current?.contentWindow?.postMessage({type: 'vyact:community-edit-nickname'}, url.origin);
        }}
        onEditAvatar={() => {
            iframe.current?.focus();
            iframe.current?.contentWindow?.postMessage({type: 'vyact:community-edit-avatar'}, url.origin);
        }}
        onLogout={() => iframe.current?.contentWindow?.postMessage({type: 'vyact:community-logout'}, url.origin)}/>;
    const waitingForFrame = hasLoadingIndicator && !frameReady;
    return <>
        {entry === 'stock-analysis' && (picker.visible || account) &&
            <div hidden={!picker.visible}>{stockPicker?.(picker.enabled, selectScope, accountMenu)}</div>}
        <div className="community-chat-stage">
            <iframe ref={iframe} className="community-chat-frame" src={url.href} aria-label={title}
                aria-hidden={waitingForFrame || undefined} data-loading={waitingForFrame || undefined}
                data-tooltip-disabled referrerPolicy="origin"/>
            {waitingForFrame && (frameTimedOut
                ? <div className="community-chat-load-error" role="status">{unavailableMessage}</div>
                : loadingIndicator)}
        </div>
    </>;
}
