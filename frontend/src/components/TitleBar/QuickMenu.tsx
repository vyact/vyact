import {NOVEL_STUDIO_PANEL_ID} from '../NovelStudio/storyStorage';
import {RETURN_CALCULATOR_PANEL_ID, TRAVEL_CALCULATOR_PANEL_ID} from '../QuickCalculators/QuickCalculators';
import {useEffect, useRef, useState} from 'react';
import {Feather, CalendarDays, Percent, ChartNoAxesCombined, LayoutGrid, PiggyBank} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import {usePanelManager} from '../../contexts/PanelManagerContext';
import {WEALTH_LAB_PANEL_ID} from '../CalcStudio/chatExport';
import './QuickMenu.css';
import {api} from '../../services/api';
import {HOUSEHOLD_LEDGER_PANEL_ID, VYVOW_TOKEN_CHANGED} from '../../services/vyvow';

export default function QuickMenu({onOpen}: {onOpen: () => void}) {
    const {t} = useTranslation('main');
    const [open, setOpen] = useState(false);
    const panels = usePanelManager();
    const [hasVyvowToken, setHasVyvowToken] = useState(false);
    useEffect(() => {
        let active = true;
        let version = 0;
        const refresh = () => {
            const current = ++version;
            api.getVyvowTokenStatus().then(status => {
                if (active && current === version) {
                    setHasVyvowToken(status.has_token);
                    if (!status.has_token) panels.close(HOUSEHOLD_LEDGER_PANEL_ID);
                }
            }).catch(() => {
                if (active && current === version) {
                    setHasVyvowToken(false);
                    panels.close(HOUSEHOLD_LEDGER_PANEL_ID);
                }
            });
        };
        refresh();
        window.addEventListener(VYVOW_TOKEN_CHANGED, refresh);
        window.addEventListener('focus', refresh);
        return () => {
            active = false;
            window.removeEventListener(VYVOW_TOKEN_CHANGED, refresh);
            window.removeEventListener('focus', refresh);
        };
    }, [open, panels.close]);
    const rootRef = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const itemRef = useRef<HTMLButtonElement>(null);
    useEffect(() => {
        if (!open) return;
        itemRef.current?.focus();
        const handlePointer = (event: PointerEvent) => {
            if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
        };
        const handleKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {event.stopImmediatePropagation(); setOpen(false); triggerRef.current?.focus();}
        };
        document.addEventListener('pointerdown', handlePointer);
        window.addEventListener('keydown', handleKey, true);
        return () => {
            document.removeEventListener('pointerdown', handlePointer);
            window.removeEventListener('keydown', handleKey, true);
        };
    }, [open]);
    return <div className="quick-menu" ref={rootRef} onBlur={event => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
    }}>
        <button ref={triggerRef} className="titlebar-btn" aria-label={t('quickMenu.title')}
            aria-expanded={open} aria-controls={open ? 'titlebar-quick-menu' : undefined} onClick={() => {if (!open) onOpen(); setOpen(!open);}}
            onKeyDown={event => {if (event.key === 'ArrowDown') {event.preventDefault(); onOpen(); setOpen(true);}}}>
            <LayoutGrid size={15}/>
        </button>
        {open && <div className="quick-menu-popover" id="titlebar-quick-menu">
            <button ref={itemRef} className="quick-menu-item" onClick={() => {setOpen(false); triggerRef.current?.focus(); panels.open(WEALTH_LAB_PANEL_ID);}}>
                <ChartNoAxesCombined size={18} aria-hidden="true"/><span>{t('calcStudio.title')}<small>{t('quickMenu.calculatorDescription')}</small></span>
            </button>
            {[
                {id: RETURN_CALCULATOR_PANEL_ID, icon: Percent, title: 'quickCalculators.returnTitle', description: 'quickCalculators.returnDescription'},
                ...(hasVyvowToken ? [{id: HOUSEHOLD_LEDGER_PANEL_ID, icon: PiggyBank, title: 'vyvowLedger.title', description: 'vyvowLedger.description'}] : []),
                {id: TRAVEL_CALCULATOR_PANEL_ID, icon: CalendarDays, title: 'quickCalculators.travelTitle', description: 'quickCalculators.travelDescription'},
                {id: NOVEL_STUDIO_PANEL_ID, icon: Feather, title: 'novelStudio.title', description: 'novelStudio.subtitle'},
            ].map(({id, icon: Icon, title, description}) => <button key={id} className="quick-menu-item" onClick={() => {
                setOpen(false); triggerRef.current?.focus(); panels.open(id);
            }}><Icon size={20} aria-hidden="true"/><span>{t(title)}<small>{t(description)}</small></span></button>)}
        </div>}
    </div>;
}
