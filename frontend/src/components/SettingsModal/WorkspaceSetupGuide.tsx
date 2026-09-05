import {useId, useState, type ReactNode} from 'react';

export default function WorkspaceSetupGuide({title, children}: {title: string; children: ReactNode}) {
    const [open, setOpen] = useState(false);
    const contentId = useId();
    return <div className="gw-guide">
        <button type="button" className="gw-guide-toggle" aria-expanded={open} aria-controls={contentId} onClick={() => setOpen(value => !value)}>
            <span className={`gw-guide-arrow ${open ? 'open' : ''}`} aria-hidden="true">▶</span>
            <span>{title}</span>
        </button>
        {open && <div id={contentId} className="gw-guide-body">{children}</div>}
    </div>;
}
