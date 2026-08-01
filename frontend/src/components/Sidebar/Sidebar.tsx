import React, {useEffect, useState, useRef} from 'react';
import {useTranslation} from 'react-i18next';
import {Pencil, Trash2, FileText, FileCode, NotebookText, Plus, ChevronDown, SquarePen, LoaderCircle} from 'lucide-react';
import {renderMarkdown} from '../../utils/markdownUtils';
import ModelSelector from '../ModelSelector';
import {toast} from '../common/ToastNotifications/ToastNotifications';
import ProviderSettingsModal from '../ProviderSettingsModal/ProviderSettingsModal';
import SettingsModal from '../SettingsModal/SettingsModal';
import {api} from '../../services/api';
import type {Conversation, Project} from '../../types';
import CustomSelect from '../CustomSelect/CustomSelect';
import './Sidebar.css';
import ProjectHistoryRow from './ProjectHistoryRow';
import SidebarOverflowMenu from './SidebarOverflowMenu';
import ProjectInstructionsModal from './ProjectInstructionsModal';
import ProjectCreateModal from './ProjectCreateModal';
import ProjectMemoryModal from './ProjectMemoryModal';

interface SidebarProps {
    installed: string[];
    selectedModel: string;
    onModelChange: (model: string, needsDownload: boolean, modelType?: 'chat' | 'image_gen' | 'image_edit') => Promise<void> | void;
    onProviderChange: () => Promise<void>;
    onBeforeModelContextChange?: () => void;
    conversations: Conversation[];
    historyTotal?: number;
    onLoadMoreHistory?: () => void;
    activeConvId: string;
    activeConversationIds?: string[];
    onConversationSelect: (convId: string) => void;
    onConversationDelete: (convId: string) => void;
    onConversationRename: () => void;
    /** @deprecated 대화 요약은 자동 갱신되며 UI에서 노출하지 않는다. */
    onShowSummary?: (convId: string) => void;
    onNewConversation: () => void;
    onDeleteAllConversations: () => void;
    collapsed?: boolean;
    hoverOpen?: boolean;
    onHoverEnter?: () => void;
    onHoverLeave?: () => void;
    openSettings?: boolean;
    openSettingsTab?: string;
    onSettingsClosed?: () => void;
    activeProjectId?: string | null;
    onProjectChange?: (projectId: string | null) => void;
}

const ProviderIcon: React.FC<{ provider: string; active: boolean }> = ({provider, active}) => {
    const color = active ? '#fff' : 'var(--muted)';
    switch (provider) {
        case 'ollama':
            return (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="9" stroke={color} strokeWidth="1.8"/>
                    <circle cx="9" cy="11" r="1.5" fill={color}/>
                    <circle cx="15" cy="11" r="1.5" fill={color}/>
                    <path d="M9 15s1 1.5 3 1.5 3-1.5 3-1.5" stroke={color} strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
            );
        case 'openai':
            return (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                    <path d="M12 2L3 7v10l9 5 9-5V7z" stroke={color} strokeWidth="1.8" strokeLinejoin="round"/>
                    <path d="M3 7l9 5 9-5" stroke={color} strokeWidth="1.8"/>
                    <line x1="12" y1="12" x2="12" y2="22" stroke={color} strokeWidth="1.8"/>
                </svg>
            );
        case 'gemini':
            return (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                    <path d="M12 2C12 2 14 8 20 12C14 16 12 22 12 22C12 22 10 16 4 12C10 8 12 2 12 2Z"
                          stroke={color} strokeWidth="1.6" fill="none" strokeLinejoin="round"/>
                </svg>
            );
        case 'claude':
            return (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                    <path d="M12 3C7 3 3 7 3 12s4 9 9 9 9-4 9-9-4-9-9-9z" stroke={color} strokeWidth="1.8"/>
                    <path d="M8 12h8M12 8v8" stroke={color} strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
            );
        default:
            return null;
    }
};

const PROVIDER_LABELS: Record<string, string> = {
    ollama: 'Ollama', openai: 'OpenAI', gemini: 'Gemini', claude: 'Claude',
};

