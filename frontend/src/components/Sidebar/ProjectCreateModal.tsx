import {useState} from 'react';
import {Folder, FolderPlus, Trash2, X} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import ModalOverlay from '../common/ModalOverlay/ModalOverlay';
import type {Project} from '../../types';
import './ProjectCreateModal.css';

const PROJECT_COLORS = ['#f5f5f5', '#ff6468', '#ff8a4c', '#ffd342', '#42c978', '#3696ed', '#9d6af1', '#ef7abb'];

type DirectoryPickerWindow = Window & {
    showDirectoryPicker?: (options?: {mode?: 'read' | 'readwrite'}) => Promise<{name: string}>;
};

interface ProjectCreateModalProps {
    onClose: () => void;
    project?: Project | null;
    onSubmit: (name: string, folderPaths: string[], color: string) => Promise<void>;
}

const getFolderName = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() || path;

const ProjectCreateModal = ({onClose, project, onSubmit}: ProjectCreateModalProps) => {
    const {t} = useTranslation('main');
    const [name, setName] = useState(project?.name ?? '');
    const [folderPaths, setFolderPaths] = useState<string[]>(project?.folder_paths ?? []);
    const [color, setColor] = useState(project?.color ?? PROJECT_COLORS[0]);
    const [isColorPickerOpen, setIsColorPickerOpen] = useState(false);
    const [isCreating, setIsCreating] = useState(false);

    const addFolders = async () => {
        if (window.ragAPI?.selectFolders) {
            const selectedPaths = await window.ragAPI.selectFolders();
            setFolderPaths(paths => [...new Set([...paths, ...selectedPaths])]);
            if (!name.trim() && selectedPaths[0]) setName(getFolderName(selectedPaths[0]));
            return;
        }
        const picker = (window as DirectoryPickerWindow).showDirectoryPicker;
        if (!picker) return;
        try {
            const folder = await picker({mode: 'readwrite'});
            setFolderPaths(paths => [...new Set([...paths, folder.name])]);
            if (!name.trim()) setName(folder.name);
        } catch (error) {
            if ((error as DOMException).name !== 'AbortError') throw error;
        }
    };

    const handleCreate = async () => {
        const trimmedName = name.trim() || (folderPaths[0] ? getFolderName(folderPaths[0]) : '');
        if (!trimmedName || isCreating) return;
        setIsCreating(true);
        try {
            await onSubmit(trimmedName, folderPaths, color);
            onClose();
        } finally {
            setIsCreating(false);
        }
    };

    return <ModalOverlay className="project-create-modal-overlay" onClose={onClose}>
        <div className="project-create-modal" onClick={event => event.stopPropagation()}>
            <header className="project-create-modal__header">
                <h2>{project ? t('sidebar.projectEdit') : t('sidebar.projectCreate.title')}</h2>
                <button onClick={onClose} aria-label={t('sidebar.projectCreate.close')}><X size={20}/></button>
            </header>
            <div className="project-create-modal__body">
                <div className="project-name-field">
                    <button className="project-color-button" style={{'--project-color': color} as React.CSSProperties} onClick={() => setIsColorPickerOpen(open => !open)} aria-label={t('sidebar.projectCreate.chooseColor')}><Folder size={22}/></button>
                    <input value={name} onChange={event => setName(event.target.value)} placeholder={t('sidebar.projectCreate.namePlaceholder')} autoFocus onKeyDown={event => { if (event.key === 'Enter') void handleCreate(); }}/>
                    {isColorPickerOpen && <div className="project-color-picker" role="listbox" aria-label={t('sidebar.projectCreate.chooseColor')}>
                        {PROJECT_COLORS.map(item => <button key={item} className={item === color ? 'selected' : ''} style={{backgroundColor: item}} onClick={() => { setColor(item); setIsColorPickerOpen(false); }} aria-label={item}/>) }
                    </div>}
                </div>
                <section className="project-source-folders">
                    <h3>{t('sidebar.projectCreate.sourceFolders')}</h3>
                    <button className="project-folder-picker" onClick={() => void addFolders()}>
                        <FolderPlus size={26}/><span>{t('sidebar.projectCreate.addFolders')}</span>
                    </button>
                    {folderPaths.length > 0 && <ul className="project-folder-list">
                        {folderPaths.map(path => <li key={path}><span title={path}>{path}</span><button onClick={() => setFolderPaths(paths => paths.filter(item => item !== path))} aria-label={t('sidebar.projectCreate.removeFolder', {path})}><Trash2 size={15}/></button></li>)}
                    </ul>}
                </section>
            </div>
            <footer className="project-create-modal__actions">
                <button className="project-create-modal__cancel" onClick={onClose} disabled={isCreating}>{t('sidebar.projectCreate.cancel')}</button>
                <button className="project-create-modal__submit" onClick={() => void handleCreate()} disabled={(!name.trim() && !folderPaths.length) || isCreating}>{isCreating ? t('sidebar.projectCreate.creating') : (project ? t('sidebar.projectInstructions.save') : t('sidebar.projectCreate.create'))}</button>
            </footer>
        </div>
    </ModalOverlay>;
};

export default ProjectCreateModal;
