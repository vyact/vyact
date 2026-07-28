interface Window {
    ragAPI?: {
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
        notifyAppReady?: () => void;
    };
}
