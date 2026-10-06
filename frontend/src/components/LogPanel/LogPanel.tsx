import TextLogEntries from './TextLogEntries';
import RequestLogEntries from './RequestLogEntries';
import CustomSelect from '../CustomSelect/CustomSelect';
import ToggleSwitch from '../common/ToggleSwitch/ToggleSwitch';
import {useEffect, useRef, useState, useLayoutEffect, type CSSProperties} from 'react';
import {useTranslation} from 'react-i18next';
import {X, ArrowDown, FileText} from 'lucide-react';
import {applyLogUpdates, subscribeLogs, type AvailableLogFile, type LogFile, type LogKind} from '../../services/logViewer';
import {api, LLM_LOGGING_CHANGED} from '../../services/api';
import {usePanelManager} from '../../contexts/PanelManagerContext';
import './LogPanel.css';


export default function LogPanel({model, style}: {model: string; style: CSSProperties}) {
    const {t} = useTranslation('main');
    const panels = usePanelManager();
    const [kind, setKind] = useState<LogKind>('app');
    const [files, setFiles] = useState<LogFile[]>([]);
    const [available, setAvailable] = useState<AvailableLogFile[]>([]);
    const [selectedFilenames, setSelectedFilenames] = useState<Partial<Record<LogKind, string>>>({});
    const filename = selectedFilenames[kind] || '';
    const selectFile = (value: string) => setSelectedFilenames(previous => ({...previous, [kind]: value}));
    const [selectedPath, setSelectedPath] = useState('');
    const [enabled, setEnabled] = useState(false);
    const [ready, setReady] = useState(false);
    const [saving, setSaving] = useState(false);
    const [failed, setFailed] = useState(false);
    const [saveFailed, setSaveFailed] = useState(false);
    const contentRef = useRef<HTMLDivElement>(null);
    const followTail = useRef(true);
    const latestFiles = useRef<LogFile[]>([]);
    const [paused, setPaused] = useState(false);
    const hasLogs = files.some(file => file.content.length > 0);

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
        setAvailable([]);
        setSelectedPath('');
        setFailed(false);
        followTail.current = true;
        setPaused(false);
        return subscribeLogs(kind, model, updates => {
            latestFiles.current = applyLogUpdates(latestFiles.current, updates);
            if (followTail.current) setFiles(latestFiles.current);
        }, setFailed, filename, snapshot => {
            setAvailable(snapshot.available);
            setSelectedPath(snapshot.selected);
            if (snapshot.replace) {
                followTail.current = true;
                setPaused(false);
                latestFiles.current = [];
                setFiles([]);
            }
        });
    }, [kind, model, filename]);

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
            {(['app', 'model', 'decision', 'llm'] as const).map(tab => <button key={tab} type="button" role="tab" id={`log-tab-${tab}`} aria-controls="log-content" aria-selected={kind === tab} className={kind === tab ? 'active' : ''} onClick={() => setKind(tab)}>{tab === 'llm' ? t('settings:general.llmLog') : t(`logViewer.${tab}`)}</button>)}
        </div>
        {(available.length > 0 || kind === 'llm') && <div className="log-panel-toolbar">
            {available.length > 0 && <CustomSelect className="log-panel-file-select" ariaLabel={t('logViewer.file')}
                options={available.map(file => ({value: file.filename, label: file.filename}))}
                value={available.find(file => file.path === selectedPath)?.filename || ''}
                onChange={selectFile} portal/>}
            {kind === 'llm' && <div className="log-panel-toggle">
                <span>{t('logViewer.save')}</span>
                <ToggleSwitch label={t('logViewer.save')} checked={enabled} disabled={!ready || saving} onChange={() => void toggleLogging()}/>
            </div>}
        </div>}
        {(failed || saveFailed) && <div className="log-panel-status" role="alert">{t('logViewer.error')}</div>}
        <div id="log-content" role="tabpanel" aria-labelledby={`log-tab-${kind}`} className={`log-panel-content${hasLogs ? '' : ' log-panel-content-empty'}`} ref={contentRef} onScroll={event => {
            const element = event.currentTarget;
            const atBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 24;
            if (atBottom && !followTail.current) resumeTail();
            else if (!atBottom) {followTail.current = false; setPaused(true);}
        }}>
            {files.map(file => <section key={file.path}>
                {kind === 'llm' && file.content
                    ? <RequestLogEntries content={file.content} onInspect={() => {followTail.current = false; setPaused(true);}}/>
                    : file.content ? <TextLogEntries content={file.content}/> : null}
            </section>)}
            {!hasLogs && <div className="log-panel-empty-state"><FileText size={28} strokeWidth={1.5} aria-hidden="true"/><span>{t('logViewer.empty')}</span></div>}
        </div>
        {paused && <button type="button" className="log-panel-resume" onClick={resumeTail}><ArrowDown size={14}/>{t('logViewer.latest')}</button>}
    </aside>;
}
