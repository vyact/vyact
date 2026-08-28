import React, { useState, useEffect } from 'react';
import {FilePlus2, Pencil, Plus, Sparkles, Trash2, X} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import {getSystemPromptTemplates} from './systemPromptTemplates';
import ModalOverlay from '../common/ModalOverlay/ModalOverlay';
import {toast} from '../common/ToastNotifications/ToastNotifications';
import './SystemPromptModal.css';

interface SystemPrompt {
    id: string;
    title: string;
    content: string;
}

interface SystemPromptModalProps {
    isOpen: boolean;
    prompts: SystemPrompt[];
    onClose: () => void;
    onCreate: (title: string, content: string) => Promise<void>;
    onUpdate: (id: string, title: string, content: string) => Promise<void>;
    onDelete: (id: string) => Promise<void>;
    onReorder: (promptIds: string[]) => Promise<void>;
}

const SystemPromptModal: React.FC<SystemPromptModalProps> = ({
    isOpen,
    prompts,
    onClose,
    onCreate,
    onUpdate,
    onDelete,
    onReorder,
}) => {
    const {t} = useTranslation('main');
    const [editingId, setEditingId] = useState<string | null>(null);
    const [title, setTitle] = useState('');
    const [content, setContent] = useState('');
    const [draggedPromptId, setDraggedPromptId] = useState<string | null>(null);
    const [dragOverPromptId, setDragOverPromptId] = useState<string | null>(null);
    const templates = getSystemPromptTemplates(t);

    // ESC 키로 닫기
    useEffect(() => {
        if (!isOpen) return;
        
        const handleEsc = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                onClose();
            }
        };
        document.addEventListener('keydown', handleEsc);
        return () => document.removeEventListener('keydown', handleEsc);
    }, [isOpen, onClose]);

    if (!isOpen) return null;

    const handleNew = () => {
        setEditingId('new');
        setTitle('');
        setContent('');
    };

    const handleEdit = (prompt: SystemPrompt) => {
        setEditingId(prompt.id);
        setTitle(prompt.title);
        setContent(prompt.content);
    };

    const handleSave = async () => {
        if (!title.trim() || !content.trim()) {
            toast.warning(t('systemPromptModal.validation'));
            return;
        }

        if (editingId === 'new') {
            await onCreate(title, content);
        } else if (editingId) {
            await onUpdate(editingId, title, content);
        }

        setEditingId(null);
        setTitle('');
        setContent('');
    };

    const handleDelete = async (id: string) => {
        if (!confirm(t('systemPromptModal.deleteConfirm'))) return;
        await onDelete(id);
        if (editingId === id) {
            setEditingId(null);
        }
    };

    const handleCancel = () => {
        setEditingId(null);
        setTitle('');
        setContent('');
    };

    const handleAddTemplate = async (templateKey: string) => {
        const template = templates.find(item => item.key === templateKey);
        if (!template) return;
        await onCreate(template.title, template.content);
    };

    const handleReorder = async (targetPromptId: string) => {
        if (!draggedPromptId || draggedPromptId === targetPromptId) return;
        const sourceIndex = prompts.findIndex(prompt => prompt.id === draggedPromptId);
        const targetIndex = prompts.findIndex(prompt => prompt.id === targetPromptId);
        if (sourceIndex < 0 || targetIndex < 0) return;
        const reorderedPrompts = [...prompts];
        const [movedPrompt] = reorderedPrompts.splice(sourceIndex, 1);
        reorderedPrompts.splice(targetIndex, 0, movedPrompt);
        try {
            await onReorder(reorderedPrompts.map(prompt => prompt.id));
        } finally {
            setDraggedPromptId(null);
            setDragOverPromptId(null);
        }
    };

    return (
        <ModalOverlay className="system-prompt-overlay" onClose={onClose} closeOnBackdrop>
            <div className="system-prompt-modal" onClick={(e) => e.stopPropagation()}>
                <div className="system-prompt-header">
                    <div>
                        <div className="system-prompt-eyebrow">{t('systemPromptModal.eyebrow')}</div>
                        <h2>{t('systemPromptModal.title')}</h2>
                        <p>{t('systemPromptModal.subtitle')}</p>
                    </div>
                    <button className="system-prompt-close" onClick={onClose} aria-label={t('systemPromptModal.close')}><X size={22}/></button>
                </div>

                <div className="system-prompt-body">
                    {!editingId && (
                        <>
                            <section className="system-template-section">
                                <div className="system-section-heading"><Sparkles size={16}/><span>{t('systemPromptModal.templatesTitle')}</span></div>
                                <p>{t('systemPromptModal.templatesHint')}</p>
                                <div className="system-template-grid">
                                    {templates.map(template => {
                                        const alreadyAdded = prompts.some(prompt => prompt.title === template.title);
                                        return <button key={template.key} className="system-template-card" onClick={() => handleAddTemplate(template.key)} disabled={alreadyAdded}>
                                            <span className="system-template-copy"><strong>{template.title}</strong><small>{template.description}</small></span>
                                            <span className="system-template-action">{alreadyAdded ? t('systemPromptModal.added') : <Plus size={16}/>}</span>
                                        </button>;
                                    })}
                                </div>
                            </section>
                            <section className="system-saved-section">
                                <div className="system-section-heading"><FilePlus2 size={16}/><span>{t('systemPromptModal.savedTitle')}</span></div>
                                <div className="system-prompt-list">
                                {prompts.length === 0 ? (
                                    <div className="system-prompt-empty">{t('systemPromptModal.empty')}</div>
                                ) : (
                                    prompts.map((prompt) => (
                                        <div key={prompt.id} draggable onDragStart={() => setDraggedPromptId(prompt.id)} onDragOver={event => { event.preventDefault(); if (prompt.id !== draggedPromptId) setDragOverPromptId(prompt.id); }} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragOverPromptId(current => current === prompt.id ? null : current); }} onDrop={() => void handleReorder(prompt.id)} onDragEnd={() => { setDraggedPromptId(null); setDragOverPromptId(null); }} className={`system-prompt-item system-prompt-draggable${draggedPromptId === prompt.id ? ' dragging' : ''}${dragOverPromptId === prompt.id ? ' drag-over' : ''}`}>
                                            <button className="system-prompt-info" onClick={() => handleEdit(prompt)}>
                                                <span className="system-prompt-item-title">{prompt.title}</span>
                                                <span className="system-prompt-preview">{prompt.content}</span>
                                            </button>
                                            <button className="system-prompt-edit" onClick={() => handleEdit(prompt)} aria-label={t('systemPromptModal.edit')}><Pencil size={16}/></button>
                                            <button
                                                className="system-prompt-delete"
                                                onClick={() => handleDelete(prompt.id)}
                                                aria-label={t('systemPromptModal.delete')}
                                            ><Trash2 size={16}/></button>
                                        </div>
                                    ))
                                )}
                                </div>
                            </section>

                            <button className="system-new-prompt" onClick={handleNew}>
                                <Plus size={17}/>{t('systemPromptModal.newPrompt')}
                            </button>
                        </>
                    )}

                    {editingId && (
                        <div className="system-prompt-editor">
                            <div className="system-editor-heading">{editingId === 'new' ? t('systemPromptModal.newPrompt') : t('systemPromptModal.editPrompt')}</div>
                            <label htmlFor="system-prompt-title">{t('systemPromptModal.nameLabel')}</label>
                            <input
                                id="system-prompt-title"
                                type="text"
                                className="system-editor-title"
                                placeholder={t('systemPromptModal.namePlaceholder')}
                                value={title}
                                onChange={(e) => setTitle(e.target.value)}
                            />
                            <label htmlFor="system-prompt-content">{t('systemPromptModal.contentLabel')}</label>
                            <textarea
                                id="system-prompt-content"
                                className="system-editor-content"
                                placeholder={t('systemPromptModal.contentPlaceholder')}
                                value={content}
                                onChange={(e) => setContent(e.target.value)}
                                rows={10}
                            />
                            <div className="system-editor-actions">
                                <button className="system-cancel" onClick={handleCancel}>
                                    {t('systemPromptModal.cancel')}
                                </button>
                                <button className="system-save" onClick={handleSave}>
                                    {t('systemPromptModal.save')}
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </ModalOverlay>
    );
};

export default SystemPromptModal;
