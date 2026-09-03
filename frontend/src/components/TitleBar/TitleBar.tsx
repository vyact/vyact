import React, {useEffect, useState} from 'react';
import {Camera} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import './TitleBar.css';
import NotificationCenter from './NotificationCenter';
import CustomSelect from '../CustomSelect/CustomSelect';

interface TitleBarProps {
    sidebarCollapsed: boolean;
    onToggleSidebar: () => void;
    onScreenshot: () => void;
    onSidebarHoverEnter?: () => void;
    onSidebarHoverLeave?: () => void;
    notificationCenterOpen: boolean;
    onNotificationCenterOpenChange: (open: boolean) => void;
}

const isMac = navigator.platform.toUpperCase().includes('MAC');
const SCREENSHOT_ASPECT_RATIOS = ['16:9', '4:3', '1:1'] as const;
const TitleBar: React.FC<TitleBarProps> = ({sidebarCollapsed, onToggleSidebar, onScreenshot, onSidebarHoverEnter, onSidebarHoverLeave, notificationCenterOpen, onNotificationCenterOpenChange}) => {
    const {t} = useTranslation('main');
    const [maximized, setMaximized] = useState(false);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [screenshotAspectRatio, setScreenshotAspectRatio] = useState('');

    useEffect(() => {
        const {ragAPI} = window;
        const handler = (_event: unknown, isMax: boolean) => setMaximized(isMax);
        ragAPI?.onMaximizeChange?.(handler);

        // 브라우저/Electron 전체화면 감지
        const onFsChange = () => setIsFullscreen(!!document.fullscreenElement);
        document.addEventListener('fullscreenchange', onFsChange);

        // Electron 전체화면 감지
        const fsHandler = (_event: unknown, isFull: boolean) => setIsFullscreen(isFull);
        ragAPI?.onFullscreenChange?.(fsHandler);

        return () => document.removeEventListener('fullscreenchange', onFsChange);
    }, []);

    const handleMinimize = () => window.ragAPI?.minimize?.();
    const handleMaximize = () => window.ragAPI?.maximize?.();
    const handleClose = () => window.ragAPI?.close?.();
    const handleAspectRatioChange = async (aspectRatio: string) => {
        setScreenshotAspectRatio(aspectRatio);
        await window.ragAPI?.setWindowAspectRatio?.(aspectRatio);
    };

    return (
        <div className="titlebar">
            {/* 왼쪽: macOS 트래픽 라이트 공간 + 사이드바 토글 */}
            <div className="titlebar-left">
                {isMac && !isFullscreen && <div className="titlebar-traffic-spacer" />}
                <button
                    className="titlebar-btn"
                    onClick={onToggleSidebar}
                    onMouseEnter={sidebarCollapsed ? onSidebarHoverEnter : undefined}
                    onMouseLeave={sidebarCollapsed ? onSidebarHoverLeave : undefined}
                >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                         strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="3" width="18" height="18" rx="2" />
                        <line x1="9" y1="3" x2="9" y2="21" />
                    </svg>
                </button>
            </div>

            {/* 중앙: 드래그 영역 */}
            <div className="titlebar-drag" />

            <div className="titlebar-tools">
                <CustomSelect
                    className="titlebar-aspect-ratio-select"
                    options={SCREENSHOT_ASPECT_RATIOS.map(value => ({value, label: value}))}
                    value={screenshotAspectRatio}
                    onChange={handleAspectRatioChange}
                    placeholder={t('screenshot.aspectRatio')}
                    alignRight
                    ariaLabel={t('screenshot.aspectRatio')}
                />
                <button className="titlebar-btn" onClick={onScreenshot} aria-label={t('screenshot.captureCurrent')}>
                    <Camera size={15} />
                </button>
                <NotificationCenter open={notificationCenterOpen} onOpenChange={onNotificationCenterOpenChange}/>
            </div>

            {/* 오른쪽: Windows 창 컨트롤 */}
            {!isMac && (
                <div className="titlebar-win-controls">
                    <button className="titlebar-win-btn" onClick={handleMinimize} title={t('windowControls.minimize')}>
                        <svg width="12" height="12" viewBox="0 0 12 12">
                            <line x1="1" y1="6" x2="11" y2="6" stroke="currentColor" strokeWidth="1.2" />
                        </svg>
                    </button>
                    <button className="titlebar-win-btn" onClick={handleMaximize} title={t(maximized ? 'windowControls.restore' : 'windowControls.maximize')}>
                        {maximized ? (
                            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2">
                                <rect x="2.5" y="3.5" width="7" height="7" rx="0.5" />
                                <path d="M4.5 3.5V1.5h7v7h-2" />
                            </svg>
                        ) : (
                            <svg width="12" height="12" viewBox="0 0 12 12">
                                <rect x="1.5" y="1.5" width="9" height="9" rx="0.5" fill="none" stroke="currentColor" strokeWidth="1.2" />
                            </svg>
                        )}
                    </button>
                    <button className="titlebar-win-btn titlebar-win-btn--close" onClick={handleClose} title={t('windowControls.close')}>
                        <svg width="12" height="12" viewBox="0 0 12 12" stroke="currentColor" strokeWidth="1.2">
                            <line x1="2" y1="2" x2="10" y2="10" />
                            <line x1="10" y1="2" x2="2" y2="10" />
                        </svg>
                    </button>
                </div>
            )}
        </div>
    );
};

export default TitleBar;
