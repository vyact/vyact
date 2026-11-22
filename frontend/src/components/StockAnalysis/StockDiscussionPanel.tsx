import {useRef, useCallback, useContext, useEffect, useState, type CSSProperties, type ComponentProps, type ReactNode} from 'react';
import {WorkspaceRightSidebarContext} from '../../contexts/WorkspaceSidebarContext';
import {useTranslation} from 'react-i18next';
import PanelResizer from '../common/PanelResizer/PanelResizer';
import useStockAnalysisShortcut from './useStockAnalysisShortcut';
import type StockDiscussionSidebar from './StockDiscussionSidebar';
import type {StockMarket, StockSymbol} from '../../services/stockAnalysis';
import ModalTabs from '../common/ModalTabs/ModalTabs';
import CommunityChat from '../common/CommunityChat/CommunityChat';
import StockChatPicker from './StockChatPicker';
import StockLoadingIndicator from './StockLoadingIndicator';
import {chartSnapshotPng, MAX_CHAT_IMAGE_DIMENSION} from './chartSnapshot';
import './StockCommunityChat.css';

const STORAGE_KEY = 'vyact:stock-discussion:layout';
const ACTIVE_TAB_KEY = 'vyact:stock-discussion:active-tab';
const DEFAULT_WIDTH = 340;
const MIN_WIDTH = DEFAULT_WIDTH;
const MAX_WIDTH = 720;
const MIN_CONTENT_WIDTH = 320;
type DiscussionTab = 'ai' | 'chat';

function readActiveTab(): DiscussionTab {
    try {return localStorage.getItem(ACTIVE_TAB_KEY) === 'chat' ? 'chat' : 'ai';} catch {return 'ai';}
}

function readLayout(): {width: number; collapsed: boolean} {
    try {
        const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
        return {width: Number.isFinite(saved.width) ? Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, saved.width)) : DEFAULT_WIDTH,
            collapsed: saved.collapsed === true};
    } catch {return {width: DEFAULT_WIDTH, collapsed: false};}
}

type AnalysisVisibility = Pick<ComponentProps<typeof StockDiscussionSidebar>, 'isVisible' | 'onReveal'>;

export default function StockDiscussionPanel({market, directory, captureChart, captureMap, renderAnalysis}: {
    market: StockMarket;
    directory: StockSymbol[];
    captureMap?: (() => HTMLCanvasElement | null) | null;
    captureChart?: ComponentProps<typeof StockDiscussionSidebar>['captureChart'];
    renderAnalysis: (visibility: AnalysisVisibility) => ReactNode;
}) {
    const {t} = useTranslation('main');
    const captureChatChart = useCallback(async () => {
        const canvas = captureMap ? captureMap() : captureChart?.current?.()?.canvas;
        return canvas ? chartSnapshotPng(canvas, MAX_CHAT_IMAGE_DIMENSION) : null;
    }, [captureChart, captureMap]);
    const [layout, setLayout] = useState(readLayout);
    const [activeTab, setActiveTab] = useState(readActiveTab);
    const [chatLoaded, setChatLoaded] = useState(activeTab === 'chat');
    const selectTab = (tab: DiscussionTab) => {
        setActiveTab(tab);
        if (tab === 'chat') setChatLoaded(true);
        try {localStorage.setItem(ACTIVE_TAB_KEY, tab);} catch { /* Optional tab preference. */ }
    };
    const panel = useRef<HTMLDivElement>(null);
    const previewWidth = useCallback((width: number) => {
        panel.current?.style.setProperty('--stock-discussion-width', `${width}px`);
    }, []);
    const updateLayout = useCallback((next: typeof layout) => {
        setLayout(next);
        try {localStorage.setItem(STORAGE_KEY, JSON.stringify(next));} catch { /* Optional layout preference. */ }
    }, []);
    const clampWidth = (width: number) => {
        const bounds = panel.current?.closest('.stock-analysis-inner')?.getBoundingClientRect();
        const maximum = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, bounds ? bounds.width - MIN_CONTENT_WIDTH : MAX_WIDTH));
        return Math.max(MIN_WIDTH, Math.min(maximum, width));
    };
    const toggle = useCallback(() => updateLayout({...layout, collapsed: !layout.collapsed}), [layout, updateLayout]);
    const registerRightSidebar = useContext(WorkspaceRightSidebarContext);
    useEffect(() => {
        registerRightSidebar({collapsed: layout.collapsed, toggle});
        return () => registerRightSidebar(null);
    }, [registerRightSidebar, layout.collapsed, toggle]);
    useStockAnalysisShortcut('I', toggle);
    return <div ref={panel} className={`stock-discussion-container${layout.collapsed ? ' is-collapsed' : ''}`}
        style={{'--stock-discussion-width': `${layout.width}px`} as CSSProperties}>
        {!layout.collapsed && <PanelResizer className="stock-discussion-resizer" onWidthChange={previewWidth}
            onResizeStart={() => panel.current?.classList.add('is-resizing')}
            onResizeEnd={width => {
                if (width !== undefined) updateLayout({...layout, width});
                panel.current?.classList.remove('is-resizing');
            }}
            hideHint
            getWidth={event => {
                const bounds = panel.current!.closest('.stock-analysis-inner')!.getBoundingClientRect();
                return clampWidth(bounds.right - event.clientX);
            }} onReset={() => updateLayout({...layout,
                width: clampWidth(layout.width === DEFAULT_WIDTH ? DEFAULT_WIDTH * 2 : DEFAULT_WIDTH),
            })}/>}
        <div className="stock-discussion-body" inert={layout.collapsed} aria-hidden={layout.collapsed}>
            <div className="stock-community-tabs" data-tooltip-disabled><ModalTabs activeKey={activeTab} onChange={selectTab}
                tabs={[{key: 'ai', label: t('stockAnalysis.discussion.ai')}, {key: 'chat', label: t('stockAnalysis.community.chat')}]}/></div>
            <div className="stock-community-tab-content" hidden={activeTab !== 'ai'}>
                {renderAnalysis({
                    isVisible: !layout.collapsed && activeTab === 'ai',
                    onReveal: () => {
                        selectTab('ai');
                        if (layout.collapsed) updateLayout({...layout, collapsed: false});
                    },
                })}
            </div>
            {chatLoaded && <div className="stock-community-tab-content stock-community-chat-content" hidden={activeTab !== 'chat'}><CommunityChat entry="stock-analysis"
                captureChart={captureChart || captureMap ? captureChatChart : undefined}
                chartAttachmentKind={captureMap ? 'sector-map' : 'chart'}
                stockPicker={(enabled, scope, onScopeChange, accountMenu) => <StockChatPicker localMarket={market} directory={directory}
                    enabled={enabled} scope={scope} onScopeChange={onScopeChange} accountMenu={accountMenu}/>}
                loadingIndicator={<StockLoadingIndicator title={t('stockAnalysis.community.chat')} iconOnly/>}
                title={t('stockAnalysis.community.chat')} unavailableMessage={t('stockAnalysis.community.unavailable')}/></div>}
        </div>
    </div>;
}
