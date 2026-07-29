import {useEffect, useState} from 'react';
import type {ReactNode} from 'react';
import {useTranslation} from 'react-i18next';
import {Archive, Check, ChevronRight, Copy, FileDown, FolderIcon, Link2, LoaderCircle, Trash2, UserPlus, X} from 'lucide-react';
import ModalOverlay from '../common/ModalOverlay/ModalOverlay';
import CustomSelect from '../CustomSelect/CustomSelect';
import {api} from '../../services/api';
import {copyToClipboard} from '../../utils/helpers';

export type DrivePermission = {
    id: string;
    type: 'user' | 'group' | 'domain' | 'anyone';
    role: 'owner' | 'organizer' | 'fileOrganizer' | 'writer' | 'commenter' | 'reader';
    emailAddress?: string;
    displayName?: string;
    photoLink?: string;
};

type DownloadStatusModalProps = {
    fileName: string;
    isFolder: boolean;
    completedCount?: number;
    totalCount?: number;
    error?: string;
    onCancel: () => void;
};

export function DriveDownloadStatusModal({fileName, isFolder, completedCount, totalCount, error, onCancel}: DownloadStatusModalProps) {
    const {t} = useTranslation('main');
    return <ModalOverlay className="gwp-drive-download-overlay" onClose={onCancel} closeOnBackdrop={false}>
        <section className="gwp-drive-download-dialog" onClick={event => event.stopPropagation()}>
            <header>
                <div>
                    <h2>{error ? t('googleWorkspace.downloadFailed') : t('googleWorkspace.preparingDownload')}</h2>
                    {fileName && <p>{fileName}</p>}
                </div>
                <button type="button" onClick={onCancel} aria-label={t('googleWorkspace.cancelDownload')}><X size={20}/></button>
            </header>
            <div className={`gwp-drive-download-state${error ? ' is-error' : ''}`}>
                {isFolder ? <Archive aria-hidden="true" size={28}/> : <FileDown aria-hidden="true" size={28}/>}
                <div>
                    <strong>{error || (isFolder
                        ? totalCount === undefined ? t('googleWorkspace.countingFolderFiles') : t('googleWorkspace.compressingFolderProgress', {completed: completedCount || 0, total: totalCount})
                        : t('googleWorkspace.downloadingFile'))}</strong>
                    {!error && <small>{t('googleWorkspace.downloadWait')}</small>}
                </div>
                {!error && <LoaderCircle className="gwp-drive-download-spinner" aria-hidden="true" size={30}/>}
            </div>
            {error && <footer><button type="button" onClick={onCancel}>{t('googleWorkspace.close')}</button></footer>}
        </section>
    </ModalOverlay>;
}

type FileNameModalProps = {
    title: string;
    initialValue: string;
    confirmLabel: string;
    errorMessage: string;
    onClose: () => void;
    onConfirm: (name: string) => Promise<void>;
};

export function DriveFileNameModal({title, initialValue, confirmLabel, errorMessage, onClose, onConfirm}: FileNameModalProps) {
    const {t} = useTranslation('main');
    const [name, setName] = useState(initialValue);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    const submit = async () => {
        if (!name.trim() || saving) return;
        setSaving(true);
        setError('');
        try {
            await onConfirm(name.trim());
            onClose();
        } catch {
            setError(errorMessage);
            setSaving(false);
        }
    };

    const close = () => {
        if (!saving) onClose();
    };

    return <ModalOverlay className="gwp-drive-modal-overlay" onClose={close} closeOnBackdrop={!saving}>
        <form className="gwp-drive-dialog gwp-drive-name-dialog" onSubmit={event => { event.preventDefault(); void submit(); }} onClick={event => event.stopPropagation()}>
            <header><h2>{title}</h2><button type="button" onClick={close} disabled={saving}
                                          aria-label={t('googleWorkspace.close')}><X size={18}/></button></header>
            <input autoFocus value={name} disabled={saving}
                   onChange={event => { setName(event.target.value); setError(''); }}
                   onFocus={event => event.currentTarget.select()}/>
            {error && <p className="gwp-drive-dialog-error">{error}</p>}
            <footer>
                <button type="button" className="gwp-drive-dialog-secondary" onClick={close}
                        disabled={saving}>{t('googleWorkspace.cancel')}</button>
                <button type="submit" className="gwp-drive-dialog-primary" disabled={!name.trim() || saving}>
                    {saving && <LoaderCircle className="gwp-drive-dialog-button-spinner" aria-hidden="true"
                                             size={16}/>}
                    {saving ? t('googleWorkspace.processing') : confirmLabel}
                </button>
            </footer>
        </form>
    </ModalOverlay>;
}

