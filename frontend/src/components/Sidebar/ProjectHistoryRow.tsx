import type {CSSProperties, ReactNode} from 'react';
import {BookOpen, Folder, FolderOpen, MoreHorizontal, Pencil, ScrollText, SquarePen, Trash2} from 'lucide-react';
import type {Project} from '../../types';
import SidebarOverflowMenu from './SidebarOverflowMenu';
import {getProjectDisplayColor} from './projectColors';

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
    deleteHistoryLabel: string;
    projectInstructionsLabel: string;
    projectEditLabel: string;
    projectMemoryLabel: string;
    onToggle: () => void;
    onNewConversation: () => void;
    onMenuOpenChange: (isOpen: boolean) => void;
    onRenameValueChange: (value: string) => void;
    onRenameSubmit: () => void;
    onRenameCancel: () => void;
    onRename: () => void;
    onEditInstructions: () => void;
    onOpenMemory: () => void;
    onEditProject: () => void;
    onDelete: () => void;
    onDeleteHistory: () => void;
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
    deleteHistoryLabel,
    projectInstructionsLabel,
    projectEditLabel,
    projectMemoryLabel,
    onToggle,
    onNewConversation,
    onMenuOpenChange,
    onRename,
    onRenameValueChange,
    onRenameSubmit,
    onRenameCancel,
    onEditInstructions,
    onOpenMemory,
    onEditProject,
    onDelete,
    onDeleteHistory,
    children,
}: ProjectHistoryRowProps) => {
    const FolderIcon = isExpanded ? FolderOpen : Folder;
    const projectColor = getProjectDisplayColor(project.color);

    return (
        <div>
            <div className={`project-row${isActive ? ' active' : ''}`} style={{'--project-color': projectColor} as CSSProperties} onClick={onToggle}>
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
                        <FolderIcon size={15} style={{color: projectColor}}/>
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
                        <button className="hist-menu-item" onClick={onOpenMemory}><BookOpen size={13}/>{projectMemoryLabel}</button>
                        <button className="hist-menu-item danger" onClick={onDeleteHistory}><Trash2 size={13}/>{deleteHistoryLabel}</button>
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
