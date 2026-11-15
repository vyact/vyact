import {useEffect, useRef} from 'react';
import {useTranslation} from 'react-i18next';

const THEME_TOKENS = ['--bg', '--surface', '--surface2', '--border', '--accent', '--text', '--muted', '--on-accent', '--warn', '--overlay'];
const configuredUrl = import.meta.env.VITE_COMMUNITY_URL?.trim();
const COMMUNITY_URL = configuredUrl || (import.meta.env.DEV ? 'http://localhost:5175' : '');

export default function StockCommunityChat() {
    const {t} = useTranslation('main');
    const iframe = useRef<HTMLIFrameElement>(null);
    useEffect(() => {
        if (!COMMUNITY_URL) return;
        const origin = new URL(COMMUNITY_URL).origin;
        const sendTheme = () => {
            const root = document.documentElement;
            const styles = getComputedStyle(root);
            iframe.current?.contentWindow?.postMessage({type: 'vyact:community-theme', theme: root.dataset.theme === 'light' ? 'light' : 'dark',
                tokens: Object.fromEntries(THEME_TOKENS.map(token => [token, styles.getPropertyValue(token).trim()]))}, origin);
        };
        const onMessage = (event: MessageEvent) => {
            if (event.origin === origin && event.source === iframe.current?.contentWindow && event.data?.type === 'vyact:community-ready') sendTheme();
        };
        const frame = iframe.current;
        frame?.addEventListener('load', sendTheme);
        window.addEventListener('message', onMessage);
        const observer = new MutationObserver(sendTheme);
        observer.observe(document.documentElement, {attributes: true, attributeFilter: ['data-theme', 'style', 'class']});
        sendTheme();
        return () => {observer.disconnect(); frame?.removeEventListener('load', sendTheme); window.removeEventListener('message', onMessage);};
    }, []);
    if (!COMMUNITY_URL) return <p className="stock-community-unavailable">{t('stockAnalysis.community.unavailable')}</p>;
    const url = new URL(COMMUNITY_URL);
    url.searchParams.set('embed', 'true');
    url.searchParams.set('theme', document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');
    return <iframe ref={iframe} className="stock-community-frame" src={url.href} title={t('stockAnalysis.community.chat')} referrerPolicy="origin"/>;
}
