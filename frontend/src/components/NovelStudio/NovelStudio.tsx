import {buildWritingInstruction} from './writingInstruction';
import {downloadNovel, type NovelExportFormat} from './storyExport';
import {useEffect, useRef, useState} from 'react';
import {Plus, Feather, Sparkles, Check, LoaderCircle, ArrowRight, ArrowLeft, Undo2, MoreHorizontal, Download} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import ProposalReader from './ProposalReader';
import SettingsPlanner from './SettingsPlanner';
import ConfirmModal from '../common/ConfirmModal/ConfirmModal';
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
    const [proposal, setProposal] = useState('');
    const [responseVisible, setResponseVisible] = useState(false);
    const [selectedAction, setSelectedAction] = useState('customRequest');
    const [proposalAction, setProposalAction] = useState('customRequest');
    const [candidateTitle, setCandidateTitle] = useState('');
    const [confirmFinal, setConfirmFinal] = useState(false);
    const [proposalTarget, setProposalTarget] = useState<'text' | 'bible'>('text');
    const [exporting, setExporting] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [undo, setUndo] = useState<{chapterId: string; target: 'text' | 'bible'; text: string} | null>(null);
    const controller = useRef<AbortController | null>(null);
    const story = stories.find(item => item.id === storyId) ?? stories[0];
    const chapter = story?.chapters.find(item => item.id === chapterId) ?? story?.chapters[0];
    useEffect(() => () => controller.current?.abort(), []);
    const updateStory = (patch: Partial<Story>) => setStories(items => items.map(item => item.id === story?.id ? {...item, ...patch} : item));
    const updateChapter = (patch: Partial<NonNullable<typeof chapter>>) => {
        if (story) updateStory({chapters: story.chapters.map(item => item.id === chapter?.id ? {...item, ...patch} : item)});
    };
    const resetAssistant = () => {setProposal(''); setResponseVisible(false); setError(''); setUndo(null); setInstruction(''); setSelectedAction('customRequest');};
    const addStory = () => {
        const next = createStory(tr('untitled'), t('novelStudio.chapterNumber', {number: 1}));
        setStories(items => [...items, next]); setStoryId(next.id); setChapterId(next.chapters[0].id); setTab('text'); resetAssistant();
    };
    const generate = async (request: string) => {
        if (!story || !chapter || !request.trim() || busy) return;
        const action = tab === 'bible' && selectedAction !== 'synthesis' && !SETTING_CATEGORIES.includes(selectedAction as SettingCategory) ? 'createDirection' : selectedAction;
        setSelectedAction(action);
        setBusy(true); setError(''); setProposal(''); setResponseVisible(false); setProposalTarget(tab); setProposalAction(action); setCandidateTitle(''); setResponseVisible(true);
        controller.current = new AbortController();
        try {
            const selected = (story.settingsCandidates ?? []).filter(candidate => candidate.selected).map(({category, title, content}) => ({category, title, content}));
            if (tab === 'bible' && selected.reduce((sum, candidate) => sum + candidate.content.length + candidate.title.length, 0) > 50000) throw new Error('settings-context-limit');
            const position = story.chapters.findIndex(item => item.id === chapter.id);
            const response = await fetch('/api/novel-studio/generate', {method: 'POST', signal: controller.current.signal, headers: {'Content-Type': 'application/json'}, body: JSON.stringify({title: story.title.slice(0, 200), bible: story.bible.slice(0, 20000), previous: story.chapters.slice(0, position).map(item => `${item.title}\n${item.text}`).join('\n\n').slice(-30000), manuscript: chapter.text.slice(-30000), instruction: request, target: tab, ...(tab === 'bible' ? {settings_stage: action, selected_settings: selected} : {}), language: i18n.resolvedLanguage || i18n.language})});
            if (!response.ok) throw new Error('Generation failed');
            const data = await response.json();
            if (typeof data.text !== 'string' || !data.text.trim()) throw new Error('Empty generation');
            setProposal(data.text);
        } catch (failure) {setResponseVisible(false); if (!(failure instanceof DOMException && failure.name === 'AbortError')) setError(tr(failure instanceof Error && failure.message === 'settings-context-limit' ? 'selectionLimit' : 'generationError'));}
        finally {setBusy(false); controller.current = null;}
    };
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
    const applyFinalSettings = () => {
        if (!chapter || !story) return;
        if (proposal.length > 20000) {setError(tr('settingsLimit')); return;}
        setUndo({chapterId: chapter.id, target: 'bible', text: story.bible});
        updateStory({bible: proposal}); setProposal(''); setResponseVisible(false); setTab('bible'); setConfirmFinal(false);
    };
    const saveCandidate = () => {
        if (!story || !proposal.trim()) return;
        const candidates = story.settingsCandidates ?? [];
        if (candidates.length >= 100 || proposal.length > 20000) {setError(tr('candidateLimit')); return;}
        updateStory({settingsCandidates: [...candidates, {id: crypto.randomUUID(), category: proposalAction as SettingCategory, title: candidateTitle.trim() || `${tr(proposalAction)} ${candidates.filter(candidate => candidate.category === proposalAction).length + 1}`, content: proposal, selected: true}]});
        setProposal(''); setResponseVisible(false); setTab('bible');
    };
    const appendProposal = () => {
        if (!chapter) return;
        setUndo({chapterId: chapter.id, target: 'text', text: chapter.text});
        updateChapter({text: [chapter.text, proposal].filter(Boolean).join('\n\n')});
        setTab('text'); setProposal(''); setResponseVisible(false);

    };
    const taskGuidance = selectedAction === 'customRequest' ? '' : tr(`${selectedAction}Prompt`);
    const writingRequest = buildWritingInstruction(taskGuidance, instruction);
    const header = <>
        <div className="novel-brand"><Feather size={19}/><h1>{tr('title')}</h1></div>
        {story && <input className="novel-story-title" aria-label={tr('storyTitle')} maxLength={200} value={story.title} onChange={event => updateStory({title: event.target.value})}/>}
        <div className="novel-tabs">{(['text', 'bible'] as const).map(key => <button key={key} disabled={busy} aria-pressed={tab === key} onClick={() => {setTab(key); setInstruction(''); setSelectedAction(key === 'bible' ? 'createDirection' : 'customRequest');}}>{tr(key)}</button>)}</div>
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
                <aside className="novel-assistant"><div className="novel-assistant-heading"><Sparkles size={18}/><h2>{tr('assistant')}</h2></div><p className="novel-assistant-description">{tr(tab === 'bible' ? 'settingsWorkflowHelp' : 'assistantHelp')}</p><div className="novel-context"><Check size={13}/>{tr('context')}</div>
                    {responseVisible && !busy ? (<div className="novel-response-save"><div className="novel-section-heading">{tr('proposal')}</div><p className="novel-response-save-help">{tr(proposalTarget === 'text' ? 'assistantHelp' : proposalAction === 'synthesis' ? 'finalSettingsHelp' : 'responseSaveHelp')}</p>{proposalTarget === 'bible' && <div className="novel-response-save-target">{tr(proposalAction)}</div>}
                        {proposalTarget === 'bible' && proposalAction !== 'synthesis' && <input className="novel-candidate-name" aria-label={tr('candidateTitle')} placeholder={tr('candidateTitle')} maxLength={200} value={candidateTitle} onChange={event => setCandidateTitle(event.target.value)}/>}
                        <button className="modal-action-submit" disabled={!proposal.trim()} onClick={() => {if (proposalTarget !== 'bible') appendProposal(); else if (proposalAction !== 'synthesis') saveCandidate(); else if (story.bible.trim()) setConfirmFinal(true); else applyFinalSettings();}}><Plus size={15}/>{tr(proposalTarget !== 'bible' ? 'append' : proposalAction === 'synthesis' ? 'applyFinal' : 'saveCandidate')}</button><button className="modal-action-cancel" onClick={() => {setProposal(''); setResponseVisible(false);}}>{tr('discard')}</button></div>) : <div className="novel-request-controls"><div className={`novel-prompts${tab === 'bible' ? ' settings-actions' : ''}`}>{(tab === 'bible' ? [...SETTING_CATEGORIES] : [chapter.text.trim() ? 'continue' : 'start', 'outline', 'review']).map(key => <button key={key} aria-pressed={selectedAction === key} disabled={busy || (key === 'review' && !chapter.text.trim())} title={key === 'review' && !chapter.text.trim() ? tr('reviewNeedsText') : undefined} onClick={() => {chooseAction(key);}}>{tr(key)}<ArrowRight size={14}/></button>)}</div>
                    <p className="novel-prompt-help">{tr('promptHelp')}</p>
                    <label className="novel-instruction-label" htmlFor="novel-instruction">{tr('instruction')}<span className="novel-action-badge">{tr(selectedAction)}</span></label><textarea ref={instructionRef} id="novel-instruction" maxLength={3000} value={instruction} onChange={event => setInstruction(event.target.value)} placeholder={taskGuidance || tr('instructionPlaceholder')}/>
                    {busy ? <button className="modal-action-cancel" onClick={() => controller.current?.abort()}><LoaderCircle className="novel-spinner" size={15}/>{tr('cancel')}</button> : <button className="modal-action-submit" disabled={!writingRequest || (tab === 'bible' && selectedAction === 'synthesis' && !(story.settingsCandidates ?? []).some(candidate => candidate.selected))} onClick={() => void generate(writingRequest)}><Sparkles size={15}/>{tr('generate')}</button>}
</div>}

                    {error && <p role="alert" className="novel-error">{error}</p>}
                </aside>) : null}>
        {exporting && <p className="novel-export-status" role="status">{tr('exporting')}</p>}
        {loading && <p className="novel-storage-error" role="status">{tr('loadingStories')}</p>}
        {(saveStatus === 'error' || loadFailed) && <div className="novel-storage-error" role="alert">{tr(loadFailed ? 'loadError' : 'saveError')} <button className="modal-action-cancel" onClick={() => {if (loadFailed) void reload(); else void flushStorySaves().catch(() => {});}}>{tr('retry')}</button></div>}
        {story && (
                <main className="novel-writing">
                    {responseVisible ? <ProposalReader key={`${proposalTarget}:${proposalAction}`} text={proposal} action={proposalAction} busy={busy} onChange={setProposal} onBack={() => {setProposal(''); setResponseVisible(false);}}/> : <>
                    <div className="novel-paper">{tab === 'text' ? <><input className="novel-chapter-title" aria-label={tr('chapterTitle')} maxLength={200} value={chapter.title} onChange={event => updateChapter({title: event.target.value})}/><textarea className="novel-manuscript" aria-label={tr('text')} maxLength={1000000} placeholder={tr('manuscriptPlaceholder')} value={chapter.text} onChange={event => {updateChapter({text: event.target.value}); setUndo(null);}}/></> : <SettingsPlanner candidates={story.settingsCandidates ?? []} disabled={busy} onChange={settingsCandidates => updateStory({settingsCandidates})} onChoose={category => chooseAction(category)} activeCategory={SETTING_CATEGORIES.includes(selectedAction as SettingCategory) ? selectedAction as SettingCategory : undefined} onSynthesize={() => chooseAction('synthesis')}>
                        <textarea className="novel-final-settings" aria-label={tr('bible')} placeholder={tr('finalSettingsPlaceholder')} maxLength={20000} value={story.bible} onChange={event => {updateStory({bible: event.target.value}); setUndo(null);}}/>
                    </SettingsPlanner>}</div>
                    <footer className="novel-writing-footer"><span>{t('novelStudio.characters', {count: Array.from(tab === 'bible' ? story.bible : chapter.text).length})}</span>{undo?.chapterId === chapter.id && undo.target === tab && <button onClick={() => {if (undo.target === 'bible') updateStory({bible: undo.text}); else updateChapter({text: undo.text}); setUndo(null);}}><Undo2 size={14}/>{tr('undo')}</button>}<span>{tr('draft')}</span></footer>
                    </>}
                </main>)}
        {confirmFinal && <ConfirmModal title={tr('applyFinal')} description={tr('replaceFinalHelp')} options={[{label: tr('keep'), value: 'cancel'}, {label: tr('applyFinal'), value: 'apply', variant: 'primary'}]} onClose={() => setConfirmFinal(false)} onSelect={value => {if (value === 'apply') applyFinalSettings(); else setConfirmFinal(false);}}/>}
    </WorkspaceLayout>;
}
