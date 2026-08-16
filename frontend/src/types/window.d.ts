interface Window {
    ragAPI?: {
        openExternal?: (url: string) => Promise<void>;
        copyToClipboard?: (text: string) => void;
        minimize?: () => void;
        maximize?: () => void;
        close?: () => void;
        onMaximizeChange?: (callback: (event: unknown, isMaximized: boolean) => void) => void;
        onFullscreenChange?: (callback: (event: unknown, isFullscreen: boolean) => void) => void;
        screenshot?: () => Promise<string | null>;
        setWindowAspectRatio?: (aspectRatio: string) => Promise<boolean>;
        getLoginItem?: () => Promise<boolean>;
        setLoginItem?: (enabled: boolean) => Promise<boolean>;
        selectFolder?: () => Promise<string | null>;
        selectFolders?: () => Promise<string[]>;
        browserOpen?: (url?: string) => Promise<BrowserViewState>;
        browserClose?: () => Promise<BrowserViewState>;
        browserNavigate?: (url: string) => Promise<BrowserViewState>;
        browserBack?: () => Promise<BrowserViewState>;
        browserForward?: () => Promise<BrowserViewState>;
        browserReload?: () => Promise<BrowserViewState>;
        browserSetBounds?: (bounds: BrowserViewBounds) => Promise<BrowserViewState>;
        onBrowserState?: (callback: (state: BrowserViewState) => void) => () => void;
        notifyAppReady?: () => void;
    };
}

interface BrowserViewBounds {
    x: number;
    y: number;
    width: number;
    height: number;
    toolbarHeight: number;
    footerHeight?: number;
}

interface BrowserViewState {
    open: boolean;
    url: string;
    title: string;
    loading: boolean;
    canGoBack: boolean;
    canGoForward: boolean;
}
