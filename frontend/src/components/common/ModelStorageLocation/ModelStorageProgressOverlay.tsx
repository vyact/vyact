import {useLayoutEffect, useRef} from 'react';
import {createPortal} from 'react-dom';
import {File, LoaderCircle} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import type {ModelStorageStatus} from '../../../services/modelStorage';
import {formatModelBytes} from '../../../utils/vyactModelDisplay';

interface Props {
    surface: HTMLElement;
    status: ModelStorageStatus;
}

export default function ModelStorageProgressOverlay({surface, status}: Props) {
    const {t, i18n} = useTranslation('common');
    const panel = useRef<HTMLDivElement>(null);
    useLayoutEffect(() => {
        const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const controls = Array.from(surface.children).filter((child): child is HTMLElement => child instanceof HTMLElement && !child.classList.contains('model-storage-blocker'));
        const previousInert = controls.map(child => child.inert);
        controls.forEach(child => {child.inert = true;});
        panel.current?.focus();
        return () => {
            controls.forEach((child, index) => {child.inert = previousInert[index];});
            if (previousFocus?.isConnected) previousFocus.focus();
        };
    }, [surface]);
    const progress = status.total_bytes ? Math.min(1, status.copied_bytes / status.total_bytes) : 0;
    const zeroBytes = new Intl.NumberFormat(i18n.resolvedLanguage || i18n.language || 'en', {
        style: 'unit', unit: 'byte', unitDisplay: 'narrow',
    }).format(0);
    const fileName = status.current_file?.split(/[\\/]/).pop();
    const phase = t(`modelStorage.${status.phase}`, {defaultValue: t('modelStorage.preparing')});
    return createPortal(<div className="model-storage-blocker">
        <div className="model-storage-blocker-panel" ref={panel} tabIndex={-1} role="status" aria-live="polite" aria-atomic="true">
            <div className="model-storage-progress-heading">
                <span className="model-storage-progress-icon"><LoaderCircle className="model-storage-spinner" size={20} aria-hidden="true"/></span>
                <strong>{phase}</strong>
            </div>
            <div className="model-storage-progress-summary">
                <progress max={1} value={progress} aria-label={phase}/>
                <div className="model-storage-progress-values">
                    <span>{status.copied_bytes > 0 ? formatModelBytes(status.copied_bytes) : zeroBytes} / {status.total_bytes > 0 ? formatModelBytes(status.total_bytes) : zeroBytes}</span>
                    <strong>{new Intl.NumberFormat(i18n.language, {style: 'percent', maximumFractionDigits: 0}).format(progress)}</strong>
                </div>
            </div>
            {fileName && <div className="model-storage-current-file"><File size={16} aria-hidden="true"/><span>{fileName}</span></div>}
        </div>
    </div>, surface);
}
