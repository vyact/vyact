import {useTranslation} from 'react-i18next';
import {useEffect, useState, useCallback} from 'react';
import {CheckCircle, AlertCircle, AlertTriangle, Info, X} from 'lucide-react';
import './ToastNotifications.css';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface ToastItem {
    id: string;
    type: ToastType;
    title: string;
    message?: string;
    duration?: number; // ms, 0 = no auto-close
    hideIcon?: boolean;
}

const ICON_MAP = {
    success: CheckCircle,
    error: AlertCircle,
    warning: AlertTriangle,
    info: Info,
};

const DEFAULT_DURATION: Record<ToastType, number> = {
    success: 3000,
    error: 5000,
    warning: 4000,
    info: 3500,
};

// ── Global event bus ────────────────────────────────────────────────
type ToastListener = (toast: ToastItem) => void;
const listeners = new Set<ToastListener>();
const dismissListeners = new Set<(id: string) => void>();

let idCounter = 0;

export const toast = {
    show(type: ToastType, title: string, message?: string, duration?: number, hideIcon = false) {
        const item: ToastItem = {
            id: `toast-${++idCounter}-${Date.now()}`,
            type,
            title,
            message,
            duration: duration ?? DEFAULT_DURATION[type],
            hideIcon,
        };
        listeners.forEach(fn => fn(item));
        return item.id;
    },
    success(title: string, message?: string, duration?: number, hideIcon = false) { return this.show('success', title, message, duration, hideIcon); },
    error(title: string, message?: string, duration?: number, hideIcon = false) { return this.show('error', title, message, duration, hideIcon); },
    warning(title: string, message?: string, duration?: number, hideIcon = false) { return this.show('warning', title, message, duration, hideIcon); },
    info(title: string, message?: string, duration?: number, hideIcon = false) { return this.show('info', title, message, duration, hideIcon); },
    dismiss(id: string) { dismissListeners.forEach(fn => fn(id)); },
};

// ── Component ───────────────────────────────────────────────────────
export default function ToastContainer() {
    const [items, setItems] = useState<ToastItem[]>([]);
    const [exiting, setExiting] = useState<Set<string>>(new Set());

    useEffect(() => {
        const handler: ToastListener = item => setItems(prev => [...prev, item]);
        listeners.add(handler);
        return () => { listeners.delete(handler); };
    }, []);

    const dismiss = useCallback((id: string) => {
        setExiting(prev => new Set(prev).add(id));
        setTimeout(() => {
            setItems(prev => prev.filter(t => t.id !== id));
            setExiting(prev => { const next = new Set(prev); next.delete(id); return next; });
        }, 250);
    }, []);

    useEffect(() => {
        dismissListeners.add(dismiss);
        return () => { dismissListeners.delete(dismiss); };
    }, [dismiss]);

    return <div className="toast-container">
        {items.map(item => (
            <ToastItemView key={item.id} item={item} exiting={exiting.has(item.id)} onDismiss={dismiss}/>
        ))}
    </div>;
}

function ToastItemView({item, exiting: isExiting, onDismiss}: {
    item: ToastItem;
    exiting: boolean;
    onDismiss: (id: string) => void;
}) {
    const {t} = useTranslation('common');
    const Icon = ICON_MAP[item.type];
    const duration = item.duration ?? DEFAULT_DURATION[item.type];

    useEffect(() => {
        if (!duration) return;
        const timer = window.setTimeout(() => onDismiss(item.id), duration);
        return () => window.clearTimeout(timer);
    }, [duration, item.id, onDismiss]);

    return <div className={`toast-item toast-item--${item.type}${item.hideIcon ? ' toast-item--without-icon' : ''}${isExiting ? ' toast-exit' : ''}`}>
        {!item.hideIcon && <div className="toast-icon"><Icon size={18}/></div>}
        <div className="toast-body">
            <strong>{item.title}</strong>
            {item.message && <span>{item.message}</span>}
        </div>
        <button aria-label={t('close')} className="toast-close" onClick={() => onDismiss(item.id)}><X size={14}/></button>
        {duration > 0 && <div className="toast-progress" style={{animationDuration: `${duration}ms`}}/>}
    </div>;
}
