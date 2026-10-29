import useScrollActivity from '../common/hooks/useScrollActivity';
import TitleSuggestionModal from './TitleSuggestionModal';
import {useRef, useState} from 'react';
import {BookOpen, MoreHorizontal, Pencil, Trash2, Download, Sparkles, Plus, Check, X} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import ActionMenu from '../common/ActionMenu/ActionMenu';
import ConfirmModal from '../common/ConfirmModal/ConfirmModal';
import type {NovelExportFormat} from './storyExport';
import type {Story} from './storyStorage';

interface StoryLibraryProps {
    stories: Story[];
    activeId: string;
    disabled: boolean;
    onSelect: (id: string) => void;
    onRename: (id: string, title: string) => void;
    onDelete: (id: string) => void;
    onDeleteMany: (ids: string[]) => void;
    onCreate: () => void;
    onExport: (story: Story, format: NovelExportFormat) => void;
}

export default function StoryLibrary({stories, activeId, disabled, onSelect, onRename, onDelete, onExport, onDeleteMany, onCreate}: StoryLibraryProps) {
    const {t} = useTranslation('main');
    const {scrolling, onScroll} = useScrollActivity();
    const [menuId, setMenuId] = useState<string | null>(null);
    const [renamingId, setRenamingId] = useState<string | null>(null);
    const [name, setName] = useState('');
    const [recommending, setRecommending] = useState<Story | null>(null);
    const [deleting, setDeleting] = useState<Story | null>(null);
    const [selecting, setSelecting] = useState(false);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
    const selectedStories = stories.filter(story => selectedIds.has(story.id));
    const toggleSelected = (id: string) => setSelectedIds(previous => {const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next;});
    const cancelled = useRef(false);
    const commitRename = () => {
        if (!cancelled.current && renamingId && name.trim()) onRename(renamingId, name.trim());
        setRenamingId(null);
    };
    return <><div className="novel-section-heading"><span>{t('novelStudio.library')}</span><div className="novel-library-actions">{selecting ? <>
        <button type="button" className="titlebar-btn" disabled={disabled} aria-label={t('novelStudio.cancelEdit')} onClick={() => {setSelecting(false); setSelectedIds(new Set());}}><X size={16}/></button>
        <button type="button" className="novel-bulk-done" disabled={disabled || !selectedStories.length} onClick={() => setConfirmBulkDelete(true)}><Check size={14}/>{t('novelStudio.bulkDelete.done', {count: selectedStories.length})}</button>
    </> : <><button type="button" className="titlebar-btn" disabled={disabled || !stories.length} aria-label={t('novelStudio.bulkDelete.select')} onClick={() => {setMenuId(null); setRenamingId(null); setSelectedIds(new Set()); setSelecting(true);}}><Trash2 size={16}/></button><button type="button" className="titlebar-btn" disabled={disabled} aria-label={t('novelStudio.newStory')} onClick={onCreate}><Plus size={16}/></button></>}</div></div><div className={`novel-story-list${scrolling ? ' is-scrolling' : ''}`} onScroll={onScroll}>
        {stories.map(story => <div className={`novel-story-row${story.id === activeId ? ' selected' : ''}`} key={story.id}>
            {selecting && <input type="checkbox" className="novel-story-checkbox" disabled={disabled} aria-label={t('novelStudio.bulkDelete.selectStory', {title: story.title})} checked={selectedIds.has(story.id)} onChange={() => toggleSelected(story.id)}/>}
            {renamingId === story.id ? <input className="novel-rename-input" aria-label={t('novelStudio.storyTitle')} autoFocus maxLength={200} value={name}
                onFocus={event => event.target.select()} onChange={event => setName(event.target.value)} onBlur={commitRename}
                onKeyDown={event => {
                    if (event.key === 'Enter') {event.preventDefault(); event.currentTarget.blur();}
                    if (event.key === 'Escape') {event.preventDefault(); event.stopPropagation(); cancelled.current = true; setRenamingId(null);}
                }}/>
                : <button className="novel-story" disabled={disabled} onClick={() => selecting ? toggleSelected(story.id) : onSelect(story.id)}><BookOpen size={16}/><span>{story.title || t('novelStudio.untitled')}</span></button>}
            {!selecting && <ActionMenu isOpen={menuId === story.id} onOpenChange={open => setMenuId(open ? story.id : null)} disabled={disabled}
                trigger={<MoreHorizontal size={15}/>} ariaLabel={t('novelStudio.storyActions', {title: story.title})} triggerClassName="hist-menu-btn novel-story-menu" menuClassName="hist-menu-popup">
                <button className="hist-menu-item" onClick={() => {setMenuId(null); cancelled.current = false; setName(story.title); setRenamingId(story.id);}}><Pencil size={14}/>{t('novelStudio.rename')}</button>
                <button className="hist-menu-item" onClick={() => {setMenuId(null); setRecommending(story);}}><Sparkles size={14}/>{t('novelStudio.titleSuggestions.title')}</button>
                {(['pdf', 'md'] as const).map(format => <button key={format} className="hist-menu-item" onClick={() => {setMenuId(null); onExport(story, format);}}><Download size={14}/>{t('novelStudio.downloadArchive', {format: format.toUpperCase()})}</button>)}
                <button className="hist-menu-item danger" onClick={() => {setMenuId(null); setDeleting(story);}}><Trash2 size={14}/>{t('novelStudio.delete')}</button>
            </ActionMenu>}
        </div>)}
        {recommending && <TitleSuggestionModal key={recommending.id} story={recommending} onClose={() => setRecommending(null)} onApply={title => onRename(recommending.id, title)}/>}
        {deleting && <ConfirmModal actionLayout="horizontal" title={t('novelStudio.deleteTitle')} description={t('novelStudio.deleteDescription', {title: deleting.title})}
            options={[{label: t('novelStudio.keep'), value: 'cancel'}, {label: t('novelStudio.delete'), value: 'delete', variant: 'danger'}]}
            onClose={() => setDeleting(null)} onSelect={value => {if (value === 'delete') onDelete(deleting.id); setDeleting(null);}}/>}
        {confirmBulkDelete && <ConfirmModal actionLayout="horizontal" title={t('novelStudio.bulkDelete.title')} description={t('novelStudio.bulkDelete.description', {count: selectedStories.length})}
            options={[{label: t('novelStudio.keep'), value: 'cancel'}, {label: t('novelStudio.delete'), value: 'delete', variant: 'danger'}]}
            onClose={() => setConfirmBulkDelete(false)} onSelect={value => {if (value === 'delete' && !disabled) {onDeleteMany(selectedStories.map(story => story.id)); setSelectedIds(new Set()); setSelecting(false);} setConfirmBulkDelete(false);}}/>}
    </div></>;
}
