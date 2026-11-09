import {useState, type CSSProperties, type ComponentProps} from 'react';
import {ChevronLeft, ChevronRight} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import PanelResizer from '../common/PanelResizer/PanelResizer';
import StockDiscussionSidebar from './StockDiscussionSidebar';

const STORAGE_KEY = 'vyact:stock-discussion:layout';
const DEFAULT_WIDTH = 340;
const MIN_WIDTH = 280;
const MAX_WIDTH = 720;
const MIN_CONTENT_WIDTH = 320;
function readLayout(): {width: number; collapsed: boolean} {
    try {
        const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
        return {width: Number.isFinite(saved.width) ? Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, saved.width)) : DEFAULT_WIDTH,
            collapsed: saved.collapsed === true};
    } catch {return {width: DEFAULT_WIDTH, collapsed: false};}
}

export default function StockDiscussionPanel(props: ComponentProps<typeof StockDiscussionSidebar>) {
    const {t} = useTranslation('main');
    const [layout, setLayout] = useState(readLayout);
    const updateLayout = (next: typeof layout) => {
        setLayout(next);
        try {localStorage.setItem(STORAGE_KEY, JSON.stringify(next));} catch { /* Optional layout preference. */ }
    };
    return <div className={`stock-discussion-container${layout.collapsed ? ' is-collapsed' : ''}`}
        style={{'--stock-discussion-width': `${layout.width}px`} as CSSProperties}>
        {!layout.collapsed && <PanelResizer className="stock-discussion-resizer" onWidthChange={width => updateLayout({...layout, width})}
            getWidth={(event, resizer) => {
                const bounds = resizer.closest('.stock-analysis-inner')!.getBoundingClientRect();
                const maximum = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, bounds.width - MIN_CONTENT_WIDTH));
                return Math.max(MIN_WIDTH, Math.min(maximum, bounds.right - event.clientX));
            }} onReset={() => updateLayout({...layout, width: DEFAULT_WIDTH})}/>}
        <button type="button" className="stock-discussion-toggle" aria-expanded={!layout.collapsed}
            aria-label={t(`stockAnalysis.discussion.${layout.collapsed ? 'expand' : 'collapse'}`)}
            onClick={() => updateLayout({...layout, collapsed: !layout.collapsed})}>
            {layout.collapsed ? <ChevronLeft size={17} aria-hidden="true"/> : <ChevronRight size={17} aria-hidden="true"/>}
        </button>
        <div className="stock-discussion-body" inert={layout.collapsed} aria-hidden={layout.collapsed}>
            <StockDiscussionSidebar {...props}/>
        </div>
    </div>;
}
