import StockAnalysis from '../StockAnalysis/StockAnalysis';
import {STOCK_ANALYSIS_PANEL_ID, TOGGLE_STOCK_ANALYSIS_EVENT} from '../../services/stockAnalysis';
import {useEffect, type ReactNode} from 'react';
import {EXIT_NOVEL_STUDIO_EVENT, TOGGLE_NOVEL_STUDIO_EVENT} from '../NovelStudio/workspaceEvents';
import {usePanelManager} from '../../contexts/PanelManagerContext';
import WorkspaceHost from '../common/WorkspaceLayout/WorkspaceHost';
import NovelStudio from '../NovelStudio/NovelStudio';
import {NOVEL_STUDIO_PANEL_ID} from '../NovelStudio/storyStorage';

export default function MainWorkspace({children}: {children: ReactNode}) {
    const {activePanel, open, close, registerLeaveGuard} = usePanelManager();
    useEffect(() => registerLeaveGuard(NOVEL_STUDIO_PANEL_ID, proceed => {
        window.dispatchEvent(new CustomEvent(EXIT_NOVEL_STUDIO_EVENT, {detail: {proceed}}));
    }), [registerLeaveGuard]);
    useEffect(() => {
        const toggleStudio = () => {
            if (activePanel === NOVEL_STUDIO_PANEL_ID) {
                window.dispatchEvent(new Event(EXIT_NOVEL_STUDIO_EVENT));
            } else {
                open(NOVEL_STUDIO_PANEL_ID);
            }
        };
        const toggleStockAnalysis = () => {
            if (activePanel === STOCK_ANALYSIS_PANEL_ID) close(STOCK_ANALYSIS_PANEL_ID);
            else open(STOCK_ANALYSIS_PANEL_ID);
        };
        window.addEventListener(TOGGLE_NOVEL_STUDIO_EVENT, toggleStudio);
        window.addEventListener(TOGGLE_STOCK_ANALYSIS_EVENT, toggleStockAnalysis);
        return () => {
            window.removeEventListener(TOGGLE_NOVEL_STUDIO_EVENT, toggleStudio);
            window.removeEventListener(TOGGLE_STOCK_ANALYSIS_EVENT, toggleStockAnalysis);
        };
    }, [activePanel, open, close]);
    let workspace;
    if (activePanel === NOVEL_STUDIO_PANEL_ID) {
        workspace = <NovelStudio onClose={() => close(NOVEL_STUDIO_PANEL_ID, {skipLeaveConfirmation: true})}/>;
    } else if (activePanel === STOCK_ANALYSIS_PANEL_ID) {
        workspace = <StockAnalysis onClose={() => close(STOCK_ANALYSIS_PANEL_ID)}/>;
    }
    return <WorkspaceHost workspace={workspace}>{children}</WorkspaceHost>;
}
