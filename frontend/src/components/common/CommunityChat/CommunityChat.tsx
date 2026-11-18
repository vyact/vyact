import {useEffect, useRef, useState} from 'react';
import {useTranslation} from 'react-i18next';
import './CommunityChat.css';
import {STOCK_ANALYSIS_SHORTCUT_KEY} from '../../../services/stockAnalysis';

const SHORTCUT_MESSAGE = 'vyact:community-shortcut';
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

const THEME_TOKENS = ['--bg', '--surface', '--surface2', '--border', '--accent', '--text', '--muted', '--on-accent', '--warn', '--overlay'];
const configuredUrl = import.meta.env.VITE_COMMUNITY_URL?.trim();
const COMMUNITY_URL = configuredUrl || (import.meta.env.DEV ? 'http://localhost:5175' : 'https://vyact.vyvow.com');

export default function CommunityChat({entry = 'main', title, unavailableMessage}: {
    entry?: CommunityChatEntry;
    title: string;
    unavailableMessage: string;
}) {
    const {i18n} = useTranslation();
    const shortcuts = entry === 'stock-analysis' ? STOCK_COMMUNITY_SHORTCUTS : COMMUNITY_SHORTCUTS;
    const language = i18n.resolvedLanguage ?? i18n.language;
    const [initialLanguage] = useState(language);
    const iframe = useRef<HTMLIFrameElement>(null);
    const [initialTheme] = useState(() => document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');
    useEffect(() => {
        if (!COMMUNITY_URL) return;
        const origin = new URL(COMMUNITY_URL).origin;
        const sendTheme = () => {
            const root = document.documentElement;
            const styles = getComputedStyle(root);
            iframe.current?.contentWindow?.postMessage({type: 'vyact:community-theme', theme: root.dataset.theme === 'light' ? 'light' : 'dark',
                tokens: Object.fromEntries(THEME_TOKENS.map(token => [token, styles.getPropertyValue(token).trim()])),
                language, shortcuts: [...shortcuts.keys()]}, origin);
        };
        const onMessage = (event: MessageEvent) => {
            const frame = iframe.current;
            if (!frame || event.origin !== origin || event.source !== frame.contentWindow) return;
            if (event.data?.type === 'vyact:community-ready') {
                sendTheme();
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
        frame?.addEventListener('load', sendTheme);
        window.addEventListener('message', onMessage);
        const observer = new MutationObserver(sendTheme);
        observer.observe(document.documentElement, {attributes: true, attributeFilter: ['data-theme', 'style', 'class']});
        sendTheme();
        return () => {observer.disconnect(); frame?.removeEventListener('load', sendTheme); window.removeEventListener('message', onMessage);};
    }, [language, shortcuts]);
    if (!COMMUNITY_URL) return <p className="community-chat-unavailable">{unavailableMessage}</p>;
    const url = new URL(COMMUNITY_URL);
    url.searchParams.set('embed', 'true');
    url.searchParams.set('entry', entry);
    url.searchParams.set('theme', initialTheme);
    if (initialLanguage) url.searchParams.set('lang', initialLanguage);
    return <iframe ref={iframe} className="community-chat-frame" src={url.href} aria-label={title} data-tooltip-disabled referrerPolicy="origin"/>;
}
