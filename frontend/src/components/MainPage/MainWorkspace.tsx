import type {ReactNode} from 'react';
import {usePanelManager} from '../../contexts/PanelManagerContext';
import WorkspaceHost from '../common/WorkspaceLayout/WorkspaceHost';
import NovelStudio from '../NovelStudio/NovelStudio';
import {NOVEL_STUDIO_PANEL_ID} from '../NovelStudio/storyStorage';

export default function MainWorkspace({children}: {children: ReactNode}) {
    const panels = usePanelManager();
    return <WorkspaceHost workspace={panels.activePanel === NOVEL_STUDIO_PANEL_ID
        ? <NovelStudio onClose={() => panels.close(NOVEL_STUDIO_PANEL_ID)}/> : undefined}>{children}</WorkspaceHost>;
}