type DriveFolder = {id: string; name: string};

type MoveDestinationModalProps = {
    selectedCount: number;
    onClose: () => void;
    onConfirm: (folderId: string) => Promise<void>;
};

export function DriveMoveDestinationModal({selectedCount, onClose, onConfirm}: MoveDestinationModalProps) {
    const {t} = useTranslation('main');
    const [childrenByParent, setChildrenByParent] = useState<Record<string, DriveFolder[]>>({});
    const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set(['root']));
    const [loadingIds, setLoadingIds] = useState<Set<string>>(new Set(['root']));
    const [selectedFolderId, setSelectedFolderId] = useState('');
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);

    const loadChildren = async (folderId: string) => {
        if (childrenByParent[folderId]) return;
        setLoadingIds(current => new Set(current).add(folderId));
        try {
            const result = await api.getGoogleDriveFolders(folderId);
            setChildrenByParent(current => ({...current, [folderId]: result.folders}));
        } catch {
            setError(t('googleWorkspace.loadFoldersFailed'));
        } finally {
            setLoadingIds(current => {
                const next = new Set(current);
                next.delete(folderId);
                return next;
            });
        }
    };

    useEffect(() => { void loadChildren('root'); }, []);

    const toggleFolder = (folderId: string) => {
        setError('');
        setExpandedIds(current => {
            const next = new Set(current);
            if (next.has(folderId)) next.delete(folderId);
            else {
                next.add(folderId);
                void loadChildren(folderId);
            }
            return next;
        });
    };
    const submit = async () => {
        if (!selectedFolderId || saving) return;
        setSaving(true);
        setError('');
        try {
            await onConfirm(selectedFolderId);
            onClose();
        } catch {
            setError(t('googleWorkspace.moveFailed'));
            setSaving(false);
        }
    };
    const renderFolders = (parentId: string, depth: number): ReactNode => (childrenByParent[parentId] || []).map(folder => {
        const expanded = expandedIds.has(folder.id);
        const loading = loadingIds.has(folder.id);
        return <div key={folder.id}>
            <div className={`gwp-drive-folder-tree-row${selectedFolderId === folder.id ? ' is-selected' : ''}${expanded ? ' is-expanded' : ''}`}
                 style={{paddingLeft: `${12 + depth * 18}px`}}>
                <button type="button" className="gwp-drive-folder-tree-expand" onClick={() => toggleFolder(folder.id)}
                        aria-label={expanded ? t('googleWorkspace.collapseFolder') : t('googleWorkspace.expandFolder')}>
                    {loading ? <LoaderCircle className="gwp-drive-dialog-button-spinner" aria-hidden="true" size={15}/> : <ChevronRight aria-hidden="true" size={15}/>}
                </button>
                <button type="button" className="gwp-drive-folder-tree-select" onClick={() => { setSelectedFolderId(folder.id); setError(''); }}>
                    <FolderIcon aria-hidden="true" size={17}/><span>{folder.name}</span>
                </button>
            </div>
            {expanded && renderFolders(folder.id, depth + 1)}
        </div>;
    });

    return <ModalOverlay className="gwp-drive-modal-overlay" onClose={() => !saving && onClose()} closeOnBackdrop={!saving}>
        <section className="gwp-drive-dialog gwp-drive-move-dialog" onClick={event => event.stopPropagation()}>
            <header><div><h2>{t('googleWorkspace.moveSelected')}</h2><p>{t('googleWorkspace.moveSelectedDescription', {count: selectedCount})}</p></div><button type="button" onClick={onClose} disabled={saving} aria-label={t('googleWorkspace.close')}><X size={20}/></button></header>
            <div className="gwp-drive-folder-tree" role="tree">
                <div className={`gwp-drive-folder-tree-row${selectedFolderId === 'root' ? ' is-selected' : ''}`}>
                    <span className="gwp-drive-folder-tree-root-spacer"/><button type="button" className="gwp-drive-folder-tree-select" onClick={() => { setSelectedFolderId('root'); setError(''); }}><FolderIcon aria-hidden="true" size={17}/><span>{t('googleWorkspace.myDrive')}</span></button>
                </div>
                {renderFolders('root', 1)}
            </div>
            {error && <p className="gwp-drive-dialog-error">{error}</p>}
            <footer><button type="button" className="gwp-drive-dialog-secondary" onClick={onClose} disabled={saving}>{t('googleWorkspace.cancel')}</button><button type="button" className="gwp-drive-dialog-primary" onClick={() => void submit()} disabled={!selectedFolderId || saving}>{saving && <LoaderCircle className="gwp-drive-dialog-button-spinner" aria-hidden="true" size={16}/>} {saving ? t('googleWorkspace.processing') : t('googleWorkspace.move')}</button></footer>
        </section>
    </ModalOverlay>;
}