const EXPANDED_PROJECT_IDS_STORAGE_KEY = 'vyact-expanded-project-ids';
const PROJECT_HISTORY_PREVIEW_COUNT = 3;

function getStoredExpandedProjectIds(): Set<string> {
    try {
        const stored = JSON.parse(localStorage.getItem(EXPANDED_PROJECT_IDS_STORAGE_KEY) ?? '[]');
        return new Set(Array.isArray(stored) ? stored.filter((id): id is string => typeof id === 'string') : []);
    } catch {
        return new Set();
    }
}

function storeExpandedProjectIds(projectIds: Set<string>) {
    try {
        localStorage.setItem(EXPANDED_PROJECT_IDS_STORAGE_KEY, JSON.stringify([...projectIds]));
    } catch {
        // 저장소를 사용할 수 없는 환경에서는 현재 세션 상태만 유지한다.
    }
}

// ── 대화 내보내기 유틸 ─────────────────────────────────────
async function exportConversation(convId: string, title: string, format: 'pdf' | 'md') {
    const data = await api.getConversation(convId);
    const messages = data.messages || [];
    if (!messages.length) {
        toast.warning('대화 내용이 없습니다.');
        return;
    }

    const ts = new Date().toLocaleString('ko-KR');
    const safeTitle = title.replace(/[\\/:*?"<>|]/g, '_');

    // ── MD ──────────────────────────────────────────
    if (format === 'md') {
        const lines: string[] = [`# ${title}`, `> 내보낸 시각: ${ts}`, ''];
        for (const m of messages) {
            if (m.isError) continue;
            const label = m.role === 'user' ? '## 👤 사용자' : '## 🤖 어시스턴트';
            const mts = m.timestamp ? new Date(m.timestamp).toLocaleString('ko-KR') : '';
            lines.push(label + (mts ? `  _(${mts})_` : ''));
            lines.push('');
            lines.push(m.content);
            lines.push('');
            lines.push('---');
            lines.push('');
        }
        const blob = new Blob([lines.join('\n')], {type: 'text/markdown;charset=utf-8'});
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${safeTitle}.md`;
        a.click();
        URL.revokeObjectURL(url);
        return;
    }

    // ── PDF — renderMarkdown 활용 ────────────────────
    const rows = messages.filter(m => !m.isError).map(m => {
        const isUser = m.role === 'user';
        const mts = m.timestamp ? new Date(m.timestamp).toLocaleString('ko-KR') : '';
        const bodyHtml = isUser
            ? m.content.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>')
            : renderMarkdown(m.content);
        const msgStyle = isUser
            ? 'background:#282e3e;border:1px solid #3a4357;margin-left:auto;max-width:85%;border-radius:10px;padding:14px 16px;margin-bottom:12px'
            : 'background:#2a2a2a;border:1px solid #3a3a3a;width:100%;border-radius:10px;padding:14px 16px;margin-bottom:12px';
        const roleColor = isUser ? '#a78bfa' : '#cc785c';
        return `<div style="${msgStyle}">
            <div style="font-size:11px;font-weight:700;margin-bottom:8px;display:flex;justify-content:space-between;color:${roleColor}">
                <span>${isUser ? '👤 사용자' : '🤖 어시스턴트'}</span>
                ${mts ? `<span style="font-size:10px;color:#8e8e93;font-weight:400">${mts}</span>` : ''}
            </div>
            <div style="word-break:break-word;line-height:1.7;font-size:14px">${bodyHtml}</div>
        </div>`;
    }).join('');

    const html = `<!DOCTYPE html>
<html lang="ko"><head><meta charset="UTF-8">
<title>${title.replace(/</g, '&lt;')}</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css">
<style>
:root {
    --accent: #cc785c;
    --accent2: #a78bfa;
    --border: #3a3a3a;
    --surface: #2a2a2a;
    --surface2: #333;
    --text: #ececec;
    --muted: #8e8e93;
    --bg: #212121;
    --success: #4ade80;
    --r: 8px;
}
*{box-sizing:border-box;margin:0;padding:0}
html,body{
    background:#212121;color:#ececec;
    font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Noto Sans KR',sans-serif;
    font-size:14px;line-height:1.7;
    -webkit-print-color-adjust:exact;print-color-adjust:exact
}
@media print{@page{margin:20px 24px;size:A4}}
h1,h2,h3,h4{color:#ececec}
code{background:rgba(255,255,255,0.1);padding:1px 5px;border-radius:3px;font-family:monospace;font-size:0.9em}
pre{background:#0d1117;color:#c9d1d9;padding:12px;border-radius:8px;font-family:monospace;font-size:12px;margin:8px 0;white-space:pre-wrap;word-break:break-word;overflow-x:auto}
table{width:100%;border-collapse:collapse;margin:10px 0;font-size:13px}
th,td{border:1px solid var(--border);padding:8px 10px;text-align:left;vertical-align:top;word-break:break-word}
th{background:var(--surface2)}
a{color:var(--accent);text-decoration:underline}
ul,ol{padding-left:24px;margin:6px 0}
li{margin:3px 0;list-style-position:outside}
hr{border:none;border-top:1px solid var(--border);margin:10px 0;display:block}
br+hr,hr+br{display:none}
blockquote{border-left:3px solid var(--accent);padding:8px 14px;margin:10px 0;color:var(--muted);background:rgba(255,255,255,0.04);border-radius:0 6px 6px 0;font-style:italic}
.para-break{height:10px}
</style></head><body style="padding:20px 24px">
<div style="padding-bottom:14px;border-bottom:1px solid #4a4a4a;margin-bottom:20px">
    <div style="font-size:18px;font-weight:700;color:#ececec">${title.replace(/</g, '&lt;')}</div>
    <div style="font-size:11px;color:#8e8e93;margin-top:4px">내보낸 시각: ${ts} · 메시지 ${messages.length}개</div>
</div>
<div>${rows}</div>
</body></html>`;

    const win = window.open('', '_blank');
    if (!win) return;
    win.document.write(html);
    win.document.close();
    win.focus();
    setTimeout(() => {
        win.print();
        win.onafterprint = () => win.close();
    }, 400);
}

const Sidebar: React.FC<SidebarProps> = ({
                                             installed, selectedModel, onModelChange, onProviderChange,
                                             onBeforeModelContextChange,
                                             conversations, activeConvId, activeConversationIds = [], onConversationSelect, onConversationDelete,
                                             historyTotal = 0, onLoadMoreHistory,
                                             onDeleteAllConversations, onConversationRename, onNewConversation,
                                             onShowSummary = () => {},
                                             collapsed: collapsedProp,
                                             hoverOpen: hoverOpenProp,
                                             onHoverEnter,
                                             onHoverLeave,
                                             openSettings,
                                             openSettingsTab,
                                             onSettingsClosed,
                                             activeProjectId,
                                             onProjectChange,
                                         }) => {
    const {t} = useTranslation('main');
    const [collapsedInternal] = useState(true);
    const [projects, setProjects] = useState<Project[]>([]);
    const [isProjectCreateOpen, setIsProjectCreateOpen] = useState(false);
    const [editingProject, setEditingProject] = useState<Project | null>(null);
    const [projectsExpanded, setProjectsExpanded] = useState(() => localStorage.getItem('sidebar-projects-expanded') !== 'false');
    const [expandedProjectIds, setExpandedProjectIds] = useState<Set<string>>(getStoredExpandedProjectIds);
    const [expandedProjectHistoryIds, setExpandedProjectHistoryIds] = useState<Set<string>>(new Set());
    useEffect(() => { api.getProjects().then(data => setProjects(data.projects || [])).catch(console.error); }, []);
    const createProject = async (name: string, folderPaths: string[], color: string) => { const project = await api.createProject(name, folderPaths, color); setProjects(prev => [project, ...prev]); setProjectsExpanded(true); localStorage.setItem('sidebar-projects-expanded', 'true'); setExpandedProjectIds(previous => { const next = new Set(previous); next.add(project.id); storeExpandedProjectIds(next); return next; }); onProjectChange?.(project.id); onNewConversation(); };
    const saveProjectDetails = async (name: string, folderPaths: string[], color: string) => {
        if (!editingProject) return;
        const updated = await api.updateProject(editingProject.id, {name, folder_paths: folderPaths, color});
        setProjects(previous => previous.map(project => project.id === updated.id ? updated : project));
    };
    const toggleProjects = () => setProjectsExpanded(value => { const next = !value; localStorage.setItem('sidebar-projects-expanded', String(next)); return next; });
    const toggleProjectHistory = (projectId: string) => {
        setExpandedProjectIds(previous => {
            const next = new Set(previous);
            if (next.has(projectId)) {
                next.delete(projectId);
                setExpandedProjectHistoryIds(expanded => { const reset = new Set(expanded); reset.delete(projectId); return reset; });
            }
            else next.add(projectId);
            storeExpandedProjectIds(next);
            return next;
        });
    };
    const deleteProject = async (project: Project) => { if (!confirm(t('sidebar.deleteProjectConfirm', {name: project.name}))) return; await api.deleteProject(project.id); setProjects(prev => prev.filter(item => item.id !== project.id)); setExpandedProjectIds(previous => { const next = new Set(previous); next.delete(project.id); storeExpandedProjectIds(next); return next; }); setExpandedProjectHistoryIds(previous => { const next = new Set(previous); next.delete(project.id); return next; }); if (activeProjectId === project.id) onProjectChange?.(null); };
    const collapsed = collapsedProp !== undefined ? collapsedProp : collapsedInternal;

    const [isProviderSettingsOpen, setIsProviderSettingsOpen] = useState(false);
    const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
    const [projectMenuOpenId, setProjectMenuOpenId] = useState<string | null>(null);
    const [renamingId, setRenamingId] = useState<string | null>(null);
    const [renameValue, setRenameValue] = useState('');
    const [renamingProjectId, setRenamingProjectId] = useState<string | null>(null);
    const [projectRenameValue, setProjectRenameValue] = useState('');
    const [instructionsProject, setInstructionsProject] = useState<Project | null>(null);
    const [memoryProject, setMemoryProject] = useState<Project | null>(null);
    const loadMoreRef = useRef<HTMLDivElement>(null);
    const [loadingMore, setLoadingMore] = useState(false);
    const activeConversationIdSet = new Set(activeConversationIds);
    const saveProjectName = async (project: Project) => {
        const name = projectRenameValue.trim();
        setRenamingProjectId(null);
        if (!name || name === project.name) return;
        const updated = await api.updateProject(project.id, {name});
        setProjects(prev => prev.map(item => item.id === project.id ? updated : item));
    };
    const saveProjectPrompt = async (project: Project, projectPrompt: string) => {
        const updated = await api.updateProject(project.id, {project_prompt: projectPrompt});
        setProjects(prev => prev.map(item => item.id === project.id ? updated : item));
    };

    // 무한 스크롤: sentinel이 보이면 다음 페이지 자동 로드
    const hasMore = conversations.length < historyTotal;
    useEffect(() => {
        const el = loadMoreRef.current;
        if (!el || !hasMore) return;
        const io = new IntersectionObserver(async (entries) => {
            if (!entries[0].isIntersecting || loadingMore) return;
            setLoadingMore(true);
            try {
                await onLoadMoreHistory?.();
            } finally {
                setLoadingMore(false);
            }
        }, {root: el.closest('.hist-list'), rootMargin: '80px', threshold: 0});
        io.observe(el);
        return () => io.disconnect();
    }, [hasMore, loadingMore, onLoadMoreHistory]);
    const [isSettingsOpenInternal, setIsSettingsOpenInternal] = useState(false);
    const isSettingsOpen = openSettings || isSettingsOpenInternal;
    const setIsSettingsOpen = (v: boolean) => {
        setIsSettingsOpenInternal(v);
        if (!v) onSettingsClosed?.();
    };
    const [currentProvider, setCurrentProvider] = useState<'ollama' | 'openai' | 'gemini' | 'claude'>('ollama');



    useEffect(() => {
        loadCurrentProvider();
    }, []);

    const loadCurrentProvider = async () => {
        try {
            const data = await api.getProviders();
            setCurrentProvider(data.current_type || 'ollama');
        } catch {
            // The provider selector remains usable with its default value.
        }
    };

    const handleProviderChange = async (provider: 'ollama' | 'openai' | 'gemini' | 'claude') => {
        if (provider === currentProvider) return;
        const prev = currentProvider;
        try {
            if (provider === 'ollama') {
                onBeforeModelContextChange?.();
                await api.selectProvider('ollama');
                setCurrentProvider('ollama');
                await loadCurrentProvider();
                await onProviderChange();
            } else {
                const data = await api.getProviders();
                if (data.providers[provider]?.has_key) {
                    onBeforeModelContextChange?.();
                    await api.selectProvider(provider);
                    setCurrentProvider(provider);
                    await loadCurrentProvider();
                    await onProviderChange();
                } else {
                    setIsProviderSettingsOpen(true);
                    (window as any).__pendingProvider = provider;
                }
            }
        } catch {
            setCurrentProvider(prev);
        }
    };

    const handleProviderDelete = async (provider: 'openai' | 'gemini' | 'claude') => {
        if (!confirm(`${provider.toUpperCase()} 설정을 삭제하시겠습니까?`)) return;
        try {
            await api.deleteProvider(provider);
            await api.selectProvider('ollama');
            setCurrentProvider('ollama');
            await loadCurrentProvider();
            await onProviderChange();
        } catch (e) {
            toast.error('삭제 실패', String(e));
        }
    };

    const showOverlay = collapsed && !!hoverOpenProp;
    const visualCollapsed = collapsed && !showOverlay;

    return (
        <>
        {/* hover overlay 배경 */}
        {showOverlay && (
            <div className="sidebar-overlay-backdrop" onClick={onHoverLeave} />
        )}
        <aside
            className={`sidebar${collapsed ? ' sidebar--collapsed' : ''}${showOverlay ? ' sidebar--overlay' : ''}`}
            onMouseEnter={collapsed ? onHoverEnter : undefined}
            onMouseLeave={collapsed ? onHoverLeave : undefined}
        >

            {/* ── 토글 헤더 ── */}
            <div className="sidebar-toggle-header">
                {/* expanded: 설정 아이콘 */}
                {!visualCollapsed && (
                    <div className="sidebar-header-actions">
                        <div className="header-provider-wrap"><CustomSelect options={(['ollama', 'openai', 'gemini', 'claude'] as const).map(provider => ({value: provider, label: PROVIDER_LABELS[provider]}))} value={currentProvider} onChange={provider => handleProviderChange(provider as 'ollama' | 'openai' | 'gemini' | 'claude')} className="header-provider-select" /></div>
                        <button className="sidebar-header-settings" onClick={() => setIsSettingsOpen(true)}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                             strokeWidth="2">
                            <circle cx="12" cy="12" r="3"/>
                            <path
                                d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
                        </svg>
                        </button>
                    </div>
                )}
            </div>

            {/* ── expanded / overlay: 전체 ── */}
            {!visualCollapsed && (
                <>
                    <div className="aside-top">
                        {/* Provider */}
                        <div className="sidebar-section">
                            <div className="sec-label">Provider</div>
                            <div className="provider-select-wrap">
                                {(['ollama', 'openai', 'gemini', 'claude'] as const).map(p => (
                                    <button
                                        key={p}
                                        className={`provider-select-btn${currentProvider === p ? ' active' : ''}`}
                                        onClick={() => handleProviderChange(p)}
                                        title={PROVIDER_LABELS[p]}
                                    >
                                        <span className="provider-btn-icon">
                                            <ProviderIcon provider={p} active={currentProvider === p}/>
                                        </span>
                                        <span className="provider-btn-label">{PROVIDER_LABELS[p]}</span>
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* 모델 */}
                        <div className="sidebar-section">
                            <div className="sec-label">{t('sidebar.model')}</div>
                            <ModelSelector
                                installed={installed}
                                selectedModel={selectedModel}
                                currentProvider={currentProvider}
                                onModelChange={async (m, d, modelType) => await onModelChange(m, d, modelType)}
                                onProviderSettingsOpen={() => setIsProviderSettingsOpen(true)}
                                onProviderDelete={handleProviderDelete}
                            />
                        </div>

                    </div>

                    {/* 히스토리 */}
                    <div className="project-section project-section--history">
                        <div className="sec-label"><button className="project-collapse-btn" onClick={toggleProjects}>{t('sidebar.projects')} <ChevronDown size={15} className={projectsExpanded ? '' : 'closed'}/></button><button className="project-add-btn" onClick={() => setIsProjectCreateOpen(true)}><Plus size={16}/></button></div>
                        {projectsExpanded && projects.map(project => (
                            <ProjectHistoryRow
                                key={project.id}
                                project={project}
                                isActive={activeProjectId === project.id}
                                isExpanded={expandedProjectIds.has(project.id)}
                                isMenuOpen={projectMenuOpenId === project.id}
                                isRenaming={renamingProjectId === project.id}
                                renameValue={projectRenameValue}
                                newChatLabel={t('sidebar.newChat')}
                                renameLabel={t('sidebar.rename')}
                                deleteLabel={t('sidebar.delete')}
                                projectInstructionsLabel={t('sidebar.projectInstructions.title')}
                                projectEditLabel={t('sidebar.projectEdit')}
                                projectMemoryLabel={t('sidebar.projectMemory.title')}
                                onToggle={() => toggleProjectHistory(project.id)}
                                onNewConversation={() => { onProjectChange?.(project.id); onNewConversation(); }}
                                onMenuOpenChange={isOpen => setProjectMenuOpenId(isOpen ? project.id : null)}
                                onRename={() => { setProjectMenuOpenId(null); setProjectRenameValue(project.name); setRenamingProjectId(project.id); }}
                                onRenameValueChange={setProjectRenameValue}
                                onRenameSubmit={() => saveProjectName(project)}
                                onRenameCancel={() => setRenamingProjectId(null)}
                                onEditInstructions={() => { setProjectMenuOpenId(null); setInstructionsProject(project); }}
                                onOpenMemory={() => { setProjectMenuOpenId(null); setMemoryProject(project); }}
                                onEditProject={() => { setProjectMenuOpenId(null); setEditingProject(project); }}
                                onDelete={() => { setProjectMenuOpenId(null); deleteProject(project); }}
                            >
                                {conversations.filter(conv => conv.project_id === project.id).slice(0, expandedProjectHistoryIds.has(project.id) ? undefined : PROJECT_HISTORY_PREVIEW_COUNT).map(conv => <div key={conv.conv_id} className={`project-conversation${conv.conv_id === activeConvId ? ' active' : ''}`} onClick={() => { onProjectChange?.(project.id); onConversationSelect(conv.conv_id); }}><button className="project-conversation-title">{conv.title}</button>{activeConversationIdSet.has(conv.conv_id) && <span className="conversation-progress" role="status" aria-label={t('sidebar.responseInProgress')} title={t('sidebar.responseInProgress')}><LoaderCircle size={13}/></span>}<SidebarOverflowMenu isOpen={menuOpenId === conv.conv_id} onOpenChange={isOpen => setMenuOpenId(isOpen ? conv.conv_id : null)} trigger="···"><button className="hist-menu-item" onClick={() => { setMenuOpenId(null); onShowSummary(conv.conv_id); }}><NotebookText size={13}/>{t('sidebar.summary')}</button><button className="hist-menu-item" onClick={() => { setRenameValue(conv.title); setRenamingId(conv.conv_id); setMenuOpenId(null); }}><Pencil size={13}/>{t('sidebar.rename')}</button><button className="hist-menu-item" onClick={() => { setMenuOpenId(null); exportConversation(conv.conv_id, conv.title, 'md'); }}><FileCode size={13}/>{t('sidebar.exportMarkdown')}</button><button className="hist-menu-item" onClick={() => { setMenuOpenId(null); exportConversation(conv.conv_id, conv.title, 'pdf'); }}><FileText size={13}/>{t('sidebar.exportPdf')}</button><button className="hist-menu-item danger" onClick={() => { setMenuOpenId(null); onConversationDelete(conv.conv_id); }}><Trash2 size={13}/>{t('sidebar.delete')}</button></SidebarOverflowMenu></div>)}
                                {!expandedProjectHistoryIds.has(project.id) && conversations.filter(conv => conv.project_id === project.id).length > PROJECT_HISTORY_PREVIEW_COUNT && <button className="project-history-more" onClick={() => setExpandedProjectHistoryIds(previous => new Set(previous).add(project.id))}>{t('googleWorkspace.more')}</button>}
                            </ProjectHistoryRow>
                        ))}
                    </div>
                    <ProjectInstructionsModal project={instructionsProject} onClose={() => setInstructionsProject(null)} onSave={saveProjectPrompt}/>
                    <ProjectMemoryModal project={memoryProject} onClose={() => setMemoryProject(null)}/>
                    {isProjectCreateOpen && <ProjectCreateModal onClose={() => setIsProjectCreateOpen(false)} onSubmit={createProject}/>}
                    {editingProject && <ProjectCreateModal key={editingProject.id} project={editingProject} onClose={() => setEditingProject(null)} onSubmit={saveProjectDetails}/>}
                    <div className="aside-hist">
                        <div className="hist-header">
                            <div className="hist-actions">
                                {conversations.length > 0 && (
                                    <button
                                        className="btn-delete-all"
                                        onClick={() => {
                                            if (confirm(t('sidebar.deleteAllConfirm'))) onDeleteAllConversations();
                                        }}
                                    >
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                                             stroke="currentColor" strokeWidth="2">
                                            <polyline points="3 6 5 6 21 6"/>
                                            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                                            <path d="M10 11v6M14 11v6M9 6V4h6v2"/>
                                        </svg>
                                    </button>
                                )}
                                <button className="btn-new" onClick={() => { onProjectChange?.(null); onNewConversation(); }}>
                                    <SquarePen size={17}/>
                                    {t('sidebar.newChat')}
                                </button>
                            </div>
                        </div>

                        <div className="hist-list">
                            {conversations.length === 0 ? (
                                <div className="hist-empty">
                                    <svg className="hist-empty-icon" viewBox="0 0 48 48" fill="none"
                                         xmlns="http://www.w3.org/2000/svg">
                                        <circle cx="24" cy="24" r="20" stroke="currentColor" strokeWidth="1.5"
                                                strokeDasharray="3 3"/>
                                        <path d="M16 20h16M16 26h10" stroke="currentColor" strokeWidth="1.8"
                                              strokeLinecap="round"/>
                                        <circle cx="35" cy="35" r="6" fill="var(--surface)" stroke="currentColor"
                                                strokeWidth="1.5"/>
                                        <path d="M35 32v3.5l2 1.5" stroke="currentColor" strokeWidth="1.4"
                                              strokeLinecap="round" strokeLinejoin="round"/>
                                    </svg>

                                </div>
                            ) : (
                                conversations.filter(conv => !conv.project_id).map(conv => (
                                    <div
                                        key={conv.conv_id}
                                        className={`hist-item${conv.conv_id === activeConvId ? ' active' : ''}`}
                                        onClick={() => { if (renamingId !== conv.conv_id) { onProjectChange?.(null); onConversationSelect(conv.conv_id); } }}
                                    >
                                        {renamingId === conv.conv_id ? (
                                            <input
                                                className="hist-rename-input"
                                                autoFocus
                                                value={renameValue}
                                                onChange={e => setRenameValue(e.target.value)}
                                                onClick={e => e.stopPropagation()}
                                                onKeyDown={e => {
                                                    if (e.key === 'Enter') e.currentTarget.blur();
                                                    if (e.key === 'Escape') setRenamingId(null);
                                                }}
                                                onBlur={async () => {
                                                    if (renameValue.trim()) {
                                                        await api.renameConversation(conv.conv_id, renameValue);
                                                        onConversationRename();
                                                    }
                                                    setRenamingId(null);
                                                }}
                                            />
                                        ) : (
                                            <span className="hist-title">{conv.title}</span>
                                        )}
                                        {activeConversationIdSet.has(conv.conv_id) && (
                                            <span className="conversation-progress" role="status"
                                                  aria-label={t('sidebar.responseInProgress')}
                                                  title={t('sidebar.responseInProgress')}>
                                                <LoaderCircle size={13}/>
                                            </span>
                                        )}
                                        {renamingId !== conv.conv_id && (
                                            <SidebarOverflowMenu
                                                isOpen={menuOpenId === conv.conv_id}
                                                onOpenChange={isOpen => setMenuOpenId(isOpen ? conv.conv_id : null)}
                                                trigger="···"
                                            >
                                                        <button className="hist-menu-item" onClick={e => {
                                                            e.stopPropagation();
                                                            setMenuOpenId(null);
                                                            onShowSummary(conv.conv_id);
                                                        }}>
                                                            <NotebookText size={13}/> {t('sidebar.summary')}
                                                        </button>
                                                        <button className="hist-menu-item" onClick={e => {
                                                            e.stopPropagation();
                                                            setRenameValue(conv.title);
                                                            setRenamingId(conv.conv_id);
                                                            setMenuOpenId(null);
                                                        }}>
                                                            <Pencil size={13}/> {t('sidebar.rename')}
                                                        </button>
                                                        <button className="hist-menu-item" onClick={e => {
                                                            e.stopPropagation();
                                                            setMenuOpenId(null);
                                                            exportConversation(conv.conv_id, conv.title, 'md');
                                                        }}>
                                                            <FileCode size={13}/> {t('sidebar.exportMarkdown')}
                                                        </button>
                                                        <button className="hist-menu-item" onClick={e => {
                                                            e.stopPropagation();
                                                            setMenuOpenId(null);
                                                            exportConversation(conv.conv_id, conv.title, 'pdf');
                                                        }}>
                                                            <FileText size={13}/> {t('sidebar.exportPdf')}
                                                        </button>
                                                        <button className="hist-menu-item danger" onClick={e => {
                                                            e.stopPropagation();
                                                            setMenuOpenId(null);
                                                            onConversationDelete(conv.conv_id);
                                                        }}>
                                                            <Trash2 size={13}/> {t('sidebar.delete')}
                                                        </button>
                                            </SidebarOverflowMenu>
                                        )}
                                    </div>
                                ))
                            )}
                            {hasMore && (
                                <div ref={loadMoreRef} className="hist-loadmore">
                                    <span className="hist-spinner" aria-label="불러오는 중"/>
                                </div>
                            )}
                        </div>
                    </div>
                </>
            )}

            {/* 모달 */}
            {isProviderSettingsOpen && (
                <ProviderSettingsModal
                    isOpen={isProviderSettingsOpen}
                    provider={(window as any).__pendingProvider || currentProvider}
                    onClose={() => {
                        setIsProviderSettingsOpen(false);
                        (window as any).__pendingProvider = undefined;
                    }}
                    onSave={async () => {
                        const p = (window as any).__pendingProvider || currentProvider;
                        if (p !== currentProvider) onBeforeModelContextChange?.();
                        setCurrentProvider(p);
                        (window as any).__pendingProvider = undefined;
                        await loadCurrentProvider();
                        await onProviderChange();
                        setIsProviderSettingsOpen(false);
                    }}
                />
            )}
        </aside>
            <SettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)}
                           initialTab={openSettingsTab}/>
        </>
    );
};

export default Sidebar;
