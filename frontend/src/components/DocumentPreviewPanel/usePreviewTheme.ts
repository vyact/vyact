import {useEffect, useState} from 'react';

const PREVIEW_THEME_TOKENS = ['--surface', '--surface2', '--text', '--border', '--info'];
function readPreviewTheme(): string {
    const root = document.documentElement;
    const styles = getComputedStyle(root);
    const tokens = PREVIEW_THEME_TOKENS.map(token => `${token}:${styles.getPropertyValue(token).trim()};`).join('');
    return `:root{color-scheme:${root.dataset.theme === 'light' ? 'light' : 'dark'};${tokens}}`;
}
export function usePreviewTheme(): string {
    const [theme, setTheme] = useState(readPreviewTheme);
    useEffect(() => {
        const observer = new MutationObserver(() => setTheme(readPreviewTheme()));
        observer.observe(document.documentElement, {attributes: true, attributeFilter: ['data-theme', 'style', 'class']});
        return () => observer.disconnect();
    }, []);
    return theme;
}
