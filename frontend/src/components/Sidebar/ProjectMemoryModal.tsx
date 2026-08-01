import {useEffect, useState} from 'react';
import {BookOpen, CheckCircle2, Circle, Trash2, X} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import ModalOverlay from '../common/ModalOverlay/ModalOverlay';
import {api} from '../../services/api';
import type {Project, ProjectMemory, ProjectMemoryItem} from '../../types';
import './ProjectMemoryModal.css';

interface ProjectMemoryModalProps { project: Project | null; onClose: () => void; }

const ProjectMemoryModal = ({project, onClose}: ProjectMemoryModalProps) => {
    const {t} = useTranslation('main');
    const [memory, setMemory] = useState<ProjectMemory | null>(null);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (!project) return;
        setLoading(true);
        api.getProjectMemory(project.id).then(setMemory).finally(() => setLoading(false));
    }, [project]);

    if (!project) return null;

    const updateItem = async (type: 'decision' | 'action_item', item: ProjectMemoryItem) => {
        const status = item.status === 'completed' ? 'active' : 'completed';
        setMemory(await api.updateProjectMemoryItem(project.id, type, item.id, {status}));
    };
    const deleteItem = async (type: 'decision' | 'action_item', itemId: string) => {
        setMemory(await api.deleteProjectMemoryItem(project.id, type, itemId));
    };
    const renderItems = (type: 'decision' | 'action_item', items: ProjectMemoryItem[]) => items.length ? (
        <div className="project-memory-modal__list">{items.map(item => (
            <div className={`project-memory-modal__item${item.status === 'completed' ? ' completed' : ''}`} key={item.id}>
                <button className="project-memory-modal__status" onClick={() => updateItem(type, item)} aria-label={t(item.status === 'completed' ? 'sidebar.projectMemory.markActive' : 'sidebar.projectMemory.markCompleted')}>
                    {item.status === 'completed' ? <CheckCircle2 size={18}/> : <Circle size={18}/>} 
                </button>
                <div><span>{item.text}</span>{(item.owner || item.due_date) && <small>{[item.owner, item.due_date].filter(Boolean).join(' · ')}</small>}</div>
                <button className="project-memory-modal__delete" onClick={() => deleteItem(type, item.id)} aria-label={t('sidebar.projectMemory.delete')}><Trash2 size={15}/></button>
            </div>
        ))}</div>
    ) : <p className="project-memory-modal__empty">{t('sidebar.projectMemory.noItems')}</p>;

    return <ModalOverlay className="project-memory-modal-overlay" onClose={onClose}>
        <div className="project-memory-modal" onClick={event => event.stopPropagation()}>
            <header className="project-memory-modal__header"><div><span className="project-memory-modal__eyebrow"><BookOpen size={15}/>{t('sidebar.projectMemory.title')}</span><h2>{project.name}</h2></div><button className="project-memory-modal__close" onClick={onClose} aria-label={t('sidebar.projectMemory.close')}><X size={18}/></button></header>
            <div className="project-memory-modal__body">
                {loading && <p className="project-memory-modal__empty">{t('sidebar.projectMemory.loading')}</p>}
                {!loading && memory && <>
                    <section><h3>{t('sidebar.projectMemory.summary')}</h3><p className="project-memory-modal__summary">{memory.summary || t('sidebar.projectMemory.noSummary')}</p></section>
                    <section><h3>{t('sidebar.projectMemory.decisions')}</h3>{renderItems('decision', memory.decisions)}</section>
                    <section><h3>{t('sidebar.projectMemory.actionItems')}</h3>{renderItems('action_item', memory.action_items)}</section>
                    <p className="project-memory-modal__note">{t('sidebar.projectMemory.localNote')}</p>
                </>}
            </div>
        </div>
    </ModalOverlay>;
};

export default ProjectMemoryModal;
