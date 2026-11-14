import {useEffect, useRef, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {Copy, Download, RotateCcw, StepForward} from 'lucide-react';
import type {IChartApi} from 'lightweight-charts';
import {Tooltip} from '../common/Tooltip/Tooltip';

const LATEST_SCROLL_DURATION_MS = 180;

async function chartImage(chart: IChartApi, title: string): Promise<Blob> {
    const source = chart.takeScreenshot(true, false);
    const canvas = document.createElement('canvas');
    const headerHeight = 48;
    canvas.width = source.width;
    canvas.height = source.height + headerHeight;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('canvas_unavailable');
    const style = getComputedStyle(chart.chartElement());
    context.fillStyle = style.getPropertyValue('--surface').trim() || '#171717';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = style.getPropertyValue('--text').trim() || '#ffffff';
    context.font = '600 16px sans-serif';
    context.fillText(title, 16, 30, Math.max(0, canvas.width - 32));
    context.drawImage(source, 0, headerHeight);
    return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('capture_failed')), 'image/png'));
}

export default function ChartActions({chart, symbol, name, onReset}: {chart: IChartApi | null; symbol: string; name: string; onReset: () => void}) {
    const {t} = useTranslation('main');
    const tr = (key: string) => t(`stockAnalysis.chartActions.${key}`);
    const scrollFrame = useRef<number | null>(null);
    const cancelScroll = () => {
        if (scrollFrame.current !== null) cancelAnimationFrame(scrollFrame.current);
        scrollFrame.current = null;
    };
    useEffect(() => {
        const element = chart?.chartElement();
        element?.addEventListener('pointerdown', cancelScroll);
        element?.addEventListener('wheel', cancelScroll, {passive: true});
        return () => {
            cancelScroll();
            element?.removeEventListener('pointerdown', cancelScroll);
            element?.removeEventListener('wheel', cancelScroll);
        };
    }, [chart]);
    const goToLatest = () => {
        if (!chart) return;
        cancelScroll();
        const scale = chart.timeScale();
        const from = scale.scrollPosition();
        const started = performance.now();
        const animate = (now: number) => {
            const progress = Math.min(1, (now - started) / LATEST_SCROLL_DURATION_MS);
            scale.scrollToPosition(from * (1 - progress) ** 3, false);
            scrollFrame.current = progress < 1 ? requestAnimationFrame(animate) : null;
        };
        scrollFrame.current = requestAnimationFrame(animate);
    };
    const [busy, setBusy] = useState(false);
    const [status, setStatus] = useState<'copied' | 'saved' | 'failed' | null>(null);
    const exportImage = async (copy: boolean) => {
        if (!chart || busy) return;
        setBusy(true); setStatus(null);
        try {
            // Begin clipboard.write in the click event to preserve browser user activation.
            if (copy && !window.ragAPI?.copyChartImage && (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined')) throw new Error('clipboard_unavailable');
            const blob = chartImage(chart, `${name} · ${symbol}`);
            if (copy && window.ragAPI?.copyChartImage) {
                const image = await blob;
                await window.ragAPI.copyChartImage(new Uint8Array(await image.arrayBuffer()));
            } else if (copy) {
                await navigator.clipboard.write([new ClipboardItem({'image/png': blob})]);
            } else {
                const url = URL.createObjectURL(await blob);
                const link = document.createElement('a');
                link.href = url; link.download = `${symbol.replace(/[^a-zA-Z0-9._-]/g, '_')}-chart.png`;
                link.click();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
            }
            setStatus(copy ? 'copied' : 'saved');
        } catch (error) {console.error('Chart image export failed', error); setStatus('failed');}
        finally {setBusy(false);}
    };
    return <div className="stock-chart-actions">
        <div role="group" aria-label={tr('navigation')}>
            <Tooltip hoverOnly content={tr('latest')}><button type="button" className="modal-action-cancel" disabled={!chart} aria-label={tr('latest')}
                onClick={goToLatest}><StepForward size={15} aria-hidden="true"/></button></Tooltip>
            <Tooltip hoverOnly content={tr('reset')}><button type="button" className="modal-action-cancel" disabled={!chart} aria-label={tr('reset')}
                onClick={() => {cancelScroll(); onReset();}}><RotateCcw size={15} aria-hidden="true"/></button></Tooltip>
        </div>
        <div role="group" aria-label={tr('export')}>
            <Tooltip hoverOnly content={tr('save')}><button type="button" className="modal-action-cancel" disabled={!chart || busy} aria-label={tr('save')}
                onClick={() => {void exportImage(false);}}><Download size={15} aria-hidden="true"/></button></Tooltip>
            <Tooltip hoverOnly content={tr('copy')}><button type="button" className="modal-action-cancel" disabled={!chart || busy} aria-label={tr('copy')}
                onClick={() => {void exportImage(true);}}><Copy size={15} aria-hidden="true"/></button></Tooltip>
        </div>
        {status && <span className="stock-chart-action-status" role={status === 'failed' ? 'alert' : 'status'}>{tr(status)}</span>}
    </div>;
}
