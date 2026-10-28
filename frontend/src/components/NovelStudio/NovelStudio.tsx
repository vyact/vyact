import FinalSettingsLibrary from './FinalSettingsLibrary';
import CustomSelect from '../CustomSelect/CustomSelect';
import {Tooltip} from '../common/Tooltip/Tooltip';
import {getSettingsContext} from './settingsContext';
import ToggleSwitch from '../common/ToggleSwitch/ToggleSwitch';
import {buildWritingInstruction} from './writingInstruction';
import {downloadNovel, type NovelExportFormat} from './storyExport';
import {useEffect, useRef, useState} from 'react';
import {Plus, Feather, Sparkles, LoaderCircle, ArrowRight, ArrowLeft, Undo2, MoreHorizontal, Download, Info} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import CandidateReader from './CandidateReader';
import ProposalReader from './ProposalReader';
import SettingsPlanner from './SettingsPlanner';
import StoryLibrary from './StoryLibrary';
import WorkspaceLayout from '../common/WorkspaceLayout/WorkspaceLayout';
import ActionMenu from '../common/ActionMenu/ActionMenu';
import useStoryLibrary from './useStoryLibrary';
import {flushStorySaves} from './storyRepository';
import {createChapter, createStory, type Story, type SettingCategory, SETTING_CATEGORIES} from './storyStorage';
import '../common/ModalOverlay/ModalActions.css';
import './NovelStudio.css';

