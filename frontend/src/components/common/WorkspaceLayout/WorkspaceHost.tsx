import type {ReactNode} from 'react';
import './WorkspaceHost.css';

/** Keep the default view mounted so chat drafts and ongoing work survive workspace navigation. */
export default function WorkspaceHost({workspace, children}: {workspace?: ReactNode; children: ReactNode}) {
    return <><div className="workspace-host-default" hidden={Boolean(workspace)}>{children}</div>{workspace}</>;
}
