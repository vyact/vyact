import useScrollActivity from '../common/hooks/useScrollActivity';
import useSelectedItemVisibility from '../common/hooks/useSelectedItemVisibility';
import LibrarySelectionActions from './LibrarySelectionActions';
import ConfirmModal from '../common/ConfirmModal/ConfirmModal';
import useGenerationExitConfirmation from './useGenerationExitConfirmation';
import {buildChapterContext, getEarlierChapters} from './chapterContext';
import ManuscriptEditor from './ManuscriptEditor';
import {reviseSavedProposal, type SavedProposalSource} from './savedProposal';
import FinalSettingsLibrary from './FinalSettingsLibrary';
import CustomSelect from '../CustomSelect/CustomSelect';
import {Tooltip} from '../common/Tooltip/Tooltip';
import {getSettingsContext} from './settingsContext';
import ToggleSwitch from '../common/ToggleSwitch/ToggleSwitch';
import {buildWritingInstruction} from './writingInstruction';
import {downloadNovel, type NovelExportFormat} from './storyExport';
import {useEffect, useRef, useState} from 'react';
import {Plus, Feather, Sparkles, LoaderCircle, Undo2, MoreHorizontal, Download, Info, LogOut, Trash2} from 'lucide-react';
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
    const [deletingChapterId, setDeletingChapterId] = useState<string | null>(null);
    const [selectingChapters, setSelectingChapters] = useState(false);
    const [selectedChapterIds, setSelectedChapterIds] = useState<Set<string>>(new Set());
    const [confirmChapterBulkDelete, setConfirmChapterBulkDelete] = useState(false);
    useEffect(() => {setSelectingChapters(false); setSelectedChapterIds(new Set()); setConfirmChapterBulkDelete(false);}, [storyId]);
    const toggleChapterSelection = (id: string) => setSelectedChapterIds(previous => {const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next;});
    const [chapterMenuId, setChapterMenuId] = useState<string | null>(null);
    const instructionRef = useRef<HTMLTextAreaElement>(null);
    const [instruction, setInstruction] = useState('');
    const [includePreviousChapters, setIncludePreviousChapters] = useState(true);
    const [includeTaskGuidance, setIncludeTaskGuidance] = useState(true);
    const [taskGuidanceEdits, setTaskGuidanceEdits] = useState<Record<string, string>>({});
    const [revisionRequest, setRevisionRequest] = useState('');
    const [revisionSource, setRevisionSource] = useState<SavedProposalSource | null>(null);
    const [proposal, setProposal] = useState('');
    const [responseVisible, setResponseVisible] = useState(false);
    const [selectedAction, setSelectedAction] = useState('write');
    const [contextExclusions, setContextExclusions] = useState<Record<string, SettingCategory[]>>({});
    const [proposalAction, setProposalAction] = useState('write');
    const [proposalQuery, setProposalQuery] = useState({instruction: '', authorDirection: ''});
    const [viewingCandidateId, setViewingCandidateId] = useState<string | null>(null);
    const [candidateTitle, setCandidateTitle] = useState('');
    const [viewingFinalId, setViewingFinalId] = useState<string | null>(null);
    const [proposalTarget, setProposalTarget] = useState<'text' | 'bible'>('text');
    const [exporting, setExporting] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [undo, setUndo] = useState<{chapterId: string; target: 'text' | 'bible'; text: string; title: string} | null>(null);
    const controller = useRef<AbortController | null>(null);
    const story = stories.find(item => item.id === storyId) ?? stories[0];
    const finalSettings = story?.finalSettings ?? [];
    const activeFinal = finalSettings.find(item => item.id === story?.activeFinalSettingId);
    const viewingFinal = finalSettings.find(item => item.id === viewingFinalId);
    const viewingCandidate = story?.settingsCandidates?.find(candidate => candidate.id === viewingCandidateId);
    const contextAction = viewingCandidate?.category ?? (viewingFinal ? 'synthesis' : responseVisible ? proposalAction : selectedAction);
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
    const {requestExit, confirmation: exitConfirmation} = useGenerationExitConfirmation(busy, async () => {
        controller.current?.abort();
        try {await flushStorySaves(); onClose();}
        catch {setError(tr('saveError'));}
    });
    const resetAssistant = () => {setRevisionSource(null);setRevisionRequest('');setViewingFinalId(null);setViewingCandidateId(null);setProposal(''); setResponseVisible(false); setError(''); setUndo(null); setInstruction(''); setSelectedAction('write');};
    const addStory = () => {
        const next = createStory(tr('untitled'), t('novelStudio.chapterNumber', {number: 1}));
        setStories(items => [...items, next]); setStoryId(next.id); setChapterId(next.chapters[0].id); setTab('text'); resetAssistant();
    };
    const generate = async (request: string, revision = false) => {
        if (!story || !chapter || !request.trim() || busy) return;
        const action = revision ? contextAction : tab === 'bible' && selectedAction !== 'synthesis' && !SETTING_CATEGORIES.includes(selectedAction as SettingCategory) ? 'createDirection' : selectedAction;
        const savedSource = viewingCandidate ?? viewingFinal;
        const revisionText = savedSource?.content ?? proposal;
        const originalInstruction = viewingCandidate?.generationInstruction ?? proposalQuery.instruction;
        if (revision && savedSource) {
            setRevisionSource({kind: viewingCandidate ? 'candidate' : 'final', id: savedSource.id});
            setProposal(savedSource.content); setCandidateTitle(savedSource.title); setProposalAction(action); setProposalTarget('bible');
        }
        setSelectedAction(action);
        setViewingCandidateId(null); setViewingFinalId(null);
        if (!revision) {
            setRevisionSource(null);
            setProposalQuery({instruction: request, authorDirection: instruction.trim()});
            setProposal(''); setProposalTarget(tab); setProposalAction(action); setCandidateTitle(''); setRevisionRequest('');
        }
        setBusy(true); setError(''); setResponseVisible(true);
        controller.current = new AbortController();
        try {
            const selected = getSettingsContext(story.settingsCandidates ?? [], action, contextExclusions[`${story.id}:${action}`] ?? []).map(({category, title, content}) => ({category, title, content}));
            if (tab === 'bible' && selected.reduce((sum, candidate) => sum + candidate.content.length + candidate.title.length, 0) > 50000) throw new Error('settings-context-limit');
            const response = await fetch('/api/novel-studio/generate', {method: 'POST', signal: controller.current.signal, headers: {'Content-Type': 'application/json'}, body: JSON.stringify({title: story.title.slice(0, 200), chapter_title: chapter.title.slice(0, 200), bible: activeFinal?.content ?? '', previous: buildChapterContext(story.chapters, chapter.id, tab === 'bible' || includePreviousChapters), manuscript: chapter.text, instruction: request, ...(revision ? {proposal: revisionText, original_instruction: originalInstruction} : {}), target: tab, ...(tab === 'bible' ? {settings_stage: action, selected_settings: selected} : {}), language: i18n.resolvedLanguage || i18n.language})});
            if (!response.ok) throw new Error('Generation failed');
            const data = await response.json();
            if (typeof data.text !== 'string' || !data.text.trim()) throw new Error('Empty generation');
            setProposal(data.text);
            if (revision) {setRevisionRequest(''); setProposalQuery({instruction: request, authorDirection: revisionRequest.trim()});}
            if (typeof data.title === 'string' && data.title.trim()) {
                const generatedTitle = data.title.trim().slice(0, 200);
                setCandidateTitle(generatedTitle);

            }
        } catch (failure) {if (!revision) setResponseVisible(false); if (!(failure instanceof DOMException && failure.name === 'AbortError')) setError(tr(failure instanceof Error && failure.message === 'settings-context-limit' ? 'selectionLimit' : 'generationError'));}
        finally {setBusy(false); controller.current = null;}
    };
    const contextControls = <div className="novel-request-context"><div className="novel-request-context-heading"><p>{t('novelStudio.proposalContext', {count: selectedSettings.length})}</p><Tooltip content={tr('proposalContextHelp')} multiline size="medium" placement="above"><button type="button" className="titlebar-btn" aria-label={tr('proposalContextHelp')}><Info size={14} aria-hidden="true"/></button></Tooltip></div>{selectedSettingCategories.length > 0 && <ul>{selectedSettingCategories.map(category => <li key={category}><span>{tr(category)} · {availableContext.filter(candidate => candidate.category === category).length}</span><ToggleSwitch checked={!excludedContextCategories.includes(category)} disabled={busy} label={t('novelStudio.includeContextCategory', {category: tr(category)})} onChange={included => setContextExclusions(previous => ({...previous, [contextKey]: included ? (previous[contextKey] ?? []).filter(item => item !== category) : [...(previous[contextKey] ?? []), category]}))}/></li>)}</ul>}</div>;
    const revisionControls = <div className="novel-revision-controls"><label htmlFor="novel-revision-request">{tr('reviseProposal')}</label><textarea id="novel-revision-request" maxLength={3000} disabled={busy} value={revisionRequest} placeholder={tr('revisionPlaceholder')} onChange={event => setRevisionRequest(event.target.value)}/><p className="novel-revision-context-help">{tr('revisionContextHelp')}</p>{tab === 'bible' && contextControls}{busy ? <button className="modal-action-cancel" onClick={() => controller.current?.abort()}><LoaderCircle className="novel-spinner" size={15}/>{tr('cancel')}</button> : <button className="modal-action-submit" disabled={!revisionRequest.trim() || !(viewingCandidate?.content ?? viewingFinal?.content ?? proposal).trim()} onClick={() => void generate(revisionRequest.trim(), true)}><Sparkles size={15}/>{tr('requestRevision')}</button>}</div>;
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
        if (revisionSource?.kind === 'candidate') setViewingCandidateId(revisionSource.id);
        if (revisionSource?.kind === 'final') setViewingFinalId(revisionSource.id);
        setRevisionSource(null);
        setProposal('');
        setResponseVisible(false);
        setInstruction('');
        setRevisionRequest('');
        setCandidateTitle('');
        setProposalQuery({instruction: '', authorDirection: ''});
        setError('');
    };
    const saveReviewedProposal = () => {
        if (!revisionSource) {if (proposalTarget !== 'bible') applyManuscriptProposal(); else if (proposalAction !== 'synthesis') saveCandidate(); else saveFinalSettings(); return;}
        if (proposal.length > 20000) {setError(tr('settingsLimit')); return;}
        if (!story) return;
        updateStory(reviseSavedProposal(story, revisionSource, {title: candidateTitle, content: proposal, instruction: proposalQuery.instruction, authorDirection: proposalQuery.authorDirection}));
        finishProposalReview();
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
    const applyManuscriptProposal = () => {
        if (!chapter) return;
        setUndo(chapter.text.trim() ? {chapterId: chapter.id, target: 'text', text: chapter.text, title: chapter.title} : null);
        updateChapter({text: proposal, title: candidateTitle.trim() || chapter.title});
        setTab('text'); finishProposalReview();

    };
    const taskGuidance = selectedAction === 'customRequest' ? '' : taskGuidanceEdits[selectedAction] ?? tr(`${selectedAction}Prompt`);
    const writingRequest = buildWritingInstruction(includeTaskGuidance ? taskGuidance : '', instruction);
    const {scrolling: chaptersScrolling, onScroll: onChaptersScroll} = useScrollActivity();
    const {containerRef: chapterScrollRef, selectedItemRef: selectedChapterRef} = useSelectedItemVisibility(chapter?.id ?? '', story?.chapters.length ?? 0);
    const deleteChapters = (ids: string[]) => {
        if (!story) return;
        const remaining = story.chapters.filter(item => !ids.includes(item.id));
        const chapters = remaining.length ? remaining : [createChapter(t('novelStudio.chapterNumber', {number: 1}))];
        updateStory({chapters});
        if (ids.includes(chapter.id)) {setChapterId(chapters[0].id); setTab('text'); resetAssistant();}
    };
    const deleteStories = (ids: string[]) => {
        const deletedIds = new Set(ids);
        const remaining = stories.filter(item => !deletedIds.has(item.id));
        const next = remaining.length ? remaining : [createStory(tr('untitled'), t('novelStudio.chapterNumber', {number: 1}))];
        setStories(() => next);
        setContextExclusions(previous => Object.fromEntries(Object.entries(previous).filter(([key]) => !ids.some(id => key.startsWith(`${id}:`)))));
        if (story && deletedIds.has(story.id)) {setStoryId(next[0].id); setChapterId(''); setTab('text'); resetAssistant();}
    };
    const header = <>
        <div className="novel-brand"><Feather size={19}/><h1>{tr('title')}</h1></div>
        {story && <div className="novel-current-story"><span className="novel-current-story-name">{story.title}</span></div>}
        <div className="novel-tabs">{(['text', 'bible'] as const).map(key => <button key={key} disabled={busy} aria-pressed={tab === key} onClick={() => {setTab(key); setViewingCandidateId(null); setViewingFinalId(null); setInstruction(''); setSelectedAction(key === 'bible' ? 'createDirection' : 'write');}}>{tr(key)}</button>)}</div>
        <button data-tooltip-disabled="" aria-label={tr('backToChat')} className="novel-return" onClick={requestExit}><LogOut size={16} strokeWidth={1.8}/><span>{tr('exitStudio')}</span></button>
    </>;
    return <WorkspaceLayout className="novel-studio" label={tr('title')} header={header}
        sidebar={story ? (                <nav className="novel-library" aria-label={tr('library')}>
                    <StoryLibrary stories={stories} activeId={story.id} disabled={busy || exporting || loadFailed} onSelect={id => {setStoryId(id); setChapterId(''); setTab('text'); resetAssistant();}}
                        onExport={(selectedStory, format) => {void exportManuscript(selectedStory, format);}}
                        onRename={(id, title) => setStories(items => items.map(item => item.id === id ? {...item, title} : item))}
                        onTogglePin={id => setStories(items => {const pinnedAt = Math.max(Date.now(), ...items.map(item => (item.pinnedAt ?? 0) + 1)); return items.map(item => item.id === id ? {...item, pinnedAt: item.pinnedAt ? null : pinnedAt} : item);})}
                        onCreate={addStory} onDelete={id => deleteStories([id])} onDeleteMany={deleteStories}/>

                    <div className="novel-section-heading"><span>{tr('chapters')}</span><LibrarySelectionActions selecting={selectingChapters} count={story.chapters.filter(item => selectedChapterIds.has(item.id)).length} disabled={busy || exporting || loadFailed} selectLabel={tr('bulkDeleteChapters.select')} createLabel={tr('newChapter')} onStart={() => {setChapterMenuId(null); setSelectedChapterIds(new Set()); setSelectingChapters(true);}} onCancel={() => {setSelectingChapters(false); setSelectedChapterIds(new Set());}} onDone={() => setConfirmChapterBulkDelete(true)} onCreate={() => {const next = createChapter(t('novelStudio.chapterNumber', {number: story.chapters.length + 1})); updateStory({chapters: [...story.chapters, next]}); setChapterId(next.id); setTab('text'); resetAssistant();}}/></div>
                    <div ref={chapterScrollRef} className={`novel-chapter-list${chaptersScrolling ? ' is-scrolling' : ''}`} onScroll={onChaptersScroll}>
                    {story.chapters.map((item, index) => <div ref={chapter.id === item.id ? selectedChapterRef : undefined} key={item.id} className={`novel-story-row novel-chapter-row${chapter.id === item.id ? ' selected' : ''}`}>
                        {selectingChapters && <input type="checkbox" className="novel-story-checkbox" disabled={busy || exporting} aria-label={t('novelStudio.bulkDeleteChapters.selectChapter', {title: item.title})} checked={selectedChapterIds.has(item.id)} onChange={() => toggleChapterSelection(item.id)}/>}
                        <button className={`novel-chapter${chapter.id === item.id ? ' selected' : ''}`} disabled={busy} onClick={() => {if (selectingChapters) {toggleChapterSelection(item.id); return;} setChapterId(item.id); setTab('text'); resetAssistant();}}><span>{String(index + 1).padStart(2, '0')}</span><span>{item.title}</span></button>
                        {!selectingChapters && <ActionMenu disabled={busy || exporting} isOpen={chapterMenuId === item.id} onOpenChange={open => setChapterMenuId(open ? item.id : null)} trigger={<MoreHorizontal size={15}/>} ariaLabel={t('novelStudio.chapterActions', {title: item.title})} triggerClassName="hist-menu-btn novel-story-menu" menuClassName="hist-menu-popup">
                            {(['pdf', 'md'] as const).map(format => <button key={format} className="hist-menu-item" onClick={() => {setChapterMenuId(null); void exportManuscript(story, format, item.id);}}><Download size={14}/>{t('novelStudio.downloadFormat', {format: format.toUpperCase()})}</button>)}
                            <button className="hist-menu-item danger" onClick={() => {setChapterMenuId(null); setDeletingChapterId(item.id);}}><Trash2 size={14}/>{tr('delete')}</button>
                        </ActionMenu>}
                    </div>)}
                    </div>

                </nav>) : null}
        inspector={story ? (
                <aside className="novel-assistant"><div className="novel-assistant-heading"><Sparkles size={18}/><h2>{tr('assistant')}</h2></div>{tab === 'bible' && <p className="novel-assistant-description">{tr('settingsWorkflowHelp')}</p>}
                    {(viewingCandidate || viewingFinal) ? <div className="novel-saved-revision"><span className="novel-response-save-target">{tr(contextAction)}</span><h3>{viewingCandidate?.title ?? viewingFinal?.title}</h3>{revisionControls}</div> : responseVisible && (!busy || !!proposal) ? (<div className="novel-response-save"><div className="novel-section-heading">{tr('proposal')}</div><p className="novel-response-save-help">{tr(proposalTarget === 'text' ? 'manuscriptApplyHelp' : proposalAction === 'synthesis' ? 'finalSaveHelp' : 'responseSaveHelp')}</p>{proposalTarget === 'bible' && <div className="novel-response-save-target">{tr(proposalAction)}</div>}
                        {proposalTarget === 'bible' && <input className="novel-candidate-name" aria-label={tr('candidateTitle')} placeholder={tr('candidateTitle')} maxLength={200} value={candidateTitle} onChange={event => setCandidateTitle(event.target.value)}/>}
                        <div className="novel-response-actions"><button className="modal-action-cancel" disabled={busy} onClick={finishProposalReview}>{tr('discardShort')}</button>                        <button className="modal-action-submit" disabled={busy || !proposal.trim()} onClick={saveReviewedProposal}><Plus size={15}/>{tr(proposalTarget === 'text' ? 'addToManuscript' : 'saveShort')}</button></div>{revisionControls}</div>) : <div className="novel-request-controls">{tab === 'bible' && <div className="novel-prompts settings-actions">{SETTING_CATEGORIES.map(key => <button key={key} data-tooltip-disabled="" aria-label={tr(key)} aria-pressed={selectedAction === key} disabled={busy} onClick={() => chooseAction(key)}><span>{tr(`compactLabels.${key}`)}</span></button>)}</div>}
                    {tab === 'text' && <div className="novel-writing-setting"><label>{tr('writingSettings')}</label><CustomSelect ariaLabel={tr('writingSettings')} value={story.activeFinalSettingId ?? ''} disabled={busy} portal options={[{value: '', label: tr('noFinalSetting')}, ...finalSettings.map(item => ({value: item.id, label: item.title}))]} onChange={id => updateStory({activeFinalSettingId: id || null})}/></div>}
                    {tab === 'text' && getEarlierChapters(story.chapters, chapter.id).length > 0 && <div className="novel-previous-context"><span>{t('novelStudio.previousChapterContext', {count: getEarlierChapters(story.chapters, chapter.id).length})}</span><ToggleSwitch checked={includePreviousChapters} disabled={busy} label={tr('includePreviousChapters')} onChange={setIncludePreviousChapters}/></div>}
                    {selectedAction !== 'customRequest' && <div className="novel-task-guidance">
                        <div className="novel-task-guidance-heading"><label htmlFor="novel-task-guidance" data-tooltip-disabled="">{tr('compactLabels.taskGuidance')}</label><ToggleSwitch checked={includeTaskGuidance} disabled={busy} label={tr('includeTaskGuidance')} onChange={setIncludeTaskGuidance}/></div>
                        {includeTaskGuidance && <textarea id="novel-task-guidance" className="novel-task-guidance-editor" maxLength={2500} disabled={busy || !includeTaskGuidance} value={taskGuidance} onChange={event => setTaskGuidanceEdits(previous => ({...previous, [selectedAction]: event.target.value}))}/>}
                    </div>}
                    <label className="novel-instruction-label" htmlFor="novel-instruction">{tr('instruction')}{tab === 'bible' && <span className="novel-action-badge">{tr(selectedAction)}</span>}</label><textarea ref={instructionRef} id="novel-instruction" maxLength={3000} value={instruction} onChange={event => setInstruction(event.target.value)} placeholder={tr(selectedAction === 'customRequest' ? 'instructionPlaceholder' : `${selectedAction}Placeholder`)}/>
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
                    {viewingFinal ? <ProposalReader key={viewingFinal.id} text={viewingFinal.content} title={viewingFinal.title} onTitleChange={title => updateStory({finalSettings: finalSettings.map(item => item.id === viewingFinal.id ? {...item, title} : item)})} action="synthesis" busy={busy} maxLength={20000} onReturn={() => setViewingFinalId(null)} onChange={content => updateStory({finalSettings: finalSettings.map(item => item.id === viewingFinal.id ? {...item, content} : item)})}/> : viewingCandidate ? <CandidateReader key={viewingCandidate.id} candidate={viewingCandidate} onTitleChange={title => updateStory({settingsCandidates: (story.settingsCandidates ?? []).map(item => item.id === viewingCandidate.id ? {...item, title} : item)})} onBack={() => setViewingCandidateId(null)} onChange={content => updateStory({settingsCandidates: (story.settingsCandidates ?? []).map(candidate => candidate.id === viewingCandidate.id ? {...candidate, content} : candidate)})}/> : responseVisible ? <ProposalReader key={`${proposalTarget}:${proposalAction}`} text={proposal} action={proposalAction} busy={busy} onChange={setProposal}/> : <>
                    <div className={`novel-paper${tab === 'text' ? ' novel-paper--manuscript' : ''}`}>{tab === 'text' ? <ManuscriptEditor key={chapter.id} chapter={chapter} onChange={patch => {updateChapter(patch); setUndo(null);}}/> : <SettingsPlanner onView={candidate => {setSelectedAction(candidate.category); setViewingCandidateId(candidate.id); setViewingFinalId(null); setRevisionRequest(''); setError('');}} candidates={story.settingsCandidates ?? []} disabled={busy} onChange={settingsCandidates => updateStory({settingsCandidates})} onChoose={category => chooseAction(category)} onSynthesize={() => chooseAction('synthesis')}>
                        <FinalSettingsLibrary items={finalSettings} activeId={story.activeFinalSettingId ?? null} disabled={busy} onSelect={id => updateStory({activeFinalSettingId: id})} onView={id => {setViewingFinalId(id); setViewingCandidateId(null); setRevisionRequest(''); setError('');}} onChange={items => updateStory({finalSettings: items, activeFinalSettingId: items.some(item => item.id === story.activeFinalSettingId) ? story.activeFinalSettingId : null})}/>

                    </SettingsPlanner>}</div>
                    <footer className="novel-writing-footer"><span>{t('novelStudio.characters', {count: Array.from(tab === 'bible' ? activeFinal?.content ?? '' : chapter.text).length, formattedCount: new Intl.NumberFormat(i18n.resolvedLanguage || i18n.language).format(Array.from(tab === 'bible' ? activeFinal?.content ?? '' : chapter.text).length)})}</span>{undo?.chapterId === chapter.id && undo.target === tab && <button onClick={() => {updateChapter({text: undo.text, title: undo.title}); setUndo(null);}}><Undo2 size={14}/>{tr('undo')}</button>}<span role="status">{tr(`saveState.${saveStatus}`)}</span></footer>
                    </>}
                </main>)}

        {deletingChapterId && story && <ConfirmModal actionLayout="horizontal" title={tr('deleteChapterTitle')} description={t('novelStudio.deleteChapterDescription', {title: story.chapters.find(item => item.id === deletingChapterId)?.title ?? ''})} options={[{label: tr('keep'), value: 'cancel'}, {label: tr('delete'), value: 'delete', variant: 'danger'}]} onClose={() => setDeletingChapterId(null)} onSelect={value => {
            if (value === 'delete' && !busy) {
                deleteChapters([deletingChapterId]);
            }
            setDeletingChapterId(null);
        }}/>}
        {confirmChapterBulkDelete && story && <ConfirmModal actionLayout="horizontal" title={tr('bulkDeleteChapters.title')} description={t('novelStudio.bulkDeleteChapters.description', {count: story.chapters.filter(item => selectedChapterIds.has(item.id)).length})} options={[{label: tr('keep'), value: 'cancel'}, {label: tr('delete'), value: 'delete', variant: 'danger'}]} onClose={() => setConfirmChapterBulkDelete(false)} onSelect={value => {if (value === 'delete' && !busy && !exporting) {deleteChapters([...selectedChapterIds]); setSelectedChapterIds(new Set()); setSelectingChapters(false);} setConfirmChapterBulkDelete(false);}}/>}
        {exitConfirmation}
    </WorkspaceLayout>;
}