type ShareModalProps = {
    file: {id: string; name: string};
    onClose: () => void;
    onPermissionsChange?: (permissions: DrivePermission[]) => void;
};

type ShareBusyAction = 'loading' | 'invite' | 'generalAccess' | `removePermission:${string}`;

export function DriveShareModal({file, onClose, onPermissionsChange}: ShareModalProps) {
    const {t} = useTranslation('main');
    const [permissions, setPermissions] = useState<DrivePermission[]>([]);
    const [link, setLink] = useState('');
    const [email, setEmail] = useState('');
    const [inviteRole, setInviteRole] = useState<'reader' | 'writer'>('reader');
    const [generalRole, setGeneralRole] = useState<'private' | 'reader' | 'writer'>('private');
    const [busyAction, setBusyAction] = useState<ShareBusyAction | null>('loading');
    const [copied, setCopied] = useState(false);
    const busy = busyAction !== null;
    const isSaving = busyAction !== null && busyAction !== 'loading';
    const inviteRoleOptions = [
        {value: 'reader', label: t('googleWorkspace.viewer')},
        {value: 'writer', label: t('googleWorkspace.editor')},
    ];
    const generalRoleOptions = [
        {value: 'private', label: t('googleWorkspace.restricted')},
        {value: 'reader', label: t('googleWorkspace.anyoneViewer')},
        {value: 'writer', label: t('googleWorkspace.anyoneEditor')},
    ];

    const loadPermissions = async () => {
        const result = await api.getGoogleDrivePermissions(file.id) as {link: string; permissions: DrivePermission[]};
        setPermissions(result.permissions);
        onPermissionsChange?.(result.permissions);
        setLink(result.link);
        const anyone = result.permissions.find(permission => permission.type === 'anyone');
        setGeneralRole(anyone?.role === 'writer' ? 'writer' : anyone ? 'reader' : 'private');
    };

    useEffect(() => {
        setBusyAction('loading');
        void loadPermissions().finally(() => setBusyAction(null));
    }, [file.id]);

    const invite = async () => {
        if (!email.trim() || busy) return;
        setBusyAction('invite');
        try {
            await api.createGoogleDrivePermission(file.id, email.trim(), inviteRole);
            setEmail('');
            await loadPermissions();
        } finally {
            setBusyAction(null);
        }
    };

    const updateGeneralAccess = async (role: 'private' | 'reader' | 'writer') => {
        if (busy) return;
        setGeneralRole(role);
        setBusyAction('generalAccess');
        try {
            await api.updateGoogleDriveGeneralAccess(file.id, role);
            await loadPermissions();
        } finally {
            setBusyAction(null);
        }
    };

    const removePermission = async (permissionId: string) => {
        if (busy) return;
        setBusyAction(`removePermission:${permissionId}`);
        try {
            await api.deleteGoogleDrivePermission(file.id, permissionId);
            await loadPermissions();
        } finally {
            setBusyAction(null);
        }
    };

    const copyLink = async () => {
        await copyToClipboard(link);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2000);
    };

    const close = () => {
        if (!isSaving) onClose();
    };

    return <ModalOverlay className="gwp-drive-modal-overlay" onClose={close} closeOnBackdrop={!isSaving}>
        <section className="gwp-drive-dialog gwp-drive-share-dialog" onClick={event => event.stopPropagation()}>
            <header><div><h2>{t('googleWorkspace.shareTitle', {name: file.name})}</h2><p>{t('googleWorkspace.shareDescription')}</p></div><button type="button" onClick={close} disabled={isSaving} aria-label={t('googleWorkspace.close')}><X size={20}/></button></header>
            {busyAction === 'loading' && <div className="gwp-drive-share-loading" role="status">
                <LoaderCircle aria-hidden="true" size={32}/>
                <span>{t('googleWorkspace.loading')}</span>
            </div>}
            <form className="gwp-drive-invite" onSubmit={event => { event.preventDefault(); void invite(); }}>
                <UserPlus size={18}/>
                <input type="email" value={email} disabled={busy}
                       onChange={event => setEmail(event.target.value)}
                       placeholder={t('googleWorkspace.emailPlaceholder')}/>
                <CustomSelect
                    className="gwp-drive-invite-role-select"
                    options={inviteRoleOptions}
                    value={inviteRole}
                    onChange={value => setInviteRole(value as 'reader' | 'writer')}
                    disabled={busy}
                />
                <button type="submit" disabled={!email.trim() || busy}>
                    {busyAction === 'invite' && <LoaderCircle className="gwp-drive-dialog-button-spinner"
                                                              aria-hidden="true" size={16}/>}
                    {busyAction === 'invite' ? t('googleWorkspace.processing') : t('googleWorkspace.invite')}
                </button>
            </form>
            <div className="gwp-drive-share-section">
                <h3>{t('googleWorkspace.peopleWithAccess')}</h3>
                {permissions.filter(permission => permission.type !== 'anyone').map(permission =>
                        <div className="gwp-drive-permission" key={permission.id}>
                            <span className="gwp-drive-avatar">{permission.photoLink ? <img src={permission.photoLink} alt=""/> : (permission.displayName || permission.emailAddress || '?')[0]}</span>
                            <span><strong>{permission.displayName || permission.emailAddress || permission.type}</strong>{permission.displayName && permission.emailAddress && <small>{permission.emailAddress}</small>}</span>
                            <span className="gwp-drive-permission-role">{permission.role === 'owner' ? t('googleWorkspace.owner') : permission.role === 'writer' ? t('googleWorkspace.editor') : t('googleWorkspace.viewer')}</span>
                            {permission.role !== 'owner' && <button type="button" onClick={() => void removePermission(permission.id)} disabled={busy} aria-label={t('googleWorkspace.removePermission')}>
                                {busyAction === `removePermission:${permission.id}`
                                    ? <LoaderCircle className="gwp-drive-dialog-button-spinner" aria-hidden="true"
                                                    size={16}/>
                                    : <Trash2 size={16}/>}
                            </button>}
                        </div>)}
            </div>
            <div className="gwp-drive-share-section">
                <h3>{t('googleWorkspace.generalAccess')}</h3>
                <div className="gwp-drive-general-access">
                    <Link2 size={20}/>
                    <div>
                        <CustomSelect
                            className="gwp-drive-general-role-select"
                            options={generalRoleOptions}
                            value={generalRole}
                            onChange={value => void updateGeneralAccess(value as 'private' | 'reader' | 'writer')}
                            disabled={busy}
                        />
                        <small>{generalRole === 'private' ? t('googleWorkspace.restrictedDescription') : t('googleWorkspace.anyoneDescription')}</small>
                        {busyAction === 'generalAccess' && <span className="gwp-drive-share-action-status"
                                                                 role="status">
                            <LoaderCircle aria-hidden="true" size={14}/>
                            {t('googleWorkspace.processing')}
                        </span>}
                    </div>
                </div>
            </div>
            <footer>
                <button type="button" className="gwp-drive-copy-link" onClick={() => void copyLink()}
                        disabled={!link || busy}><Copy size={17}/>{copied ? <><Check size={17}/> {t('googleWorkspace.copied')}</> : t('googleWorkspace.copyLink')}</button>
                <button type="button" className="gwp-drive-dialog-primary" onClick={close}
                        disabled={isSaving}>{t('googleWorkspace.close')}</button>
            </footer>
        </section>
    </ModalOverlay>;
}
