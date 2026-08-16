import React, {FormEvent, useEffect, useRef, useState} from 'react';
import {ArrowLeft, ArrowRight, Globe2, PanelRight, PictureInPicture2, RefreshCw, X} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import {usePanelManager} from '../../contexts/PanelManagerContext';
import './BrowserPanel.css';

const BROWSER_PANEL_ID = 'browser';
const FLOATING_FOOTER_HEIGHT = 24;
const DEFAULT_STATE: BrowserViewState = {open: false, url: '', title: '', loading: false, canGoBack: false, canGoForward: false};

type BrowserDisplayMode = 'docked' | 'floating';

const BrowserPanel: React.FC<{style?: React.CSSProperties}> = ({style}) => {
    const {t} = useTranslation('main');
    const panels = usePanelManager();
    const panelRef = useRef<HTMLDivElement>(null);
    const stateRef = useRef<BrowserViewState>(DEFAULT_STATE);
    const modeRef = useRef<BrowserDisplayMode>('docked');
    const overlaySuspendedRef = useRef(false);
    const [state, setState] = useState<BrowserViewState>(DEFAULT_STATE);
    const [address, setAddress] = useState('');
    const [mode, setModeState] = useState<BrowserDisplayMode>('docked');
    const [floatingSize, setFloatingSize] = useState({width: 560, height: 640});
    const isDocked = panels.activePanel === BROWSER_PANEL_ID && mode === 'docked';
    const isVisible = state.open && (isDocked || mode === 'floating');

    const setMode = (nextMode: BrowserDisplayMode) => {
        modeRef.current = nextMode;
        setModeState(nextMode);
    };

    const syncBounds = () => {
        const rect = panelRef.current?.getBoundingClientRect();
        if (!rect || !isVisible) return;
        if (modeRef.current === 'floating') setFloatingSize({width: Math.round(rect.width), height: Math.round(rect.height)});
        void window.ragAPI?.browserSetBounds?.({
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
            toolbarHeight: 52,
            footerHeight: modeRef.current === 'floating' ? FLOATING_FOOTER_HEIGHT : 0,
        });
    };

    useEffect(() => {
        const unregister = panels.register({id: BROWSER_PANEL_ID});
        return () => {
            void window.ragAPI?.browserClose?.();
            unregister();
        };
    }, [panels.register]);

    useEffect(() => window.ragAPI?.onBrowserState?.(nextState => {
        const wasOpen = stateRef.current.open;
        stateRef.current = nextState;
        setState(nextState);
        if (nextState.url) setAddress(nextState.url);
        // 닫힌 브라우저를 LLM이 새로 열었을 때만 우측 패널을 자동 점유한다.
        if (nextState.open && !wasOpen) {
            setMode('docked');
            panels.open(BROWSER_PANEL_ID);
        }
    }), [panels.open]);

    useEffect(() => {
        if (panels.activePanel === BROWSER_PANEL_ID) {
            setMode('docked');
            if (!stateRef.current.open) void window.ragAPI?.browserOpen?.();
            requestAnimationFrame(syncBounds);
            return;
        }
        // 코드·YouTube·Google Workspace 등 다른 우측 패널이 활성화되면
        // 현재 페이지와 로그인 세션을 유지한 채 브라우저만 플로팅으로 전환한다.
        if (stateRef.current.open && modeRef.current === 'docked') setMode('floating');
    }, [panels.activePanel]);

    useEffect(() => {
        if (!isVisible) return;
        const observer = new ResizeObserver(syncBounds);
        if (panelRef.current) observer.observe(panelRef.current);
        window.addEventListener('resize', syncBounds);
        requestAnimationFrame(syncBounds);
        return () => {
            observer.disconnect();
            window.removeEventListener('resize', syncBounds);
        };
    }, [isVisible, mode]);

    useEffect(() => {
        const suspendForOverlay = () => {
            if (!stateRef.current.open) return;
            overlaySuspendedRef.current = true;
            void window.ragAPI?.browserClose?.();
        };
        const restoreAfterOverlay = () => {
            if (!overlaySuspendedRef.current) return;
            overlaySuspendedRef.current = false;
            void window.ragAPI?.browserOpen?.().then(() => requestAnimationFrame(syncBounds));
        };
        window.addEventListener('vyact:native-overlay-open', suspendForOverlay);
        window.addEventListener('vyact:native-overlay-close', restoreAfterOverlay);
        return () => {
            window.removeEventListener('vyact:native-overlay-open', suspendForOverlay);
            window.removeEventListener('vyact:native-overlay-close', restoreAfterOverlay);
        };
    }, []);

    const navigate = (event: FormEvent) => {
        event.preventDefault();
        void window.ragAPI?.browserNavigate?.(address);
    };
    const floatBrowser = () => {
        setMode('floating');
        panels.close(BROWSER_PANEL_ID);
        requestAnimationFrame(syncBounds);
    };
    const dockBrowser = () => {
        setMode('docked');
        panels.open(BROWSER_PANEL_ID);
        requestAnimationFrame(syncBounds);
    };
    const close = () => {
        // 진행 중인 LLM 브라우저 작업도 일반 채팅 중지 버튼과 같은 경로로 취소한다.
        window.dispatchEvent(new CustomEvent('vyact:stop-active-chat-request'));
        void window.ragAPI?.browserClose?.();
        stateRef.current = {...stateRef.current, open: false};
        setState(current => ({...current, open: false}));
        if (panels.activePanel === BROWSER_PANEL_ID) panels.close(BROWSER_PANEL_ID);
    };

    if (!isVisible) return null;
    return <aside ref={panelRef}
        className={`browser-panel browser-panel--${mode}`}
        style={mode === 'docked' ? style : undefined}
        aria-label={t('browser.title')}>
        <div className="floating-browser-toolbar">
            <span className="floating-browser-brand" title={state.title || t('browser.title')}><Globe2 size={17}/></span>
            <button type="button" disabled={!state.canGoBack} title={t('browser.back')} onClick={() => void window.ragAPI?.browserBack?.()}><ArrowLeft size={17}/></button>
            <button type="button" disabled={!state.canGoForward} title={t('browser.forward')} onClick={() => void window.ragAPI?.browserForward?.()}><ArrowRight size={17}/></button>
            <button type="button" className={state.loading ? 'is-loading' : ''} title={t('browser.reload')} onClick={() => void window.ragAPI?.browserReload?.()}><RefreshCw size={16}/></button>
            <form onSubmit={navigate}><input value={address} onChange={event => setAddress(event.target.value)} aria-label={t('browser.address')} placeholder={t('browser.addressPlaceholder')}/></form>
            {mode === 'docked'
                ? <button type="button" title={t('browser.float')} onClick={floatBrowser}><PictureInPicture2 size={17}/></button>
                : <button type="button" title={t('browser.dock')} onClick={dockBrowser}><PanelRight size={17}/></button>}
            <button type="button" title={t('browser.close')} onClick={close}><X size={18}/></button>
        </div>
        <div className="floating-browser-surface" aria-hidden="true"/>
        {mode === 'floating' && <footer className="browser-floating-size" aria-live="polite">
            {floatingSize.width} × {floatingSize.height}
        </footer>}
    </aside>;
};

export default BrowserPanel;
