import {useEffect, type ReactNode} from 'react';
import {EXIT_NOVEL_STUDIO_EVENT, TOGGLE_NOVEL_STUDIO_EVENT} from '../NovelStudio/workspaceEvents';
import {usePanelManager} from '../../contexts/PanelManagerContext';
import WorkspaceHost from '../common/WorkspaceLayout/WorkspaceHost';
import NovelStudio from '../NovelStudio/NovelStudio';
import {NOVEL_STUDIO_PANEL_ID} from '../NovelStudio/storyStorage';

export default function MainWorkspace({children}: {children: ReactNode}) {
    const panels = usePanelManager();
    useEffect(() => {
        const toggleStudio = () => {
            if (panels.activePanel === NOVEL_STUDIO_PANEL_ID) {
                window.dispatchEvent(new Event(EXIT_NOVEL_STUDIO_EVENT));
            } else {
                panels.open(NOVEL_STUDIO_PANEL_ID);
            }
        };
        window.addEventListener(TOGGLE_NOVEL_STUDIO_EVENT, toggleStudio);
        return () => window.removeEventListener(TOGGLE_NOVEL_STUDIO_EVENT, toggleStudio);
    }, [panels.activePanel, panels.open]);
    return <WorkspaceHost workspace={panels.activePanel === NOVEL_STUDIO_PANEL_ID
        ? <NovelStudio onClose={() => panels.close(NOVEL_STUDIO_PANEL_ID)}/> : undefined}>{children}</WorkspaceHost>;
}
