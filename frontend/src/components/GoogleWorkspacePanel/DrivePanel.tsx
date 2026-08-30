import {useEffect, useRef, useState} from 'react';
import type {InputHTMLAttributes, UIEvent} from 'react';
import {useTranslation} from 'react-i18next';
import {
    ArrowDown,
    ArrowUp,
    ArrowUpDown,
    ChevronDown,
    ChevronRight,
    Copy,
    Database,
    Download,
    Ellipsis,
    FileText,
    FileUp,
    FolderIcon,
    FolderInput,
    FolderPlus,
    FolderUp,
    Link2,
    LoaderCircle,
    Paperclip,
    Pencil,
    RotateCcw,
    Search,
    Share2,
    Trash2,
    Users,
    X
} from 'lucide-react';
import {translateBackendError} from '../../utils/apiError';
import {api} from '../../services/api';
import ConfirmModal from '../common/ConfirmModal/ConfirmModal';
import {DriveDownloadStatusModal, DriveFileNameModal, DriveMoveDestinationModal, DriveShareModal} from './DriveModals';
import {getDriveDropContents, getDriveInputContents, type DriveDropContents} from './driveDrop';

type DrivePanelProps = {
    initialFolder?: DriveFolder;
    onAttachToChat?: (file: DriveFile) => Promise<void> | void;
    onIndexDocument?: (file: DriveFile) => Promise<void> | void;
};

export type DriveFile = {
    id: string;
    name: string;
    mimeType: string;
    modifiedTime?: string;
    size?: string;
    webViewLink?: string;
    parentPath?: DriveFolder[];
    permissions?: DrivePermissionSummary[];
};

type DrivePermissionSummary = {
    type: 'anyone' | 'domain' | 'group' | 'user' | string;
    role: string;
    emailAddress?: string;
    deleted?: boolean;
};

export type DriveFolder = {
    id: string;
    name: string;
};

type DriveSortKey = 'name' | 'modifiedTime' | 'size';
type DriveSortDirection = 'asc' | 'desc';

const FOLDER_MIME = 'application/vnd.google-apps.folder';
const INDEXABLE_EXTENSIONS = new Set(['.pdf', '.docx', '.xlsx', '.pptx', '.txt', '.html', '.htm', '.md']);
const CHAT_ATTACHABLE_EXTENSIONS = new Set([...INDEXABLE_EXTENSIONS, '.zip']);
const getFileExt = (name: string) => { const dot = name.lastIndexOf('.'); return dot > 0 ? name.slice(dot).toLowerCase() : ''; };
const isIndexableFile = (name: string) => INDEXABLE_EXTENSIONS.has(getFileExt(name));
const isChatAttachableFile = (name: string) => CHAT_ATTACHABLE_EXTENSIONS.has(getFileExt(name));
const DRIVE_PAGE_SIZE = 50;

const getDriveSharingStatus = (file: DriveFile) => {
    const permissions = file.permissions || [];
    return {
        hasGeneralAccess: permissions.some(permission =>
            !permission.deleted && (permission.type === 'anyone' || permission.type === 'domain')),
        hasSpecificAccess: permissions.some(permission =>
            !permission.deleted && permission.role !== 'owner' && (permission.type === 'user' || permission.type === 'group')),
    };
};

const insertSorted = (files: DriveFile[], newFile: DriveFile): DriveFile[] => {
    const isNewFolder = newFile.mimeType === FOLDER_MIME;
    const result = [...files];
    let insertIndex = result.length;
    for (let i = 0; i < result.length; i++) {
        const isCurrentFolder = result[i].mimeType === FOLDER_MIME;
        if (isNewFolder && !isCurrentFolder) {
            insertIndex = i;
            break;
        }
        if (!isNewFolder && isCurrentFolder) continue;
        if (isNewFolder === isCurrentFolder && newFile.name.localeCompare(result[i].name) <= 0) {
            insertIndex = i;
            break;
        }
    }
    result.splice(insertIndex, 0, newFile);
    return result;
};
const DOWNLOAD_POLL_INTERVAL_MS = 350;

const waitForDownloadPoll = (signal: AbortSignal) => new Promise<void>((resolve, reject) => {
    const handleAbort = () => {
        window.clearTimeout(timeoutId);
        reject(new DOMException('Download cancelled', 'AbortError'));
    };
    const timeoutId = window.setTimeout(() => {
        signal.removeEventListener('abort', handleAbort);
        resolve();
    }, DOWNLOAD_POLL_INTERVAL_MS);
    signal.addEventListener('abort', handleAbort, {once: true});
});

