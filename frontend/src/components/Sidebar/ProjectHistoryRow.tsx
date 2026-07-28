import type {CSSProperties, ReactNode} from 'react';
import {Folder, FolderOpen, MoreHorizontal, Pencil, ScrollText, SquarePen, Trash2} from 'lucide-react';
import type {Project} from '../../types';
import SidebarOverflowMenu from './SidebarOverflowMenu';

interface ProjectHistoryRowProps {
    project: Project;
    isActive: boolean;
    isExpanded: boolean;
    isMenuOpen: boolean;
    isRenaming: boolean;
    renameValue: string;
    newChatLabel: string;
    renameLabel: string;
    deleteLabel: string;
    projectInstructionsLabel: string;
    projectEditLabel: string;
    onToggle: () => void;
    onNewConversation: () => void;
    onMenuOpenChange: (isOpen: boolean) => void;
    onRenameValueChange: (value: string) => void;
    onRenameSubmit: () => void;
    onRenameCancel: () => void;
    onRename: () => void;
    onEditInstructions: () => void;
    onEditProject: () => void;
    onDelete: () => void;
    children: ReactNode;
}

const ProjectHistoryRow = ({
    project,
    isActive,
    isExpanded,
    isMenuOpen,
    isRenaming,
    renameValue,
    newChatLabel,
    renameLabel,
    deleteLabel,
    projectInstructionsLabel,
    projectEditLabel,
    onToggle,
    onNewConversation,
    onMenuOpenChange,
    onRename,
    onRenameValueChange,
    onRenameSubmit,
    onRenameCancel,
    onEditInstructions,
    onEditProject,
    onDelete,
    children,
}: ProjectHistoryRowProps) => {
    const FolderIcon = isExpanded ? FolderOpen : Folder;

    return (
        <div>
            <div className={`project-row${isActive ? ' active' : ''}`} style={{'--project-color': project.color ?? 'var(--project-active)'} as CSSProperties} onClick={onToggle}>
                {isRenaming ? (
                    <input
                        className="hist-rename-input"
                        autoFocus
                        value={renameValue}
                        onChange={event => onRenameValueChange(event.target.value)}
                        onClick={event => event.stopPropagation()}
                        onKeyDown={event => {
                            if (event.key === 'Enter') event.currentTarget.blur();
                            if (event.key === 'Escape') onRenameCancel();
                        }}
                        onBlur={onRenameSubmit}
                    />
                ) : (
                    <button className="project-select-btn" aria-expanded={isExpanded}>
                        <FolderIcon size={15} style={{color: project.color ?? 'var(--project-active)'}}/>
                        {project.name}
                    </button>
                )}
                {!isRenaming && <div className={`project-row-actions${isMenuOpen ? ' open' : ''}`}>
                    <SidebarOverflowMenu
                        isOpen={isMenuOpen}
                        onOpenChange={onMenuOpenChange}
                        trigger={<MoreHorizontal size={17}/>}
                        className="project-menu-anchor"
                    >
                        <button className="hist-menu-item" onClick={onEditProject}><SquarePen size={13}/>{projectEditLabel}</button>
                        <button className="hist-menu-item" onClick={onRename}><Pencil size={13}/>{renameLabel}</button>
                        <button className="hist-menu-item" onClick={onEditInstructions}><ScrollText size={13}/>{projectInstructionsLabel}</button>
                        <button className="hist-menu-item danger" onClick={onDelete}><Trash2 size={13}/>{deleteLabel}</button>
                    </SidebarOverflowMenu>
                    <button
                        aria-label={newChatLabel}
                        onClick={event => {
                            event.stopPropagation();
                            onNewConversation();
                        }}
                    >
                        <SquarePen size={14}/>
                    </button>
                </div>
                }
            </div>
            {isExpanded && children}
        </div>
    );
};

export default ProjectHistoryRow;
