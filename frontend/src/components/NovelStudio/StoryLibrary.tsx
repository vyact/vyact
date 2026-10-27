import {useRef, useState} from 'react';
import {BookOpen, MoreHorizontal, Pencil, Trash2, Download} from 'lucide-react';
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
    onExport: (story: Story, format: NovelExportFormat) => void;
}

export default function StoryLibrary({stories, activeId, disabled, onSelect, onRename, onDelete, onExport}: StoryLibraryProps) {
    const {t} = useTranslation('main');
    const [menuId, setMenuId] = useState<string | null>(null);
    const [renamingId, setRenamingId] = useState<string | null>(null);
    const [name, setName] = useState('');
    const [deleting, setDeleting] = useState<Story | null>(null);
    const cancelled = useRef(false);
    const commitRename = () => {
        if (!cancelled.current && renamingId && name.trim()) onRename(renamingId, name.trim());
        setRenamingId(null);
    };
    return <div className="novel-story-list">
        {stories.map(story => <div className={`novel-story-row${story.id === activeId ? ' selected' : ''}`} key={story.id}>
            {renamingId === story.id ? <input className="novel-rename-input" aria-label={t('novelStudio.storyTitle')} autoFocus maxLength={200} value={name}
                onFocus={event => event.target.select()} onChange={event => setName(event.target.value)} onBlur={commitRename}
                onKeyDown={event => {
                    if (event.key === 'Enter') {event.preventDefault(); event.currentTarget.blur();}
                    if (event.key === 'Escape') {event.preventDefault(); event.stopPropagation(); cancelled.current = true; setRenamingId(null);}
                }}/>
                : <button className="novel-story" disabled={disabled} onClick={() => onSelect(story.id)}><BookOpen size={16}/><span>{story.title || t('novelStudio.untitled')}</span></button>}
            <ActionMenu isOpen={menuId === story.id} onOpenChange={open => setMenuId(open ? story.id : null)} disabled={disabled}
                trigger={<MoreHorizontal size={15}/>} ariaLabel={t('novelStudio.storyActions', {title: story.title})} triggerClassName="titlebar-btn novel-story-menu" menuClassName="hist-menu-popup">
                <button className="hist-menu-item" onClick={() => {setMenuId(null); cancelled.current = false; setName(story.title); setRenamingId(story.id);}}><Pencil size={14}/>{t('novelStudio.rename')}</button>
                {(['pdf', 'md'] as const).map(format => <button key={format} className="hist-menu-item" onClick={() => {setMenuId(null); onExport(story, format);}}><Download size={14}/>{t('novelStudio.downloadArchive', {format: format.toUpperCase()})}</button>)}
                <button className="hist-menu-item danger" onClick={() => {setMenuId(null); setDeleting(story);}}><Trash2 size={14}/>{t('novelStudio.delete')}</button>
            </ActionMenu>
        </div>)}
        {deleting && <ConfirmModal title={t('novelStudio.deleteTitle')} description={t('novelStudio.deleteDescription', {title: deleting.title})}
            options={[{label: t('novelStudio.keep'), value: 'cancel'}, {label: t('novelStudio.delete'), value: 'delete', variant: 'danger'}]}
            onClose={() => setDeleting(null)} onSelect={value => {if (value === 'delete') onDelete(deleting.id); setDeleting(null);}}/>}
    </div>;
}
