import TextLogEntries from './TextLogEntries';
import RequestLogEntries from './RequestLogEntries';
import ToggleSwitch from '../common/ToggleSwitch/ToggleSwitch';
import {useEffect, useRef, useState, useLayoutEffect, type CSSProperties} from 'react';
import {useTranslation} from 'react-i18next';
import {X, ArrowDown} from 'lucide-react';
import {applyLogUpdates, subscribeLogs, type LogFile, type LogKind} from '../../services/logViewer';
import {api, LLM_LOGGING_CHANGED} from '../../services/api';
import {usePanelManager} from '../../contexts/PanelManagerContext';
import './LogPanel.css';


export default function LogPanel({model, style}: {model: string; style: CSSProperties}) {
    const {t} = useTranslation('main');
    const panels = usePanelManager();
    const [kind, setKind] = useState<LogKind>('app');
    const [files, setFiles] = useState<LogFile[]>([]);
    const [enabled, setEnabled] = useState(false);
    const [ready, setReady] = useState(false);
    const [saving, setSaving] = useState(false);
    const [failed, setFailed] = useState(false);
    const [saveFailed, setSaveFailed] = useState(false);
    const contentRef = useRef<HTMLDivElement>(null);
    const followTail = useRef(true);
    const latestFiles = useRef<LogFile[]>([]);
    const [paused, setPaused] = useState(false);

    useEffect(() => {
        let active = true;
        let changed = false;
        const sync = (event: Event) => {
            changed = true;
            setEnabled((event as CustomEvent<boolean>).detail);
            setReady(true);
        };
        window.addEventListener(LLM_LOGGING_CHANGED, sync);
        void api.getLlmLogging().then(result => {
            if (active && !changed) {setEnabled(result.llm_logging); setReady(true);}
        }).catch(() => {if (active) setSaveFailed(true);});
        return () => {active = false; window.removeEventListener(LLM_LOGGING_CHANGED, sync);};
    }, []);

    useEffect(() => {
        latestFiles.current = [];
        setFiles([]);
        setFailed(false);
        followTail.current = true;
        setPaused(false);
        return subscribeLogs(kind, model, updates => {
            latestFiles.current = applyLogUpdates(latestFiles.current, updates);
            if (followTail.current) setFiles(latestFiles.current);
        }, setFailed);
    }, [kind, model]);

    useLayoutEffect(() => {
        if (followTail.current && contentRef.current) contentRef.current.scrollTop = contentRef.current.scrollHeight;
    }, [files]);

    const resumeTail = () => {
        followTail.current = true;
        setPaused(false);
        setFiles([...latestFiles.current]);
    };

    const toggleLogging = async () => {
        setSaving(true);
        setSaveFailed(false);
        try {const result = await api.setLlmLogging(!enabled); setEnabled(result.llm_logging);}
        catch {setSaveFailed(true);}
        finally {setSaving(false);}
    };

    return <aside className="log-panel" style={style} aria-label={t('logViewer.title')}>
        <div className="log-panel-header">
            <span>{t('logViewer.title')}</span>
            <button type="button" className="icon-btn" aria-label={t('documentPreview.close')} onClick={() => panels.close('logs')}><X size={18}/></button>
        </div>
        <div className="log-panel-tabs" role="tablist" aria-label={t('logViewer.title')}>
            {(['app', 'model', 'llm'] as const).map(tab => <button key={tab} type="button" role="tab" id={`log-tab-${tab}`} aria-controls="log-content" aria-selected={kind === tab} className={kind === tab ? 'active' : ''} onClick={() => setKind(tab)}>{t(`logViewer.${tab}`)}</button>)}
        </div>
        {kind === 'llm' && <div className="log-panel-toolbar">
            <div className="log-panel-toggle">
                <span>{t('settings:general.llmLog')}</span>
                <ToggleSwitch label={t('settings:general.llmLog')} checked={enabled} disabled={!ready || saving} onChange={() => void toggleLogging()}/>
            </div>
        </div>}
        {(failed || saveFailed) && <div className="log-panel-status" role="alert">{t('logViewer.error')}</div>}
        <div id="log-content" role="tabpanel" aria-labelledby={`log-tab-${kind}`} className="log-panel-content" ref={contentRef} onScroll={event => {
            const element = event.currentTarget;
            const atBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 24;
            if (atBottom && !followTail.current) resumeTail();
            else if (!atBottom) {followTail.current = false; setPaused(true);}
        }}>
            {kind === 'model' && files.length === 0 && <pre>{t('logViewer.empty')}</pre>}
            {files.map(file => <section key={file.path}>
                <div className="log-panel-path">{file.path}</div>
                {kind === 'llm' && file.content
                    ? <RequestLogEntries content={file.content} onInspect={() => {followTail.current = false; setPaused(true);}}/>
                    : file.content ? <TextLogEntries content={file.content}/> : <pre>{t('logViewer.empty')}</pre>}
            </section>)}
        </div>
        {paused && <button type="button" className="log-panel-resume" onClick={resumeTail}><ArrowDown size={14}/>{t('logViewer.latest')}</button>}
    </aside>;
}
