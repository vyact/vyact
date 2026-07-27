import {useEffect, useState} from 'react';
import {ScrollText, X} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import ModalOverlay from '../common/ModalOverlay/ModalOverlay';
import type {Project} from '../../types';
import './ProjectInstructionsModal.css';

interface ProjectInstructionsModalProps {
    project: Project | null;
    onClose: () => void;
    onSave: (project: Project, projectPrompt: string) => Promise<void>;
}

const ProjectInstructionsModal = ({project, onClose, onSave}: ProjectInstructionsModalProps) => {
    const {t} = useTranslation('main');
    const [projectPrompt, setProjectPrompt] = useState('');
    const [isSaving, setIsSaving] = useState(false);

    useEffect(() => {
        setProjectPrompt(project?.project_prompt ?? '');
    }, [project]);

    if (!project) return null;

    const handleSave = async () => {
        setIsSaving(true);
        try {
            await onSave(project, projectPrompt);
            onClose();
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <ModalOverlay className="project-instructions-modal-overlay" onClose={onClose}>
            <div className="project-instructions-modal" onClick={event => event.stopPropagation()}>
                <header className="project-instructions-modal__header">
                    <div>
                        <span className="project-instructions-modal__eyebrow"><ScrollText size={15}/>{t('sidebar.projectInstructions.title')}</span>
                        <h2>{project.name}</h2>
                    </div>
                    <button className="project-instructions-modal__close" onClick={onClose} aria-label={t('sidebar.projectInstructions.close')}><X size={18}/></button>
                </header>
                <div className="project-instructions-modal__body">
                    <label htmlFor="project-instructions">{t('sidebar.projectInstructions.description')}</label>
                    <textarea
                        id="project-instructions"
                        value={projectPrompt}
                        onChange={event => setProjectPrompt(event.target.value)}
                        placeholder={t('sidebar.projectInstructions.placeholder')}
                        autoFocus
                    />
                </div>
                <footer className="project-instructions-modal__actions">
                    <button className="project-instructions-modal__cancel" onClick={onClose} disabled={isSaving}>{t('sidebar.projectInstructions.cancel')}</button>
                    <button className="project-instructions-modal__save" onClick={handleSave} disabled={isSaving}>{isSaving ? t('sidebar.projectInstructions.saving') : t('sidebar.projectInstructions.save')}</button>
                </footer>
            </div>
        </ModalOverlay>
    );
};

export default ProjectInstructionsModal;
