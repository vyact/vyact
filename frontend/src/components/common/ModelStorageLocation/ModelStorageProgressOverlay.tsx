import {useLayoutEffect, useRef} from 'react';
import {createPortal} from 'react-dom';
import {LoaderCircle} from 'lucide-react';
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
    const phase = t(`modelStorage.${status.phase}`, {defaultValue: t('modelStorage.preparing')});
    return createPortal(<div className="model-storage-blocker">
        <div className="model-storage-blocker-panel" ref={panel} tabIndex={-1} role="status" aria-live="polite" aria-atomic="true">
            <LoaderCircle className="model-storage-spinner" size={26} aria-hidden="true"/>
            <strong>{phase}</strong>
            <progress max={1} value={progress} aria-label={phase}/>
            <span>{new Intl.NumberFormat(i18n.language, {style: 'percent', maximumFractionDigits: 0}).format(progress)}</span>
            <span>{formatModelBytes(status.copied_bytes)} / {formatModelBytes(status.total_bytes)}</span>
            {status.current_file && <span className="model-storage-path">{status.current_file}</span>}
        </div>
    </div>, surface);
}