export default function NovelStudio({onClose}: {onClose: () => void}) {
    const {t, i18n} = useTranslation('main');
    const tr = (key: string) => t(`novelStudio.${key}`);
    const {stories, setStories, loading, loadFailed, saveStatus, reload} = useStoryLibrary(tr('untitled'), t('novelStudio.chapterNumber', {number: 1}));
    const [storyId, setStoryId] = useState('');
    const [chapterId, setChapterId] = useState('');
    const [tab, setTab] = useState<'text' | 'bible'>('text');
    const [chapterMenuId, setChapterMenuId] = useState<string | null>(null);
    const instructionRef = useRef<HTMLTextAreaElement>(null);
    const [instruction, setInstruction] = useState('');
    const [includeTaskGuidance, setIncludeTaskGuidance] = useState(true);
    const [taskGuidanceEdits, setTaskGuidanceEdits] = useState<Record<string, string>>({});
    const [revisionRequest, setRevisionRequest] = useState('');
    const [proposal, setProposal] = useState('');
    const [responseVisible, setResponseVisible] = useState(false);
    const [selectedAction, setSelectedAction] = useState('customRequest');
    const [contextExclusions, setContextExclusions] = useState<Record<string, SettingCategory[]>>({});
    const [proposalAction, setProposalAction] = useState('customRequest');
    const [proposalQuery, setProposalQuery] = useState({instruction: '', authorDirection: ''});
    const [viewingCandidateId, setViewingCandidateId] = useState<string | null>(null);
    const [candidateTitle, setCandidateTitle] = useState('');
    const [viewingFinalId, setViewingFinalId] = useState<string | null>(null);
    const [proposalTarget, setProposalTarget] = useState<'text' | 'bible'>('text');
    const [exporting, setExporting] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [undo, setUndo] = useState<{chapterId: string; target: 'text' | 'bible'; text: string} | null>(null);
    const controller = useRef<AbortController | null>(null);
    const story = stories.find(item => item.id === storyId) ?? stories[0];
    const finalSettings = story?.finalSettings ?? [];
    const activeFinal = finalSettings.find(item => item.id === story?.activeFinalSettingId);
    const viewingFinal = finalSettings.find(item => item.id === viewingFinalId);
    const viewingCandidate = story?.settingsCandidates?.find(candidate => candidate.id === viewingCandidateId);
    const contextAction = responseVisible ? proposalAction : selectedAction;
    const contextKey = `${story?.id}:${contextAction}`;
    const excludedContextCategories = contextExclusions[contextKey] ?? [];
    const availableContext = getSettingsContext(story?.settingsCandidates ?? [], contextAction);
    const selectedSettings = getSettingsContext(story?.settingsCandidates ?? [], contextAction, excludedContextCategories);
    const selectedSettingCategories = SETTING_CATEGORIES.filter(category => availableContext.some(candidate => candidate.category === category));
    const chapter = story?.chapters.find(item => item.id === chapterId) ?? story?.chapters[0];
    useEffect(() => () => controller.current?.abort(), []);
    const updateStory = (patch: Partial<Story>) => setStories(items => items.map(item => item.id === story?.id ? {...item, ...patch} : item));
    const updateChapter = (patch: Partial<NonNullable<typeof chapter>>) => {
        if (story) updateStory({chapters: story.chapters.map(item => item.id === chapter?.id ? {...item, ...patch} : item)});
    };
    const resetAssistant = () => {setViewingFinalId(null);setViewingCandidateId(null);setProposal(''); setResponseVisible(false); setError(''); setUndo(null); setInstruction(''); setSelectedAction('customRequest');};
    const addStory = () => {
        const next = createStory(tr('untitled'), t('novelStudio.chapterNumber', {number: 1}));
        setStories(items => [...items, next]); setStoryId(next.id); setChapterId(next.chapters[0].id); setTab('text'); resetAssistant();
    };
    const generate = async (request: string, revision = false) => {
        if (!story || !chapter || !request.trim() || busy) return;
        const action = revision ? proposalAction : tab === 'bible' && selectedAction !== 'synthesis' && !SETTING_CATEGORIES.includes(selectedAction as SettingCategory) ? 'createDirection' : selectedAction;
        setSelectedAction(action);
        setViewingCandidateId(null); setViewingFinalId(null);
        if (!revision) {
            setProposalQuery({instruction: request, authorDirection: instruction.trim()});
            setProposal(''); setProposalTarget(tab); setProposalAction(action); setCandidateTitle(''); setRevisionRequest('');
        }
        setBusy(true); setError(''); setResponseVisible(true);
        controller.current = new AbortController();
        try {
            const selected = getSettingsContext(story.settingsCandidates ?? [], action, contextExclusions[`${story.id}:${action}`] ?? []).map(({category, title, content}) => ({category, title, content}));
            if (tab === 'bible' && selected.reduce((sum, candidate) => sum + candidate.content.length + candidate.title.length, 0) > 50000) throw new Error('settings-context-limit');
            const position = story.chapters.findIndex(item => item.id === chapter.id);
            const response = await fetch('/api/novel-studio/generate', {method: 'POST', signal: controller.current.signal, headers: {'Content-Type': 'application/json'}, body: JSON.stringify({title: story.title.slice(0, 200), chapter_title: chapter.title.slice(0, 200), bible: activeFinal?.content ?? '', previous: story.chapters.slice(0, position).map(item => `${item.title}\n${item.text}`).join('\n\n').slice(-30000), manuscript: chapter.text.slice(-30000), instruction: request, ...(revision ? {proposal: proposal, original_instruction: proposalQuery.instruction} : {}), target: tab, ...(tab === 'bible' ? {settings_stage: action, selected_settings: selected} : {}), language: i18n.resolvedLanguage || i18n.language})});
            if (!response.ok) throw new Error('Generation failed');
            const data = await response.json();
            if (typeof data.text !== 'string' || !data.text.trim()) throw new Error('Empty generation');
            setProposal(data.text);
            if (revision) {setRevisionRequest(''); setProposalQuery({instruction: request, authorDirection: revisionRequest.trim()});}
            if (typeof data.title === 'string' && data.title.trim()) {
                const generatedTitle = data.title.trim().slice(0, 200);
                setCandidateTitle(generatedTitle);
                if (tab === 'text' && action !== 'review') {
                    setStories(items => items.map(item => item.id === story.id ? {...item, chapters: item.chapters.map(current => current.id === chapter.id ? {...current, title: generatedTitle} : current)} : item));
                }
            }
        } catch (failure) {if (!revision) setResponseVisible(false); if (!(failure instanceof DOMException && failure.name === 'AbortError')) setError(tr(failure instanceof Error && failure.message === 'settings-context-limit' ? 'selectionLimit' : 'generationError'));}
        finally {setBusy(false); controller.current = null;}
    };
    const contextControls = <div className="novel-request-context"><div className="novel-request-context-heading"><p>{t('novelStudio.proposalContext', {count: selectedSettings.length})}</p><Tooltip content={tr('proposalContextHelp')} multiline size="medium" placement="above"><button type="button" className="titlebar-btn" aria-label={tr('proposalContextHelp')}><Info size={14} aria-hidden="true"/></button></Tooltip></div>{selectedSettingCategories.length > 0 && <ul>{selectedSettingCategories.map(category => <li key={category}><span>{tr(category)} · {availableContext.filter(candidate => candidate.category === category).length}</span><ToggleSwitch checked={!excludedContextCategories.includes(category)} disabled={busy} label={t('novelStudio.includeContextCategory', {category: tr(category)})} onChange={included => setContextExclusions(previous => ({...previous, [contextKey]: included ? (previous[contextKey] ?? []).filter(item => item !== category) : [...(previous[contextKey] ?? []), category]}))}/></li>)}</ul>}</div>;
    const exportManuscript = async (selectedStory: Story, format: NovelExportFormat, chapterId?: string) => {
        if (exporting) return;
        setExporting(true); setError('');
        try {await downloadNovel(selectedStory, format, chapterId);}
        catch {setError(tr('exportError'));}
        finally {setExporting(false);}
    };
    const chooseAction = (action: string) => {
        setSelectedAction(action); instructionRef.current?.focus();
    };
    const finishProposalReview = () => {
        setProposal('');
        setResponseVisible(false);
        setInstruction('');
        setRevisionRequest('');
        setCandidateTitle('');
        setProposalQuery({instruction: '', authorDirection: ''});
        setError('');
    };
    const saveFinalSettings = () => {
        if (!story || !proposal.trim()) return;
        if (proposal.length > 20000 || finalSettings.length >= 100) {setError(tr('settingsLimit')); return;}
        const finalSetting = {id: crypto.randomUUID(), title: candidateTitle.trim() || t('novelStudio.finalVersion', {number: finalSettings.length + 1}), content: proposal};
        updateStory({finalSettings: [...finalSettings, finalSetting], activeFinalSettingId: story.activeFinalSettingId ?? finalSetting.id});
        finishProposalReview(); setTab('bible');
    };
    const saveCandidate = () => {
        if (!story || !proposal.trim()) return;
        const candidates = story.settingsCandidates ?? [];
        if (candidates.length >= 100 || proposal.length > 20000) {setError(tr('candidateLimit')); return;}
        updateStory({settingsCandidates: [...candidates, {id: crypto.randomUUID(), category: proposalAction as SettingCategory, title: candidateTitle.trim() || `${tr(proposalAction)} ${candidates.filter(candidate => candidate.category === proposalAction).length + 1}`, content: proposal, selected: true, generationInstruction: proposalQuery.instruction, authorDirection: proposalQuery.authorDirection}]});
        finishProposalReview(); setTab('bible');
    };
    const appendProposal = () => {
        if (!chapter) return;
        setUndo({chapterId: chapter.id, target: 'text', text: chapter.text});
        updateChapter({text: [chapter.text, proposal].filter(Boolean).join('\n\n')});
        setTab('text'); finishProposalReview();

    };
    const taskGuidance = selectedAction === 'customRequest' ? '' : taskGuidanceEdits[selectedAction] ?? tr(`${selectedAction}Prompt`);
    const writingRequest = buildWritingInstruction(includeTaskGuidance ? taskGuidance : '', instruction);
    const header = <>
        <div className="novel-brand"><Feather size={19}/><h1>{tr('title')}</h1></div>
        {story && <input className="novel-story-title" aria-label={tr('storyTitle')} maxLength={200} value={story.title} onChange={event => updateStory({title: event.target.value})}/>}
        <div className="novel-tabs">{(['text', 'bible'] as const).map(key => <button key={key} disabled={busy} aria-pressed={tab === key} onClick={() => {setTab(key); setViewingCandidateId(null); setViewingFinalId(null); setInstruction(''); setSelectedAction(key === 'bible' ? 'createDirection' : 'customRequest');}}>{tr(key)}</button>)}</div>
        <button className="novel-return" onClick={() => {void flushStorySaves().then(onClose).catch(() => {});}}><ArrowLeft size={15}/>{tr('backToChat')}</button>
    </>;
    return <WorkspaceLayout className="novel-studio" label={tr('title')} header={header}
        sidebar={story ? (                <nav className="novel-library" aria-label={tr('library')}><div className="novel-section-heading"><span>{tr('library')}</span><button className="titlebar-btn" disabled={busy || loadFailed} aria-label={tr('newStory')} onClick={addStory}><Plus size={16}/></button></div>
                    <StoryLibrary stories={stories} activeId={story.id} disabled={busy || exporting} onSelect={id => {setStoryId(id); setChapterId(''); setTab('text'); resetAssistant();}}
                        onExport={(selectedStory, format) => {void exportManuscript(selectedStory, format);}}
                        onRename={(id, title) => setStories(items => items.map(item => item.id === id ? {...item, title} : item))}
                        onDelete={id => {
                            const remaining = stories.filter(item => item.id !== id);
                            const next = remaining.length ? remaining : [createStory(tr('untitled'), t('novelStudio.chapterNumber', {number: 1}))];
                            setStories(() => next);
                            if (id === story.id) {setStoryId(next[0].id); setChapterId(''); setTab('text'); resetAssistant();}
                        }}/>
                    <div className="novel-section-heading"><span>{tr('chapters')}</span><button className="titlebar-btn" disabled={busy} aria-label={tr('newChapter')} onClick={() => {const next = createChapter(t('novelStudio.chapterNumber', {number: story.chapters.length + 1})); updateStory({chapters: [...story.chapters, next]}); setChapterId(next.id); setTab('text'); resetAssistant();}}><Plus size={16}/></button></div>
                    {story.chapters.map((item, index) => <div key={item.id} className={`novel-story-row novel-chapter-row${chapter.id === item.id ? ' selected' : ''}`}>
                        <button className={`novel-chapter${chapter.id === item.id ? ' selected' : ''}`} disabled={busy} onClick={() => {setChapterId(item.id); setTab('text'); resetAssistant();}}><span>{String(index + 1).padStart(2, '0')}</span><span>{item.title}</span></button>
                        <ActionMenu disabled={exporting} isOpen={chapterMenuId === item.id} onOpenChange={open => setChapterMenuId(open ? item.id : null)} trigger={<MoreHorizontal size={15}/>} ariaLabel={t('novelStudio.chapterActions', {title: item.title})} triggerClassName="titlebar-btn novel-story-menu" menuClassName="hist-menu-popup">
                            {(['pdf', 'md'] as const).map(format => <button key={format} className="hist-menu-item" onClick={() => {setChapterMenuId(null); void exportManuscript(story, format, item.id);}}><Download size={14}/>{t('novelStudio.downloadFormat', {format: format.toUpperCase()})}</button>)}
                        </ActionMenu>
                    </div>)}

                </nav>) : null}
        inspector={story ? (
                <aside className="novel-assistant"><div className="novel-assistant-heading"><Sparkles size={18}/><h2>{tr('assistant')}</h2></div>{tab === 'bible' && <p className="novel-assistant-description">{tr('settingsWorkflowHelp')}</p>}
                    {responseVisible && (!busy || !!proposal) ? (<div className="novel-response-save"><div className="novel-section-heading">{tr('proposal')}</div><p className="novel-response-save-help">{tr(proposalTarget === 'text' ? 'manuscriptApplyHelp' : proposalAction === 'synthesis' ? 'finalSaveHelp' : 'responseSaveHelp')}</p>{proposalTarget === 'bible' && <div className="novel-response-save-target">{tr(proposalAction)}</div>}
                        {proposalTarget === 'bible' && <input className="novel-candidate-name" aria-label={tr('candidateTitle')} placeholder={tr('candidateTitle')} maxLength={200} value={candidateTitle} onChange={event => setCandidateTitle(event.target.value)}/>}
                        <div className="novel-response-actions"><button className="modal-action-cancel" disabled={busy} onClick={finishProposalReview}>{tr('discardShort')}</button>                        <button className="modal-action-submit" disabled={busy || !proposal.trim()} onClick={() => {if (proposalTarget !== 'bible') appendProposal(); else if (proposalAction !== 'synthesis') saveCandidate(); else saveFinalSettings();}}><Plus size={15}/>{tr('saveShort')}</button></div><div className="novel-revision-controls"><label htmlFor="novel-revision-request">{tr('reviseProposal')}</label><textarea id="novel-revision-request" maxLength={3000} disabled={busy} value={revisionRequest} placeholder={tr('revisionPlaceholder')} onChange={event => setRevisionRequest(event.target.value)}/><p className="novel-revision-context-help">{tr('revisionContextHelp')}</p>{proposalTarget === 'bible' && contextControls}{busy ? <button className="modal-action-cancel" onClick={() => controller.current?.abort()}><LoaderCircle className="novel-spinner" size={15}/>{tr('cancel')}</button> : <button className="modal-action-submit" disabled={!revisionRequest.trim() || !proposal.trim()} onClick={() => void generate(revisionRequest.trim(), true)}><Sparkles size={15}/>{tr('requestRevision')}</button>}</div></div>) : <div className="novel-request-controls"><div className={`novel-prompts${tab === 'bible' ? ' settings-actions' : ''}`}>{(tab === 'bible' ? [...SETTING_CATEGORIES] : [chapter.text.trim() ? 'continue' : 'start', 'outline', 'review']).map(key => <Tooltip key={key} content={key === 'review' && !chapter.text.trim() ? tr('reviewNeedsText') : tr(key)} multiline={key === 'review' && !chapter.text.trim()} size={key === 'review' && !chapter.text.trim() ? 'medium' : 'small'}><button aria-label={tr(key)} aria-pressed={selectedAction === key} disabled={busy || (key === 'review' && !chapter.text.trim())} onClick={() => {chooseAction(key);}}><span>{tr(tab === 'bible' ? `compactLabels.${key}` : key)}</span><ArrowRight size={14}/></button></Tooltip>)}</div>
                    {tab === 'text' && <div className="novel-writing-setting"><label>{tr('writingSettings')}</label><CustomSelect ariaLabel={tr('writingSettings')} value={story.activeFinalSettingId ?? ''} disabled={busy} portal options={[{value: '', label: tr('noFinalSetting')}, ...finalSettings.map(item => ({value: item.id, label: item.title}))]} onChange={id => updateStory({activeFinalSettingId: id || null})}/></div>}
                    {selectedAction !== 'customRequest' && <div className="novel-task-guidance">
                        <div className="novel-task-guidance-heading"><Tooltip content={tr('taskGuidance')}><label htmlFor="novel-task-guidance">{tr('compactLabels.taskGuidance')}</label></Tooltip><ToggleSwitch checked={includeTaskGuidance} disabled={busy} label={tr('includeTaskGuidance')} onChange={setIncludeTaskGuidance}/></div>
                        {includeTaskGuidance && <textarea id="novel-task-guidance" className="novel-task-guidance-editor" maxLength={2500} disabled={busy || !includeTaskGuidance} value={taskGuidance} onChange={event => setTaskGuidanceEdits(previous => ({...previous, [selectedAction]: event.target.value}))}/>}
                    </div>}
                    <label className="novel-instruction-label" htmlFor="novel-instruction">{tr('instruction')}<span className="novel-action-badge">{tr(selectedAction)}</span></label><textarea ref={instructionRef} id="novel-instruction" maxLength={3000} value={instruction} onChange={event => setInstruction(event.target.value)} placeholder={tr(selectedAction === 'customRequest' ? 'instructionPlaceholder' : `${selectedAction}Placeholder`)}/>
                    {tab === 'bible' && contextControls}
                    {busy ? <button className="modal-action-cancel" onClick={() => controller.current?.abort()}><LoaderCircle className="novel-spinner" size={15}/>{tr('cancel')}</button> : <button className="modal-action-submit" disabled={!writingRequest || (tab === 'bible' && selectedAction === 'synthesis' && !selectedSettings.length)} onClick={() => void generate(writingRequest)}><Sparkles size={15}/>{tr('generate')}</button>}
</div>}

                    {error && <p role="alert" className="novel-error">{error}</p>}
                </aside>) : null}>
        {exporting && <p className="novel-export-status" role="status">{tr('exporting')}</p>}
        {loading && <p className="novel-storage-error" role="status">{tr('loadingStories')}</p>}
        {(saveStatus === 'error' || loadFailed) && <div className="novel-storage-error" role="alert">{tr(loadFailed ? 'loadError' : 'saveError')} <button className="modal-action-cancel" onClick={() => {if (loadFailed) void reload(); else void flushStorySaves().catch(() => {});}}>{tr('retry')}</button></div>}
        {story && (
                <main className="novel-writing">
                    {viewingFinal ? <ProposalReader key={viewingFinal.id} text={viewingFinal.content} title={viewingFinal.title} action="synthesis" busy={busy} maxLength={20000} onReturn={() => setViewingFinalId(null)} onChange={content => updateStory({finalSettings: finalSettings.map(item => item.id === viewingFinal.id ? {...item, content} : item)})}/> : viewingCandidate ? <CandidateReader key={viewingCandidate.id} candidate={viewingCandidate} onBack={() => setViewingCandidateId(null)} onChange={content => updateStory({settingsCandidates: (story.settingsCandidates ?? []).map(candidate => candidate.id === viewingCandidate.id ? {...candidate, content} : candidate)})}/> : responseVisible ? <ProposalReader key={`${proposalTarget}:${proposalAction}`} text={proposal} action={proposalAction} busy={busy} onChange={setProposal}/> : <>
                    <div className="novel-paper">{tab === 'text' ? <><input className="novel-chapter-title" aria-label={tr('chapterTitle')} maxLength={200} value={chapter.title} onChange={event => updateChapter({title: event.target.value})}/><textarea className="novel-manuscript" aria-label={tr('text')} maxLength={1000000} placeholder={tr('manuscriptPlaceholder')} value={chapter.text} onChange={event => {updateChapter({text: event.target.value}); setUndo(null);}}/></> : <SettingsPlanner onView={candidate => {setSelectedAction(candidate.category); setViewingCandidateId(candidate.id);}} candidates={story.settingsCandidates ?? []} disabled={busy} onChange={settingsCandidates => updateStory({settingsCandidates})} onChoose={category => chooseAction(category)} onSynthesize={() => chooseAction('synthesis')}>
                        <FinalSettingsLibrary items={finalSettings} activeId={story.activeFinalSettingId ?? null} disabled={busy} onSelect={id => updateStory({activeFinalSettingId: id})} onView={setViewingFinalId} onChange={items => updateStory({finalSettings: items, activeFinalSettingId: items.some(item => item.id === story.activeFinalSettingId) ? story.activeFinalSettingId : null})}/>

                    </SettingsPlanner>}</div>
                    <footer className="novel-writing-footer"><span>{t('novelStudio.characters', {count: Array.from(tab === 'bible' ? activeFinal?.content ?? '' : chapter.text).length})}</span>{undo?.chapterId === chapter.id && undo.target === tab && <button onClick={() => {updateChapter({text: undo.text}); setUndo(null);}}><Undo2 size={14}/>{tr('undo')}</button>}<span>{tr('draft')}</span></footer>
                    </>}
                </main>)}

    </WorkspaceLayout>;
}