export default function DrivePanel({initialFolder, onAttachToChat, onIndexDocument}: DrivePanelProps) {
    const {t, i18n} = useTranslation('main');
    const rootFolder = {id: 'root', name: t('googleWorkspace.myDrive')};
    const [folder, setFolder] = useState<DriveFolder>(initialFolder || rootFolder);
    const [folders, setFolders] = useState<DriveFolder[]>(initialFolder ? [rootFolder, initialFolder] : [rootFolder]);
    const [files, setFiles] = useState<DriveFile[]>([]);
    const [busy, setBusy] = useState(false);
    const [driveMenuFileId, setDriveMenuFileId] = useState<string | null>(null);
    const [renamingFileId, setRenamingFileId] = useState<string | null>(null);
    const [renameValue, setRenameValue] = useState('');
    const [copyingFile, setCopyingFile] = useState<DriveFile | null>(null);
    const [sharingFile, setSharingFile] = useState<DriveFile | null>(null);
    const [trashingFile, setTrashingFile] = useState<DriveFile | null>(null);
    const [isTrashing, setIsTrashing] = useState(false);
    const [downloadingFile, setDownloadingFile] = useState<DriveFile | null>(null);
    const [downloadError, setDownloadError] = useState('');
    const [downloadProgress, setDownloadProgress] = useState<{ completed: number; total: number } | null>(null);
    const [isDraggingUpload, setIsDraggingUpload] = useState(false);
    const [isUploading, setIsUploading] = useState(false);
    const [uploadCurrent, setUploadCurrent] = useState(0);
    const [uploadTotal, setUploadTotal] = useState(0);
    const [isUploadMenuOpen, setIsUploadMenuOpen] = useState(false);
    const [isCreatingFolder, setIsCreatingFolder] = useState(false);
    const [searchValue, setSearchValue] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const [nextPageToken, setNextPageToken] = useState('');
    const [isLoadingMore, setIsLoadingMore] = useState(false);
    const [sortKey, setSortKey] = useState<DriveSortKey>('name');
    const [sortDirection, setSortDirection] = useState<DriveSortDirection>('asc');
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [isBulkTrashing, setIsBulkTrashing] = useState(false);
    const [showBulkTrashConfirm, setShowBulkTrashConfirm] = useState(false);
    const [showMoveDestination, setShowMoveDestination] = useState(false);
    const [isBulkMoving, setIsBulkMoving] = useState(false);
    const [duplicateModal, setDuplicateModal] = useState<{
        duplicateNames: string[];
        contents: DriveDropContents;
    } | null>(null);
    const driveMenuRef = useRef<HTMLDivElement>(null);
    const driveMenuTriggerRef = useRef<HTMLButtonElement>(null);
    const fileRef = useRef<HTMLInputElement>(null);
    const folderRef = useRef<HTMLInputElement>(null);
    const uploadMenuRef = useRef<HTMLDivElement>(null);
    const [isRenaming, setIsRenaming] = useState(false);
    const renameSubmittingRef = useRef(false);
    const downloadControllerRef = useRef<AbortController | null>(null);
    const downloadJobIdRef = useRef<string | null>(null);
    const [processingFile, setProcessingFile] = useState<{ name: string; type: 'attach' | 'index' } | null>(null);
    const dragDepthRef = useRef(0);
    const requestIdRef = useRef(0);
    const loadingMoreRef = useRef(false);

    const loadFiles = async (append = false, pageToken = '') => {
        if (append && loadingMoreRef.current) return;
        const requestId = append ? requestIdRef.current : ++requestIdRef.current;
        if (append) {
            loadingMoreRef.current = true;
            setIsLoadingMore(true);
        } else {
            setBusy(true);
        }
        try {
            const result = await api.getGoogleDriveFiles(
                folder.id,
                debouncedSearch,
                pageToken,
                DRIVE_PAGE_SIZE,
                sortKey,
                sortDirection,
            );
            if (requestId !== requestIdRef.current) return;
            if (!append) setSelectedIds(new Set());
            setFiles(current => append ? [...current, ...(result.files || [])] : result.files || []);
            setNextPageToken(result.nextPageToken || '');
        } finally {
            if (append) {
                loadingMoreRef.current = false;
                setIsLoadingMore(false);
            } else if (requestId === requestIdRef.current) {
                setBusy(false);
            }
        }
    };

    const submitSearch = () => setDebouncedSearch(searchValue.trim());
    useEffect(() => {
        void loadFiles();
    }, [folder.id, debouncedSearch, sortKey, sortDirection]);
    useEffect(() => {
        if (!initialFolder || initialFolder.id === folder.id) return;
        setSearchValue('');
        setDebouncedSearch('');
        setFolders([{id: 'root', name: t('googleWorkspace.myDrive')}, initialFolder]);
        setFolder(initialFolder);
    }, [folder.id, initialFolder, t]);
    useEffect(() => {
        const myDriveName = t('googleWorkspace.myDrive');
        setFolder(current => current.id === 'root' ? {...current, name: myDriveName} : current);
        setFolders(current => current.map(item => item.id === 'root' ? {...item, name: myDriveName} : item));
    }, [i18n.resolvedLanguage, t]);

    const navigateToFolder = (nextFolders: DriveFolder[], forceRefresh = false) => {
        const next = nextFolders[nextFolders.length - 1];
        if (!next) return;
        setSearchValue('');
        setDebouncedSearch('');
        if (forceRefresh && next.id === folder.id) {
            void loadFiles();
        } else {
            setFolders(nextFolders);
            setFolder(next);
        }
    };
    const openFolder = (item: DriveFile) => {
        const next = {id: item.id, name: item.name};
        navigateToFolder(debouncedSearch && item.parentPath ? [...item.parentPath, next] : [...folders, next]);
    };
    const goFolder = (index: number) => {
        navigateToFolder(folders.slice(0, index + 1), true);
    };
    const openSearchPathFolder = (path: DriveFolder[], index: number) => {
        navigateToFolder(path.slice(0, index + 1));
    };
    const getUniqueFileName = (name: string, existingNames: Set<string>): string => {
        if (!existingNames.has(name)) return name;
        const dotIndex = name.lastIndexOf('.');
        const stem = dotIndex > 0 ? name.slice(0, dotIndex) : name;
        const ext = dotIndex > 0 ? name.slice(dotIndex) : '';
        let i = 1;
        while (existingNames.has(`${stem} (${i})${ext}`)) i++;
        return `${stem} (${i})${ext}`;
    };
    const startUpload = async (contents: DriveDropContents) => {
        // 최상위 이름만 중복 확인 (폴더는 디렉토리명, 파일은 파일명)
        const topLevelNames = new Set<string>();
        contents.directories.forEach(d => {
            const first = d.replace(/\\/g, '/').split('/').filter(Boolean)[0];
            if (first) topLevelNames.add(first);
        });
        contents.files.forEach(({path}) => {
            const parts = path.replace(/\\/g, '/').split('/').filter(Boolean);
            topLevelNames.add(parts[0] || '');
        });
        const namesToCheck = [...topLevelNames].filter(Boolean);
        if (!namesToCheck.length) { void doUpload(contents); return; }
        try {
            const {duplicates} = await api.checkGoogleDriveDuplicates(folder.id, namesToCheck);
            if (duplicates.length > 0) {
                setDuplicateModal({duplicateNames: duplicates, contents});
            } else {
                void doUpload(contents);
            }
        } catch {
            void doUpload(contents);
        }
    };
    const handleDuplicateChoice = (replace: boolean) => {
        if (!duplicateModal) return;
        const {contents} = duplicateModal;
        setDuplicateModal(null);
        if (replace) {
            // 병합 모드: 폴더는 기존 폴더에 합치고, 같은 이름 파일만 대체
            void doUpload(contents, true);
        } else {
            // 두 파일 모두 유지: 최상위 이름이 중복되면 한 번만 새 이름 생성 후 전체 적용
            const existingNameSet = new Set(files.map(f => f.name));
            const renameMap = new Map<string, string>();
            const getRenamed = (topName: string) => {
                if (!existingNameSet.has(topName)) return topName;
                if (renameMap.has(topName)) return renameMap.get(topName)!;
                const newName = getUniqueFileName(topName, existingNameSet);
                existingNameSet.add(newName);
                renameMap.set(topName, newName);
                return newName;
            };
            const renamedFiles = contents.files.map(entry => {
                const parts = entry.path.replace(/\\/g, '/').split('/').filter(Boolean);
                const topName = parts[0] || '';
                const newTop = getRenamed(topName);
                if (newTop !== topName) {
                    parts[0] = newTop;
                    return {...entry, path: parts.join('/')};
                }
                return entry;
            });
            const renamedDirs = contents.directories.map(d => {
                const parts = d.replace(/\\/g, '/').split('/').filter(Boolean);
                const topName = parts[0] || '';
                const newTop = getRenamed(topName);
                if (newTop !== topName) {
                    parts[0] = newTop;
                    return parts.join('/');
                }
                return d;
            });
            void doUpload({files: renamedFiles, directories: renamedDirs});
        }
    };
    const doUpload = async (contents: DriveDropContents, replace = false) => {
        if (!contents.files.length && !contents.directories.length) return;
        const total = contents.files.length;
        setUploadTotal(total);
        setUploadCurrent(0);
        setIsUploading(true);
        try {
            // 빈 디렉토리 먼저 생성
            if (contents.directories.length) {
                const data = new FormData();
                data.append('folder_id', folder.id);
                contents.directories.forEach(directory => data.append('directories', directory));
                await api.uploadGoogleDriveFiles(data);
            }
            // 파일별 업로드 (진행률 표시)
            for (let i = 0; i < total; i++) {
                const data = new FormData();
                data.append('folder_id', folder.id);
                data.append('files', contents.files[i].file);
                data.append('paths', contents.files[i].path);
                if (replace) data.append('replace', 'true');
                setUploadCurrent(i + 1);
                await api.uploadGoogleDriveFiles(data);
            }
            await loadFiles();
        } finally {
            setIsUploading(false);
        }
    };
    const uploadSelectedFiles = (selectedFiles: FileList | null) => {
        if (!selectedFiles?.length) return;
        void startUpload(getDriveInputContents(selectedFiles));
    };
    const isFileDrag = (event: React.DragEvent) => event.dataTransfer.types.includes('Files');
    const handleDriveDragEnter = (event: React.DragEvent) => {
        if (!isFileDrag(event)) return;
        event.preventDefault();
        event.stopPropagation();
        dragDepthRef.current += 1;
        setIsDraggingUpload(true);
    };
    const handleDriveDragOver = (event: React.DragEvent) => {
        if (!isFileDrag(event)) return;
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = 'copy';
    };
    const handleDriveDragLeave = (event: React.DragEvent) => {
        if (!isFileDrag(event)) return;
        event.preventDefault();
        event.stopPropagation();
        dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
        if (dragDepthRef.current === 0) setIsDraggingUpload(false);
    };
    const handleDriveDrop = async (event: React.DragEvent) => {
        if (!isFileDrag(event)) return;
        event.preventDefault();
        event.stopPropagation();
        dragDepthRef.current = 0;
        setIsDraggingUpload(false);
        await startUpload(await getDriveDropContents(event.dataTransfer));
    };

    // Context menu close
    useEffect(() => {
        if (!driveMenuFileId) return;
        const close = (e: PointerEvent) => {
            const target = e.target as Node;
            const isMenuClick = driveMenuRef.current?.contains(target);
            const isTriggerClick = driveMenuTriggerRef.current?.contains(target);
            if (!isMenuClick && !isTriggerClick) setDriveMenuFileId(null);
        };
        document.addEventListener('pointerdown', close);
        return () => document.removeEventListener('pointerdown', close);
    }, [driveMenuFileId]);
    useEffect(() => {
        if (!isUploadMenuOpen) return;
        const close = (event: PointerEvent) => {
            if (uploadMenuRef.current && !uploadMenuRef.current.contains(event.target as Node)) setIsUploadMenuOpen(false);
        };
        document.addEventListener('pointerdown', close);
        return () => document.removeEventListener('pointerdown', close);
    }, [isUploadMenuOpen]);

    const driveDownload = async (file: DriveFile) => {
        setDriveMenuFileId(null);
        const controller = new AbortController();
        downloadControllerRef.current = controller;
        setDownloadError('');
        setDownloadProgress(null);
        setDownloadingFile(file);
        try {
            let download: { blob: Blob; filename: string };
            if (file.mimeType === FOLDER_MIME) {
                const {jobId} = await api.createGoogleDriveDownloadJob(file.id, controller.signal);
                downloadJobIdRef.current = jobId;
                while (true) {
                    const job = await api.getGoogleDriveDownloadJob(jobId, controller.signal);
                    if (job.status === 'compressing' || job.status === 'complete') {
                        setDownloadProgress({completed: job.completed, total: job.total});
                    }
                    if (job.status === 'error') {
                        throw new Error(job.code ? translateBackendError(job.code) : t('googleWorkspace.downloadFailedDescription'));
                    }
                    if (job.status === 'complete') break;
                    await waitForDownloadPoll(controller.signal);
                }
                download = await api.getGoogleDriveDownloadJobFile(jobId, controller.signal);
                downloadJobIdRef.current = null;
            } else {
                download = await api.downloadGoogleDriveFile(file.id, controller.signal);
            }
            const url = URL.createObjectURL(download.blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = download.filename || file.name;
            link.click();
            window.setTimeout(() => URL.revokeObjectURL(url), 1000);
            setDownloadingFile(null);
        } catch (error) {
            if ((error as Error).name === 'AbortError') {
                setDownloadingFile(null);
            } else {
                setDownloadError(t('googleWorkspace.downloadFailedDescription'));
            }
        } finally {
            downloadControllerRef.current = null;
        }
    };
    const cancelDownload = () => {
        const jobId = downloadJobIdRef.current;
        downloadJobIdRef.current = null;
        if (jobId) void api.cancelGoogleDriveDownloadJob(jobId);
        downloadControllerRef.current?.abort();
        setDownloadingFile(null);
        setDownloadError('');
        setDownloadProgress(null);
    };
    const driveRenameStart = (file: DriveFile) => {
        setRenamingFileId(file.id);
        setRenameValue(file.name);
        setDriveMenuFileId(null);
    };
    const driveRenameSubmit = async (fileId: string) => {
        if (!renameValue.trim() || renameSubmittingRef.current) return;
        renameSubmittingRef.current = true;
        setIsRenaming(true);
        try {
            const updated = await api.renameGoogleDriveFile(fileId, renameValue.trim());
            setFiles(current => current.map(file => file.id === fileId ? {...file, ...updated} : file));
            setRenamingFileId(null);
        } finally {
            renameSubmittingRef.current = false;
            setIsRenaming(false);
        }
    };
    const driveCopyStart = (file: DriveFile) => {
        setDriveMenuFileId(null);
        setCopyingFile(file);
    };
    const driveCopy = async (file: DriveFile, name: string) => {
        const copied = await api.copyGoogleDriveFile(file.id, name);
        setFiles(current => insertSorted(current, copied));
    };
    const driveShare = (file: DriveFile) => {
        setDriveMenuFileId(null);
        setSharingFile(file);
    };
    const driveTrashStart = (file: DriveFile) => {
        setDriveMenuFileId(null);
        setTrashingFile(file);
    };
    const driveTrash = async (file: DriveFile) => {
        if (isTrashing) return;
        setIsTrashing(true);
        try {
            await api.deleteGoogleDriveFile(file.id);
            setFiles(current => current.filter(item => item.id !== file.id));
            setTrashingFile(null);
        } finally {
            setIsTrashing(false);
        }
    };
    const createFolder = async (name: string) => {
        const created = await api.createGoogleDriveFolder(folder.id, name);
        setFiles(current => insertSorted(current, created));
    };
    const handleDriveRowsScroll = (event: UIEvent<HTMLDivElement>) => {
        const element = event.currentTarget;
        const isNearBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 100;
        if (isNearBottom && nextPageToken && !loadingMoreRef.current) void loadFiles(true, nextPageToken);
    };
    const formatDriveDate = (value?: string) => {
        if (!value) return '';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return '';
        return new Intl.DateTimeFormat(i18n.resolvedLanguage || i18n.language, {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        }).format(date);
    };
    const formatDriveSize = (value?: string) => {
        if (!value) return '-';
        const bytes = Number(value);
        const locale = i18n.resolvedLanguage || i18n.language;
        if (bytes >= 1024 * 1024) {
            return new Intl.NumberFormat(locale, {
                style: 'unit', unit: 'megabyte', unitDisplay: 'short', maximumFractionDigits: 1,
            }).format(bytes / (1024 * 1024));
        }
        if (bytes >= 1024) {
            return new Intl.NumberFormat(locale, {
                style: 'unit', unit: 'kilobyte', unitDisplay: 'short', maximumFractionDigits: 1,
            }).format(bytes / 1024);
        }
        return new Intl.NumberFormat(locale, {
            style: 'unit', unit: 'byte', unitDisplay: 'short', maximumFractionDigits: 0,
        }).format(bytes);
    };
    const changeSort = (nextSortKey: DriveSortKey) => {
        if (sortKey === nextSortKey) {
            setSortDirection(current => current === 'asc' ? 'desc' : 'asc');
            return;
        }
        setSortKey(nextSortKey);
        setSortDirection(nextSortKey === 'name' ? 'asc' : 'desc');
    };
    const renderSortIcon = (headerSortKey: DriveSortKey) => {
        if (sortKey !== headerSortKey) return <ArrowUpDown aria-hidden="true" size={13}/>;
        return sortDirection === 'asc'
            ? <ArrowUp aria-hidden="true" size={13}/>
            : <ArrowDown aria-hidden="true" size={13}/>;
    };
    const isDefaultSort = sortKey === 'name' && sortDirection === 'asc';

    const toggleSelect = (id: string) => setSelectedIds(prev => {
        const next = new Set(prev);
        if (next.has(id)) {
            next.delete(id);
        } else {
            next.add(id);
        }
        return next;
    });
    const toggleSelectAll = () => setSelectedIds(prev => prev.size === files.length ? new Set() : new Set(files.map(f => f.id)));
    const bulkTrash = async () => {
        if (isBulkTrashing) return;
        setIsBulkTrashing(true);
        try {
            await api.batchTrashGoogleDriveFiles([...selectedIds]);
            setFiles(current => current.filter(f => !selectedIds.has(f.id)));
            setSelectedIds(new Set());
            setShowBulkTrashConfirm(false);
        } finally {
            setIsBulkTrashing(false);
        }
    };
    const bulkMove = async (targetFolderId: string) => {
        if (isBulkMoving) return;
        setIsBulkMoving(true);
        try {
            const result = await api.batchMoveGoogleDriveFiles([...selectedIds], targetFolderId);
            const movedIds = new Set(result.moved_ids);
            setFiles(current => current.filter(file => !movedIds.has(file.id)));
            setSelectedIds(new Set());
        } finally {
            setIsBulkMoving(false);
        }
    };
    const bulkDownload = async () => {
        if (!selectedIds.size || downloadingFile) return;
        const controller = new AbortController();
        downloadControllerRef.current = controller;
        setDownloadError('');
        setDownloadProgress(null);
        setDownloadingFile({
            id: 'bulk-download',
            name: folder.name,
            mimeType: FOLDER_MIME,
        });
        try {
            const {jobId} = await api.createGoogleDriveBulkDownloadJob([...selectedIds], folder.name, controller.signal);
            downloadJobIdRef.current = jobId;
            while (true) {
                const job = await api.getGoogleDriveDownloadJob(jobId, controller.signal);
                if (job.status === 'compressing' || job.status === 'complete') {
                    setDownloadProgress({completed: job.completed, total: job.total});
                }
                if (job.status === 'error') throw new Error(job.code ? translateBackendError(job.code) : t('googleWorkspace.downloadFailedDescription'));
                if (job.status === 'complete') break;
                await waitForDownloadPoll(controller.signal);
            }
            const download = await api.getGoogleDriveDownloadJobFile(jobId, controller.signal);
            downloadJobIdRef.current = null;
            const url = URL.createObjectURL(download.blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = download.filename || `${folder.name}.zip`;
            link.click();
            window.setTimeout(() => URL.revokeObjectURL(url), 1000);
            setDownloadingFile(null);
        } catch (error) {
            if ((error as Error).name === 'AbortError') setDownloadingFile(null);
            else setDownloadError(t('googleWorkspace.downloadFailedDescription'));
        } finally {
            downloadControllerRef.current = null;
        }
    };

    const isSearching = !!debouncedSearch;

    return <div className={`gwp-drive${isDraggingUpload ? ' gwp-drive--dragging' : ''}`}
                onDragEnter={isSearching ? undefined : handleDriveDragEnter}
                onDragOver={isSearching ? undefined : handleDriveDragOver}
                onDragLeave={isSearching ? undefined : handleDriveDragLeave}
                onDrop={isSearching ? undefined : event => void handleDriveDrop(event)}>
        <div className="gwp-drive-search">
            <Search aria-hidden="true" size={18}/>
            <input value={searchValue} onChange={event => setSearchValue(event.target.value)}
                   onKeyDown={event => { if (event.key === 'Enter') submitSearch(); }}
                   placeholder={t('common:search')} aria-label={t('googleWorkspace.searchDrive')}/>
            {searchValue &&
                <button type="button" onClick={() => { setSearchValue(''); setDebouncedSearch(''); }} aria-label={t('googleWorkspace.clearSearch')}>
                    <X size={17}/></button>}
        </div>
        <div className="gwp-toolbar">
            <div className="gwp-breadcrumb">{folders.map((item, index) => <button key={item.id}
                                                                                  onClick={() => goFolder(index)}>{index ? ` / ${item.name}` : item.name}</button>)}</div>
            {isSearching && !busy && <div className="gwp-drive-search-caption">
                <Search aria-hidden="true" size={14}/>
                <strong>{debouncedSearch}</strong>
            </div>}
            {!isSearching && <div className="gwp-drive-toolbar-actions">
                <button className="gwp-drive-new-folder" onClick={() => setIsCreatingFolder(true)}><FolderPlus
                    aria-hidden="true" size={16}/>{t('googleWorkspace.newFolder')}</button>
                <div className="gwp-drive-upload-menu-wrap" ref={uploadMenuRef}>
                    <button className="gwp-drive-new-folder gwp-drive-upload-trigger"
                            onClick={() => setIsUploadMenuOpen(current => !current)}><FileUp aria-hidden="true"
                                                                                             size={16}/>{t('googleWorkspace.upload')}<ChevronDown
                        aria-hidden="true" size={12}/></button>
                    {isUploadMenuOpen && <div className="gwp-drive-upload-menu">
                        <button onClick={() => {
                            setIsUploadMenuOpen(false);
                            fileRef.current?.click();
                        }}><FileUp aria-hidden="true" size={16}/>{t('googleWorkspace.uploadFiles')}</button>
                        <button onClick={() => {
                            setIsUploadMenuOpen(false);
                            folderRef.current?.click();
                        }}><FolderUp aria-hidden="true" size={16}/>{t('googleWorkspace.uploadFolder')}</button>
                    </div>}
                </div>
            </div>}
            <input ref={fileRef} type="file" multiple hidden onChange={event => {
                uploadSelectedFiles(event.target.files);
                event.target.value = '';
            }}/>
            <input ref={folderRef} type="file" multiple
                   hidden {...({webkitdirectory: ''} as InputHTMLAttributes<HTMLInputElement>)} onChange={event => {
                uploadSelectedFiles(event.target.files);
                event.target.value = '';
            }}/>
        </div>
        {busy ? <div className="gwp-drive-skeleton">{[0, 1, 2, 3, 4].map(i => <div className="gwp-drive-skeleton-row"
                                                                                   key={i}><span
            className="gwp-drive-skeleton-icon"/><span className="gwp-drive-skeleton-name"/><span
            className="gwp-drive-skeleton-date"/><span className="gwp-drive-skeleton-size"/>
        </div>)}</div> : files.length === 0 ?
            <div className="gwp-drive-empty"><FolderIcon aria-hidden="true" size={30}/>
                <p>{debouncedSearch ? t('googleWorkspace.noSearchResults') : t('googleWorkspace.emptyFolder')}</p>
            </div> : <div className="gwp-drive-table">
                <div className="gwp-drive-thead">
                    <span className="gwp-drive-col-check">
                        <input type="checkbox" checked={files.length > 0 && selectedIds.size === files.length}
                               onChange={toggleSelectAll}/>
                    </span>
                    {selectedIds.size > 0
                        ? <span className="gwp-drive-col-name gwp-drive-bulk-bar">
                            <span className="gwp-selected-count"
                                  aria-label={t('googleWorkspace.selectedCount', {count: selectedIds.size})}>
                                {selectedIds.size}
                            </span>
                            <span className="gwp-drive-bulk-actions">
                                <button type="button" className="gwp-drive-bulk-download"
                                        aria-label={t('googleWorkspace.download')}
                                        onClick={() => void bulkDownload()}>
                                    <Download aria-hidden="true" size={17}/>
                                </button>
                                <button type="button" className="gwp-drive-bulk-download"
                                        aria-label={t('googleWorkspace.move')}
                                        onClick={() => setShowMoveDestination(true)}>
                                    <FolderInput aria-hidden="true" size={17}/>
                                </button>
                                <button type="button" className="gwp-trash-selected" onClick={() => setShowBulkTrashConfirm(true)}>
                                    <Trash2 aria-hidden="true" size={16}/>
                                </button>
                            </span>
                        </span>
                        : <span className="gwp-drive-col-name"><button type="button"
                                                               onClick={() => changeSort('name')}>
                        {t('googleWorkspace.fileName')}{renderSortIcon('name')}
                    </button></span>}
                    <span className="gwp-drive-col-date"><button type="button"
                                                               onClick={() => changeSort('modifiedTime')}>
                        {t('googleWorkspace.modifiedDate')}{renderSortIcon('modifiedTime')}
                    </button></span>
                    <span className="gwp-drive-col-size"><button type="button"
                                                               onClick={() => changeSort('size')}>
                        {t('googleWorkspace.fileSize')}{renderSortIcon('size')}
                    </button></span>
                    <span className="gwp-drive-col-action">
                        {!isDefaultSort && <button type="button" className="gwp-drive-sort-reset"
                                                  aria-label={t('googleWorkspace.resetSort')}
                                                  onClick={() => {
                                                      setSortKey('name');
                                                      setSortDirection('asc');
                                                  }}>
                            <RotateCcw aria-hidden="true" size={14}/>
                        </button>}
                    </span>
                </div>
                <div className="gwp-drive-rows" onScroll={handleDriveRowsScroll}>{files.map(item => <div
                    className={`gwp-drive-row${selectedIds.has(item.id) ? ' gwp-drive-row--selected' : ''}`} key={item.id}>
                <span className="gwp-drive-col-check">
                    <input type="checkbox" checked={selectedIds.has(item.id)}
                           onChange={() => toggleSelect(item.id)} onClick={e => e.stopPropagation()}/>
                </span>
                <span className="gwp-drive-col-name">
                    <div className="gwp-drive-file-btn"
                         onClick={() => renamingFileId !== item.id && (item.mimeType === FOLDER_MIME ? openFolder(item) : item.webViewLink && window.open(item.webViewLink, '_blank'))}
                         style={{cursor: renamingFileId === item.id ? undefined : 'pointer'}}>
                        {renamingFileId === item.id && isRenaming
                            ? <LoaderCircle className="gwp-drive-file-action-spinner" aria-hidden="true" size={18}/>
                            : item.mimeType === FOLDER_MIME ? <FolderIcon className="gwp-drive-folder-icon"
                                                                         aria-hidden="true" size={18}/> :
                                <FileText aria-hidden="true" size={18}/>}
                        {renamingFileId === item.id
                            ? <input className="gwp-drive-rename-input" autoFocus value={renameValue}
                                     onChange={e => setRenameValue(e.target.value)} onClick={e => e.stopPropagation()}
                                     onKeyDown={e => {
                                         if (e.key === 'Enter') {
                                             e.preventDefault();
                                             void driveRenameSubmit(item.id);
                                         } else if (e.key === 'Escape') setRenamingFileId(null);
                                     }} onBlur={() => void driveRenameSubmit(item.id)} disabled={isRenaming}/>
                            : <span className="gwp-drive-file-info">
                                <span className="gwp-drive-file-title">
                                    <button className="gwp-drive-file-name"
                                            onClick={() => item.mimeType === FOLDER_MIME ? openFolder(item) : item.webViewLink && window.open(item.webViewLink, '_blank')}>
                                        {item.name}
                                    </button>
                                    {getDriveSharingStatus(item).hasGeneralAccess && <span className="gwp-drive-sharing-status" title={t('googleWorkspace.generalAccessShared')} aria-label={t('googleWorkspace.generalAccessShared')}>
                                        <Share2 aria-hidden="true" size={12}/>
                                    </span>}
                                    {getDriveSharingStatus(item).hasSpecificAccess && <span className="gwp-drive-sharing-status" title={t('googleWorkspace.sharedWithPeople')} aria-label={t('googleWorkspace.sharedWithPeople')}>
                                        <Users aria-hidden="true" size={12}/>
                                    </span>}
                                </span>
                                {!!item.parentPath?.length && <span className="gwp-drive-file-path">
                                    <FolderIcon aria-hidden="true" size={12}/>
                                    {item.parentPath.map((pathFolder, pathIndex) => <span
                                        className="gwp-drive-file-path-segment" key={pathFolder.id}>
                                        {pathIndex > 0 && <ChevronRight aria-hidden="true" size={12}/>}
                                        <button type="button"
                                                onClick={() => openSearchPathFolder(item.parentPath!, pathIndex)}>
                                            {pathFolder.name}
                                        </button>
                                    </span>)}
                                </span>}
                            </span>}
                    </div>
                </span>
                    <span className="gwp-drive-col-date">{formatDriveDate(item.modifiedTime)}</span>
                    <span
                        className="gwp-drive-col-size">{item.mimeType === FOLDER_MIME ? '-' : formatDriveSize(item.size)}</span>
                    <span className="gwp-drive-col-action">
                    <button type="button" className="gwp-drive-download-btn"
                            aria-label={t('googleWorkspace.download')}
                            onClick={() => void driveDownload(item)}>
                        <Download aria-hidden="true" size={18}/>
                    </button>
                    <button type="button" ref={driveMenuFileId === item.id ? driveMenuTriggerRef : undefined} className="gwp-drive-more-btn" aria-expanded={driveMenuFileId === item.id} onClick={e => {
                        e.stopPropagation();
                        setDriveMenuFileId(prev => prev === item.id ? null : item.id);
                    }}>
                        <Ellipsis aria-hidden="true" size={20}/>
                    </button>
                        {driveMenuFileId === item.id && <div className="gwp-drive-context-menu" ref={driveMenuRef}>
                            {item.mimeType !== FOLDER_MIME && isChatAttachableFile(item.name) && onAttachToChat && <button onClick={async () => { setDriveMenuFileId(null); setProcessingFile({name: item.name, type: 'attach'}); try { await onAttachToChat(item); } finally { setProcessingFile(null); } }}><Paperclip aria-hidden="true"
                                                                                       size={16}/><span>{t('googleWorkspace.attachToChat')}</span>
                            </button>}
                            {item.mimeType !== FOLDER_MIME && isIndexableFile(item.name) && onIndexDocument && <button onClick={async () => { setDriveMenuFileId(null); setProcessingFile({name: item.name, type: 'index'}); try { await onIndexDocument(item); } finally { setProcessingFile(null); } }}><Database aria-hidden="true"
                                                                                       size={16}/><span>{t('googleWorkspace.indexDocument')}</span>
                            </button>}
                            <button onClick={() => driveRenameStart(item)}><Pencil aria-hidden="true"
                                                                                   size={16}/><span>{t('googleWorkspace.rename')}</span>
                            </button>
                            {item.mimeType !== FOLDER_MIME && <button onClick={() => driveCopyStart(item)}><Copy aria-hidden="true"
                                                                               size={16}/><span>{t('googleWorkspace.makeCopy')}</span>
                            </button>}
                            <button onClick={() => driveShare(item)}><Link2 aria-hidden="true"
                                                                            size={16}/><span>{t('googleWorkspace.share')}</span>
                            </button>
                            <button className="gwp-drive-context-danger" onClick={() => driveTrashStart(item)}><Trash2
                                aria-hidden="true" size={16}/><span>{t('googleWorkspace.moveToTrash')}</span></button>
                        </div>}
                </span>
                </div>)}{isLoadingMore && <div className="gwp-drive-loading-more"><LoaderCircle aria-hidden="true"
                                                                                                size={17}/>{t('googleWorkspace.loadingMoreFiles')}
                </div>}</div>
            </div>}
        {isDraggingUpload && <div className="gwp-drive-drop-overlay"><FolderIcon aria-hidden="true"
                                                                                 size={38}/><strong>{t('googleWorkspace.dropToUpload')}</strong><span>{t('googleWorkspace.dropToUploadDescription')}</span>
        </div>}
        {isUploading && <div className="gwp-drive-upload-overlay" role="status">
            <span className="gwp-drive-upload-spinner-lg"/>
            <strong>{t('googleWorkspace.uploadingToDrive')}</strong>
            <span className="gwp-drive-upload-count">{uploadCurrent}/{uploadTotal} {t('googleWorkspace.uploadProgress')}</span>
        </div>}
        {processingFile && <div className="gwp-drive-upload-overlay" role="status">
            <span className="gwp-drive-upload-spinner-lg"/>
            <strong>{processingFile.type === 'attach' ? t('googleWorkspace.attachingFile') : t('googleWorkspace.indexingFile')}</strong>
            <span className="gwp-drive-upload-count">{processingFile.name}</span>
        </div>}
        {copyingFile && <DriveFileNameModal title={t('googleWorkspace.makeCopy')}
                                            initialValue={t('googleWorkspace.copyName', {name: copyingFile.name})}
                                            confirmLabel={t('googleWorkspace.makeCopy')}
                                            errorMessage={t('googleWorkspace.copyFailed')}
                                            onClose={() => setCopyingFile(null)}
                                            onConfirm={name => driveCopy(copyingFile, name)}/>}
        {sharingFile && <DriveShareModal file={sharingFile} onClose={() => setSharingFile(null)}
                                          onPermissionsChange={permissions => setFiles(current => current.map(file =>
                                              file.id === sharingFile.id ? {...file, permissions} : file
                                          ))}/>}
        {isCreatingFolder && <DriveFileNameModal title={t('googleWorkspace.newFolder')}
                                                 initialValue={t('googleWorkspace.untitledFolder')}
                                                 confirmLabel={t('googleWorkspace.create')}
                                                 errorMessage={t('googleWorkspace.createFolderFailed')}
                                                 onClose={() => setIsCreatingFolder(false)} onConfirm={createFolder}/>}
        {showMoveDestination && <DriveMoveDestinationModal selectedCount={selectedIds.size}
                                                            onClose={() => setShowMoveDestination(false)}
                                                            onConfirm={bulkMove}/>}
        {downloadingFile && <DriveDownloadStatusModal fileName={downloadingFile.name}
                                                      isFolder={downloadingFile.mimeType === FOLDER_MIME}
                                                      completedCount={downloadProgress?.completed}
                                                      totalCount={downloadProgress?.total} error={downloadError}
                                                      onCancel={cancelDownload}/>}
        {trashingFile && <ConfirmModal title={t('googleWorkspace.moveToTrash')}
                                       description={t('googleWorkspace.moveToTrashConfirm', {name: trashingFile.name})}
                                       loading={isTrashing}
                                       loadingValue="trash"
                                       loadingLabel={t('googleWorkspace.processing')}
                                       actionLayout="horizontal" options={[
            {label: t('googleWorkspace.cancel'), value: 'cancel'},
            {label: t('googleWorkspace.moveToTrash'), value: 'trash', variant: 'danger'},
        ]} onClose={() => { if (!isTrashing) setTrashingFile(null); }}
                                       onSelect={value => value === 'trash' ? void driveTrash(trashingFile) : setTrashingFile(null)}/>}
        {showBulkTrashConfirm && <ConfirmModal title={t('googleWorkspace.moveToTrash')}
                                       description={t('googleWorkspace.bulkTrashConfirm', {count: selectedIds.size})}
                                       loading={isBulkTrashing}
                                       loadingValue="trash"
                                       loadingLabel={t('googleWorkspace.processing')}
                                       actionLayout="horizontal" options={[
            {label: t('googleWorkspace.cancel'), value: 'cancel'},
            {label: t('googleWorkspace.moveToTrash'), value: 'trash', variant: 'danger'},
        ]} onClose={() => { if (!isBulkTrashing) setShowBulkTrashConfirm(false); }}
                                       onSelect={value => value === 'trash' ? void bulkTrash() : setShowBulkTrashConfirm(false)}/>}
        {duplicateModal && <ConfirmModal title={t('googleWorkspace.uploadOptions')}
                                         description={t('googleWorkspace.duplicateDescription', {names: duplicateModal.duplicateNames.join(', ')})}
                                         actionLayout="horizontal" options={[
            {label: t('googleWorkspace.cancel'), value: 'cancel'},
            {label: t('googleWorkspace.keepBoth'), value: 'keep'},
            {label: t('googleWorkspace.replace'), value: 'replace'},
        ]} onClose={() => setDuplicateModal(null)}
                                         onSelect={value => {
                                             if (value === 'replace') handleDuplicateChoice(true);
                                             else if (value === 'keep') handleDuplicateChoice(false);
                                             else setDuplicateModal(null);
                                         }}/>}
    </div>;
}
