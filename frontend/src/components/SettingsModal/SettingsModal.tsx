import React, {useCallback, useEffect, useRef, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {api} from '../../services/api';
import {toast} from '../common/ToastNotifications/ToastNotifications';
import {fetchTtsSettings, updateTtsCache, DEFAULT_TTS_SETTINGS} from '../../services/tts/ttsSettings';
import type {TtsSettings} from '../../services/tts/ttsSettings';
import {changeLanguage, SUPPORTED_LANGUAGES} from '../../i18n';
import ModalOverlay from '../common/ModalOverlay/ModalOverlay';
import {getTopmostModalOverlay} from '../common/ModalOverlay/modalStack';
import {Tooltip} from '../common/Tooltip/Tooltip';
import './SettingsModal.css';
import '../RememberModal/RememberModal.css';
import McpServersSection from './McpServersSection';
import SkillsSection from './SkillsSection';
import PluginsSection from './PluginsSection';
import ExternalDataSection from './ExternalDataSection';
import {refreshSkills} from '../../services/skills';
import CustomSelect from '../CustomSelect/CustomSelect';
import {refreshGoogleWorkspaceStatus} from '../../services/googleWorkspaceStatus';
import {getUserProfile, updateUserProfile} from '../../services/userProfile';
import {getKokoroAvailability} from '../../services/tts/kokoroStatus';

interface IndexStat {
    index: string;
    doc_count: number;
    selected: boolean;
}

interface RestoreResult {
    index: string;
    inserted: number;
    skipped: number;
    error?: string;
}

interface BackupPreviewIndex {
    name: string;
    count: number;
}

interface BackupPreview {
    indices: BackupPreviewIndex[];
    file_count: number;
    plugins?: {
        id: string;
        name: string;
        version: string;
        installed: boolean;
        data_indices?: string[];
    }[];
}

interface SettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
    initialTab?: string;
}

type Tab = 'backup' | 'general' | 'runtime' | 'api' | 'externalData' | 'plugins' | 'skills' | 'profile';

type RuntimeSettings = Record<string, number | null>;
const DEFAULT_SETTINGS_TAB: Tab = 'general';
const DEFAULT_RUNTIME_SETTINGS: RuntimeSettings = {llm_temperature: 0.2, llm_num_ctx: 131072, llm_num_predict: 32768, llm_max_tokens: 4096, top_k: null, top_p: null, history_token_budget: 32768, history_chars_per_token: 2, ollama_keep_alive: -1, bge_num_ctx: 8192, document_chunk_size: 1200, document_chunk_overlap: 150};
const toRuntimeInputValues = (settings: RuntimeSettings): Record<string, string> => Object.fromEntries(
    Object.entries(settings).map(([key, value]) => [key, value === null ? '' : String(value)])
);
const RUNTIME_SETTING_SECTIONS = [
    {key: 'llm', fields: ['llm_temperature', 'llm_num_ctx', 'llm_num_predict', 'llm_max_tokens', 'top_k', 'top_p']},
    {key: 'ollama', fields: ['ollama_keep_alive', 'bge_num_ctx']},
    {key: 'history', fields: ['history_token_budget', 'history_chars_per_token']},
    {key: 'chunking', fields: ['document_chunk_size', 'document_chunk_overlap']},
] as const;
const RUNTIME_FIELD_CONSTRAINTS: Record<string, {min: number; max?: number; step: number}> = {
    llm_temperature: {min: 0, max: 1, step: 0.01}, llm_num_ctx: {min: 1024, max: 262144, step: 1},
    llm_num_predict: {min: 1, max: 131072, step: 1}, llm_max_tokens: {min: 1, max: 32768, step: 1},
    top_k: {min: 0, max: 100, step: 1}, top_p: {min: 0, max: 1, step: 0.01},
    history_token_budget: {min: 0, max: 131072, step: 1}, history_chars_per_token: {min: 0.1, max: 10, step: 0.1},
    ollama_keep_alive: {min: -1, step: 1}, bge_num_ctx: {min: 1, max: 8192, step: 1},
    document_chunk_size: {min: 100, max: 100000, step: 1}, document_chunk_overlap: {min: 0, max: 99999, step: 1},
};

const normalizeRuntimeSetting = (key: string, value: number): number => {
    const constraint = RUNTIME_FIELD_CONSTRAINTS[key];
    const bounded = Math.max(constraint.min, constraint.max === undefined ? value : Math.min(value, constraint.max));
    return constraint.step === 1 ? Math.round(bounded) : bounded;
};

const VOICE_LIST = [
    {name: 'Samantha', descKey: 'usF'},
    {name: 'Tom', descKey: 'usM'},
    {name: 'Kate', descKey: 'ukF'},
    {name: 'Daniel', descKey: 'ukM'},
];

// Kokoro voice prefix → description key mapping
const KOKORO_PREFIX_DESC: Record<string, string> = {
    af: 'usF', am: 'usM', bf: 'ukF', bm: 'ukM',
    jf: 'jpF', jm: 'jpM', zf: 'cnF', zm: 'cnM',
    ef: 'esF', em: 'esM', ff: 'frF',
    hf: 'hiF', hm: 'hiM', if: 'itF', im: 'itM',
    pf: 'brF', pm: 'brM',
};

const KOKORO_VOICE_LANGUAGES: Record<string, string> = {
    af: 'en-US', am: 'en-US', bf: 'en-GB', bm: 'en-GB',
    ef: 'es', em: 'es', ff: 'fr', hf: 'hi', hm: 'hi',
    if: 'it', im: 'it', jf: 'ja-JP', jm: 'ja-JP',
    pf: 'pt-BR', pm: 'pt-BR', zf: 'zh-CN', zm: 'zh-CN',
};

const getKokoroVoiceLanguage = (voice: string) =>
    KOKORO_VOICE_LANGUAGES[voice.split('_')[0]] ?? 'en-US';

const KOKORO_VOICES: { value: string; name: string; lang: string }[] = [
    {value: 'af_heart', name: 'Heart', lang: '🇺🇸'},
    {value: 'af_alloy', name: 'Alloy', lang: '🇺🇸'},
    {value: 'af_aoede', name: 'Aoede', lang: '🇺🇸'},
    {value: 'af_bella', name: 'Bella', lang: '🇺🇸'},
    {value: 'af_jessica', name: 'Jessica', lang: '🇺🇸'},
    {value: 'af_nicole', name: 'Nicole', lang: '🇺🇸'},
    {value: 'af_nova', name: 'Nova', lang: '🇺🇸'},
    {value: 'af_river', name: 'River', lang: '🇺🇸'},
    {value: 'af_sarah', name: 'Sarah', lang: '🇺🇸'},
    {value: 'af_sky', name: 'Sky', lang: '🇺🇸'},
    {value: 'am_adam', name: 'Adam', lang: '🇺🇸'},
    {value: 'am_echo', name: 'Echo', lang: '🇺🇸'},
    {value: 'am_eric', name: 'Eric', lang: '🇺🇸'},
    {value: 'am_liam', name: 'Liam', lang: '🇺🇸'},
    {value: 'am_michael', name: 'Michael', lang: '🇺🇸'},
    {value: 'am_onyx', name: 'Onyx', lang: '🇺🇸'},
    {value: 'bf_emma', name: 'Emma', lang: '🇬🇧'},
    {value: 'bf_isabella', name: 'Isabella', lang: '🇬🇧'},
    {value: 'bm_george', name: 'George', lang: '🇬🇧'},
    {value: 'bm_lewis', name: 'Lewis', lang: '🇬🇧'},
    {value: 'jf_alpha', name: 'Alpha', lang: '🇯🇵'},
    {value: 'jf_gongitsune', name: 'Gongitsune', lang: '🇯🇵'},
    {value: 'jf_nezumi', name: 'Nezumi', lang: '🇯🇵'},
    {value: 'jf_tebukuro', name: 'Tebukuro', lang: '🇯🇵'},
    {value: 'jm_kumo', name: 'Kumo', lang: '🇯🇵'},
    {value: 'zf_xiaobei', name: 'Xiaobei', lang: '🇨🇳'},
    {value: 'zf_xiaoni', name: 'Xiaoni', lang: '🇨🇳'},
    {value: 'zf_xiaoxiao', name: 'Xiaoxiao', lang: '🇨🇳'},
    {value: 'zf_xiaoyi', name: 'Xiaoyi', lang: '🇨🇳'},
    {value: 'zm_yunjian', name: 'Yunjian', lang: '🇨🇳'},
    {value: 'zm_yunxi', name: 'Yunxi', lang: '🇨🇳'},
    {value: 'zm_yunxia', name: 'Yunxia', lang: '🇨🇳'},
    {value: 'zm_yunyang', name: 'Yunyang', lang: '🇨🇳'},
    {value: 'ef_dora', name: 'Dora', lang: '🇪🇸'},
    {value: 'em_alex', name: 'Alex', lang: '🇪🇸'},
    {value: 'em_santa', name: 'Santa', lang: '🇪🇸'},
    {value: 'ff_siwis', name: 'Siwis', lang: '🇫🇷'},
    {value: 'hf_alpha', name: 'Alpha', lang: '🇮🇳'},
    {value: 'hf_beta', name: 'Beta', lang: '🇮🇳'},
    {value: 'hm_omega', name: 'Omega', lang: '🇮🇳'},
    {value: 'hm_psi', name: 'Psi', lang: '🇮🇳'},
    {value: 'if_sara', name: 'Sara', lang: '🇮🇹'},
    {value: 'im_nicola', name: 'Nicola', lang: '🇮🇹'},
    {value: 'pf_dora', name: 'Dora', lang: '🇧🇷'},
    {value: 'pm_alex', name: 'Alex', lang: '🇧🇷'},
    {value: 'pm_santa', name: 'Santa', lang: '🇧🇷'},
];

const SettingsModal: React.FC<SettingsModalProps> = ({isOpen, onClose, initialTab}) => {
    const {t, i18n} = useTranslation('settings');
    const getBackupIndexHelp = (indexName: string) => {
        const baseIndexName = indexName.replace(/_(ko|en|ja|zh|th|vi|es|fr|und)$/, '');
        const summary = t(`backup.indexHelp.${baseIndexName}`, {
            defaultValue: t('backup.indexHelpDefault', {name: indexName}),
        });
        const restoreBehavior = t(
            indexName === 'system_settings'
                ? 'backup.indexSettingsBehavior'
                : 'backup.indexDataBehavior',
        );
        return `${summary}\n\n${restoreBehavior}`;
    };

    const [tab, setTab] = useState<Tab>(
        initialTab === 'plugins' ? DEFAULT_SETTINGS_TAB : (initialTab as Tab) || DEFAULT_SETTINGS_TAB
    );
    const [isPluginTabVisible, setIsPluginTabVisible] = useState(false);

    const handleClose = useCallback(() => {
        setTab(DEFAULT_SETTINGS_TAB);
        setIsPluginTabVisible(false);
        onClose();
    }, [onClose]);

    // initialTab이 바뀌면 탭 동기화, 없으면 일반으로 리셋
    useEffect(() => {
        if (!isOpen) return;
        setIsPluginTabVisible(false);
        setTab(initialTab === 'plugins' ? DEFAULT_SETTINGS_TAB : (initialTab as Tab) || DEFAULT_SETTINGS_TAB);
    }, [isOpen, initialTab]);

    const handlePluginTabUnlock = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
        if (!event.metaKey || !event.shiftKey) return;
        event.preventDefault();
        event.stopPropagation();
        setIsPluginTabVisible(true);
    }, []);

    // 기존 설치에서는 화면 언어가 localStorage에만 남아 있을 수 있다. 설정을 열 때
    // 현재 i18n 언어를 ES의 기준값으로 동기화해 확장 프로그램도 같은 값을 읽게 한다.
    useEffect(() => {
        if (!isOpen) return;
        const language = i18n.language.split('-')[0];
        fetch('/api/extension/language', {
            method: 'PUT',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({language}),
        }).catch(() => {});
    }, [isOpen, i18n.language]);

    // 백업 탭
    const [stats, setStats] = useState<IndexStat[]>([]);
    const [statsLoading, setStatsLoading] = useState(false);
    const [exporting, setExporting] = useState(false);
    const [importing, setImporting] = useState(false);
    const [restoreResult, setRestoreResult] = useState<RestoreResult[] | null>(null);
    const [restoreError, setRestoreError] = useState('');
    const [includeFiles, setIncludeFiles] = useState(true); // 원본 문서 포함 여부
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [restoreFile, setRestoreFile] = useState<File | null>(null);
    const [backupPreview, setBackupPreview] = useState<BackupPreview | null>(null);
    const [restoreIndices, setRestoreIndices] = useState<string[]>([]);
    const [restoreFiles, setRestoreFiles] = useState(false);
    const [previewLoading, setPreviewLoading] = useState(false);
    const [googleDriveAvailable, setGoogleDriveAvailable] = useState(false);
    const [exportingDrive, setExportingDrive] = useState(false);
    const [driveBackupAccounts, setDriveBackupAccounts] = useState<Array<{id: string; email?: string}>>([]);
    const [activeDriveBackupAccountId, setActiveDriveBackupAccountId] = useState('');
    const [showDriveAccountSelection, setShowDriveAccountSelection] = useState(false);
    const [selectedDriveBackupAccountId, setSelectedDriveBackupAccountId] = useState('');

    // 일반 설정 탭
    const [llmLogging, setLlmLogging] = useState(false);
    const [toolLogging, setToolLogging] = useState(true);
    const [debugLogging, setDebugLogging] = useState(false);
    const [debugLoggingRestarting, setDebugLoggingRestarting] = useState(false);
    const [runtimeSettings, setRuntimeSettings] = useState<RuntimeSettings>(DEFAULT_RUNTIME_SETTINGS);
    const [runtimeInputValues, setRuntimeInputValues] = useState<Record<string, string>>(
        toRuntimeInputValues(DEFAULT_RUNTIME_SETTINGS)
    );
    const [runtimeSaving, setRuntimeSaving] = useState(false);
    const [runtimeSaved, setRuntimeSaved] = useState(false);
    const [runtimeSavedField, setRuntimeSavedField] = useState<string | null>(null);
    const runtimeSavedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const saveRuntimeSettings = async (settings: RuntimeSettings, savedField?: string) => {
        setRuntimeSaving(true);
        setRuntimeSaved(false);
        setRuntimeSavedField(null);
        try {
            const savedSettings = await api.setRuntimeSettings(settings);
            setRuntimeSettings(savedSettings);
            setRuntimeInputValues(toRuntimeInputValues(savedSettings));
            if (savedField) {
                setRuntimeSavedField(savedField);
            } else {
                setRuntimeSaved(true);
            }
            if (runtimeSavedTimerRef.current) clearTimeout(runtimeSavedTimerRef.current);
            runtimeSavedTimerRef.current = setTimeout(() => {
                setRuntimeSaved(false);
                setRuntimeSavedField(null);
            }, 1500);
        } finally {
            setRuntimeSaving(false);
        }
    };

    const restoreDefaultRuntimeSettings = async () => {
        const defaults = {...DEFAULT_RUNTIME_SETTINGS};
        setRuntimeSettings(defaults);
        setRuntimeInputValues(toRuntimeInputValues(defaults));
        await saveRuntimeSettings(defaults);
    };

    // 부팅 시 자동 시작
    const [autoStart, setAutoStart] = useState(false);
    const isElectron = typeof window !== 'undefined' && !!window.ragAPI?.setLoginItem;

    useEffect(() => {
        if (!isElectron || !isOpen) return;
        window.ragAPI?.getLoginItem?.().then(v => {
            setAutoStart(v);
        });
    }, [isElectron, isOpen]);

    // TTS 설정
    const [ttsDraft, setTtsDraft] = useState<TtsSettings>(DEFAULT_TTS_SETTINGS);

    // TTS 설정을 즉시 상태 반영 + 서버 저장 + 캐시 갱신 (일반 탭은 즉시 적용)
    const applyTts = (next: TtsSettings) => {
        setTtsDraft(next);
        updateTtsCache(next);
        api.setTtsSettings(next).catch(() => {/* 저장 실패는 무시(캐시/상태는 유지) */
        });
    };

    // 슬라이더 드래그 종료 시 현재 상태를 저장 (최신값 보장 위해 updater로 읽음)
    const commitTts = () => {
        setTtsDraft(cur => {
            updateTtsCache(cur);
            api.setTtsSettings(cur).catch(() => {
            });
            return cur;
        });
    };
    const [availableVoices, setAvailableVoices] = useState<SpeechSynthesisVoice[]>([]);
    const [installedVoiceNames, setInstalledVoiceNames] = useState<Set<string>>(new Set());
    const [ttsPreviewPlaying, setTtsPreviewPlaying] = useState(false);
    const [voiceInstallHint, setVoiceInstallHint] = useState(false);
    const [kokoroAvailable, setKokoroAvailable] = useState<boolean | null>(null);
    const previewAudioRef = useRef<AudioContext | null>(null);
    const previewSourceRef = useRef<AudioBufferSourceNode | null>(null);


    // AI 프로필 분석
    const [profileMaxLength, setProfileMaxLength] = useState('500');
    const [existingProfile, setExistingProfile] = useState<string | null>(null);
    const [existingNickname, setExistingNickname] = useState('');
    const [profileResponseStyle, setProfileResponseStyle] = useState('default');
    const [profileStyleSaving, setProfileStyleSaving] = useState(false);
    const [nicknameEdit, setNicknameEdit] = useState('');
    const [profileLoading, setProfileLoading] = useState(true);
    const [profileMode, setProfileMode] = useState<'view' | 'edit' | 'analyze'>('view');
    const [profileEditText, setProfileEditText] = useState('');
    const [profileSaving, setProfileSaving] = useState(false);
    const [profileState, setProfileState] = useState({
        status: '', current: 0, total: 0, currentTitle: '', done: false, error: '', profile: '', analysisCursor: '',
    });
    const profileAbortRef = useRef<(() => void) | null>(null);
    useEffect(() => {
        if (isOpen) {
            void loadStats();
            void refreshSkills().catch(() => {});
            setRestoreResult(null);
            setRestoreError('');
            api.getLlmLogging().then(r => {
                setLlmLogging(r.llm_logging);
            }).catch(() => {
            });
            api.getToolLogging().then(r => {
                setToolLogging(r.tool_logging);
            }).catch(() => {
            });
            api.getDebugLogging().then(r => {
                setDebugLogging(r.debug_logging);
            }).catch(() => {
            });
            api.getRuntimeSettings().then(r => {
                const loadedSettings = {...DEFAULT_RUNTIME_SETTINGS, ...r};
                setRuntimeSettings(loadedSettings);
                setRuntimeInputValues(toRuntimeInputValues(loadedSettings));
            }).catch(() => {});

            // TTS 설정 ES에서 로드
            fetchTtsSettings().then(s => setTtsDraft(s));

            // 영어 음성 목록
            const loadVoices = () => {
                const all = window.speechSynthesis?.getVoices() ?? [];
                const installed = new Set(all.map(v => v.name));
                setInstalledVoiceNames(installed);
                const enVoices = all.filter(v => VOICE_LIST.some(c => c.name === v.name));
                setAvailableVoices(enVoices);
                setTtsDraft(prev => {
                    if (!prev.enVoiceURI && enVoices.length > 0) {
                        const samantha = enVoices.find(v => v.name === 'Samantha') ?? enVoices[0];
                        return {...prev, enVoiceURI: samantha.voiceURI};
                    }
                    return prev;
                });
            };
            loadVoices();
            window.speechSynthesis?.addEventListener('voiceschanged', loadVoices);

            // Kokoro 사용 가능 여부 확인
            void getKokoroAvailability().then(setKokoroAvailable);

            // 프로필 로드
            setProfileLoading(true);
            setProfileMode('view');
            getUserProfile()
                .then(data => {
                    setExistingProfile(data?.profile || null);
                    setExistingNickname(data?.nickname || '');
                    setProfileResponseStyle(data?.response_style || 'default');
                })
                .catch(() => {
                    setExistingProfile(null);
                    setExistingNickname('');
                    setProfileResponseStyle('default');
                })
                .finally(() => setProfileLoading(false));

            return () => {
                window.speechSynthesis?.removeEventListener('voiceschanged', loadVoices);
                profileAbortRef.current?.();
            };
        }
    }, [isOpen]);

    useEffect(() => {
        if (!isOpen) return;
        const h = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                const eventOverlay = e.target instanceof Element
                    ? e.target.closest('.app-modal-overlay')
                    : null;
                if (eventOverlay && !eventOverlay.classList.contains('settings-overlay')) return;
                // 설정 내부의 데이터 보기 등 자식 모달이 열려 있으면 자식만 ESC를 처리한다.
                if (document.querySelector('.settings-overlay .app-modal-overlay')) return;
                const topmostOverlay = getTopmostModalOverlay();
                // 설정 위에 자식 모달이 열려 있으면 해당 모달이 ESC를 처리한다.
                if (!topmostOverlay?.classList.contains('settings-overlay')) return;
                e.preventDefault();
                if (showDriveAccountSelection) {
                    e.stopImmediatePropagation();
                    setShowDriveAccountSelection(false);
                    return;
                }
                // 복원 선택 중에는 ESC로 부모 설정창까지 닫히지 않도록 한다.
                if (backupPreview) {
                    e.stopImmediatePropagation();
                    return;
                }
                handleClose();
            }
        };
        // capture 단계에서 처리해야 다른 전역 ESC 핸들러보다 먼저 차단할 수 있다.
        window.addEventListener('keydown', h, true);
        return () => window.removeEventListener('keydown', h, true);
    }, [isOpen, handleClose, backupPreview, showDriveAccountSelection]);

    // 백업 탭 진입 시 Google Drive 사용 가능 여부를 최신 상태로 확인
    useEffect(() => {
        if (isOpen && tab === 'backup') {
            refreshGoogleWorkspaceStatus().then(status => {
                setGoogleDriveAvailable(status.connected);
                const connectedAccounts = status.accounts.filter(account => account.authenticated);
                const configuredAccountId = typeof status.config?.active_account_id === 'string'
                    ? status.config.active_account_id
                    : '';
                const activeAccountId = connectedAccounts.some(account => account.id === configuredAccountId)
                    ? configuredAccountId
                    : connectedAccounts[0]?.id || '';
                setDriveBackupAccounts(connectedAccounts);
                setActiveDriveBackupAccountId(activeAccountId);
                setSelectedDriveBackupAccountId(activeAccountId);
            }).catch(() => setGoogleDriveAvailable(false));
        }
    }, [isOpen, tab]);

    const DEFAULT_UNSELECTED = new Set(['rag_documents', 'rag_history', 'chat_file_chunks']);

    const loadStats = async () => {
        setStatsLoading(true);
        try {
            const res = await fetch('/api/backup/stats');
            const data = await res.json();
            setStats(Object.entries(data.stats || {}).map(([index, doc_count]) => ({
                index,
                doc_count: doc_count as number,
                selected: !DEFAULT_UNSELECTED.has(index)
            })));
        } catch {
            setStats([]);
        } finally {
            setStatsLoading(false);
        }
    };

    const toggleIndex = (index: string) => setStats(prev => prev.map(s => s.index === index ? {
        ...s,
        selected: !s.selected
    } : s));
    const toggleAll = () => {
        const all = stats.every(s => s.selected);
        setStats(prev => prev.map(s => ({...s, selected: !all})));
    };
    const selectedIndices = stats.filter(s => s.selected).map(s => s.index);
    const allSelected = stats.length > 0 && stats.every(s => s.selected);
    const isBackupExporting = exporting || exportingDrive;

    const handleExport = async () => {
        if (isBackupExporting) return;
        if (!selectedIndices.length) {
            toast.warning(t('backup.selectIndicesAlert'));
            return;
        }
        setExporting(true);
        try {
            const res = await fetch('/api/backup/export', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({indices: selectedIndices, include_files: includeFiles})
            });
            if (!res.ok) throw new Error(t('setup:exportFailed'));
            const blob = await res.blob();
            const now = new Date(), pad = (n: number) => String(n).padStart(2, '0');
            const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
            const a = document.createElement('a');
            const downloadUrl = URL.createObjectURL(blob);
            a.href = downloadUrl;
            // 파일 포함이면 zip, 아니면 json
            a.download = includeFiles ? `vyact_backup_${ts}.zip` : `vyact_backup_${ts}.json`;
            a.click();
            URL.revokeObjectURL(downloadUrl);
        } catch (e) {
            toast.error(t('backup.exportFailed', {error: String(e)}));
        } finally {
            setExporting(false);
        }
    };

    const handleExportToDrive = async (accountId?: string) => {
        if (isBackupExporting) return;
        if (!selectedIndices.length) {
            toast.warning(t('backup.selectIndicesAlert'));
            return;
        }
        if (!accountId && driveBackupAccounts.length > 1) {
            setSelectedDriveBackupAccountId(activeDriveBackupAccountId || driveBackupAccounts[0].id);
            setShowDriveAccountSelection(true);
            return;
        }
        const targetAccountId = accountId || driveBackupAccounts[0]?.id || activeDriveBackupAccountId;
        setShowDriveAccountSelection(false);
        setExportingDrive(true);
        try {
            const res = await fetch('/api/backup/export-to-drive', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({
                    indices: selectedIndices,
                    include_files: includeFiles,
                    account_id: targetAccountId || undefined,
                })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.detail || 'Upload failed');
            toast.success(t('backup.exportDriveSuccess', {name: data.file_name}), undefined, 5000, true);
        } catch (e) {
            toast.error(t('backup.exportDriveFailed', {error: String(e)}), undefined, undefined, true);
        } finally {
            setExportingDrive(false);
        }
    };

    const handleFileSelection = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        if (fileInputRef.current) fileInputRef.current.value = '';
        setPreviewLoading(true);
        setRestoreResult(null);
        setRestoreError('');
        try {
            const formData = new FormData();
            formData.append('file', file);
            const res = await fetch('/api/backup/preview', {method: 'POST', body: formData});
            const data = await res.json();
            if (!res.ok) throw new Error(data.detail || t('backup.previewFailed'));
            const preview = data as BackupPreview;
            setRestoreFile(file);
            setBackupPreview(preview);
            setRestoreIndices(preview.indices.filter(({name}) => name !== 'system_settings').map(({name}) => name));
            setRestoreFiles(preview.file_count > 0);
        } catch (e) {
            setRestoreError(String(e));
        } finally {
            setPreviewLoading(false);
        }
    };

    const closeRestorePreview = () => {
        if (importing) return;
        setRestoreFile(null);
        setBackupPreview(null);
    };

    const toggleRestoreIndex = (index: string) => {
        if (importing) return;
        setRestoreIndices(current => current.includes(index)
            ? current.filter(name => name !== index)
            : [...current, index]);
    };

    const handleRestore = async () => {
        if (importing || !restoreFile || !backupPreview || !restoreIndices.length) return;
        setImporting(true);
        setRestoreError('');
        try {
            const formData = new FormData();
            formData.append('file', restoreFile);
            formData.append('indices', JSON.stringify(restoreIndices));
            formData.append('restore_files', String(restoreFiles));
            const res = await fetch('/api/backup/import', {method: 'POST', body: formData});
            const data = await res.json();
            if (!res.ok) throw new Error(data.detail || t('backup.restoreComplete'));
            const detail = data.detail || {};
            const totalInserted = Object.values(detail).reduce((sum: number, v: any) => sum + (v.inserted ?? 0), 0);
            const totalSkipped = Object.values(detail).reduce((sum: number, v: any) => sum + (v.skipped ?? 0), 0);
            await loadStats();
            const googleMsg = data.google_auth_ok === false ? `\n⚠️ ${t('backup.googleExpired')}` : '';
            toast.success(t('backup.restoreCompleteAlert', {
                inserted: totalInserted,
                skipped: totalSkipped,
                googleMsg,
            }));
            setTimeout(() => window.location.reload(), 2000);
        } catch (e) {
            setRestoreError(String(e));
            setImporting(false);
        }
    };

    const previewPlayingRef = React.useRef(false);

    const handleTtsPreview = async () => {
        if (previewPlayingRef.current) {
            // 중지
            if (previewSourceRef.current) {
                try {
                    previewSourceRef.current.stop();
                } catch { /* ignore */
                }
                previewSourceRef.current = null;
            }
            window.speechSynthesis?.cancel();
            previewPlayingRef.current = false;
            setTtsPreviewPlaying(false);
            return;
        }

        previewPlayingRef.current = true;
        setTtsPreviewPlaying(true);

        if (kokoroAvailable && ttsDraft.kokoroVoice) {
            // Kokoro 미리 듣기
            try {
                const res = await fetch('/api/tts/kokoro/synthesize', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({
                        text: 'Hello. This is a voice preview.',
                        lang: getKokoroVoiceLanguage(ttsDraft.kokoroVoice),
                        voice: ttsDraft.kokoroVoice,
                        speed: ttsDraft.rate,
                    }),
                });
                if (!res.ok) throw new Error('Kokoro API error');
                const buf = await res.arrayBuffer();
                if (!previewAudioRef.current) previewAudioRef.current = new AudioContext();
                const audioBuffer = await previewAudioRef.current.decodeAudioData(buf);
                const source = previewAudioRef.current.createBufferSource();
                source.buffer = audioBuffer;
                const gain = previewAudioRef.current.createGain();
                gain.gain.value = ttsDraft.volume;
                source.connect(gain);
                gain.connect(previewAudioRef.current.destination);
                previewSourceRef.current = source;
                source.onended = () => {
                    previewPlayingRef.current = false;
                    previewSourceRef.current = null;
                    setTtsPreviewPlaying(false);
                };
                source.start();
            } catch {
                previewPlayingRef.current = false;
                setTtsPreviewPlaying(false);
            }
        } else {
            // Web Speech 미리 듣기 (폴백)
            if (!window.speechSynthesis) {
                previewPlayingRef.current = false;
                setTtsPreviewPlaying(false);
                return;
            }
            const selectedVoice = ttsDraft.enVoiceURI
                ? availableVoices.find(v => v.voiceURI === ttsDraft.enVoiceURI) ?? null
                : null;
            const u = new SpeechSynthesisUtterance('Hello. This is a voice preview.');
            u.lang = selectedVoice?.lang ?? 'en-US';
            u.rate = ttsDraft.rate;
            u.volume = ttsDraft.volume;
            if (selectedVoice) u.voice = selectedVoice;
            u.onend = () => {
                previewPlayingRef.current = false;
                setTtsPreviewPlaying(false);
            };
            u.onerror = () => {
                previewPlayingRef.current = false;
                setTtsPreviewPlaying(false);
            };
            window.speechSynthesis.speak(u);
        }
    };

    // ── 프로필 편집/분석 ──
    const profileMaxLengthLimit = Number.parseInt(profileMaxLength, 10) || 500;

    const handleProfileMaxLengthChange = (value: string) => {
        const limit = Number.parseInt(value, 10) || 500;
        setProfileMaxLength(value);
        setProfileEditText(current => current.slice(0, limit));
    };

    const profileEnterEdit = () => {
        setProfileEditText((existingProfile || '').slice(0, profileMaxLengthLimit));
        setNicknameEdit(existingNickname);
        setProfileMode('edit');
    };

    const profileHandleSave = async () => {
        setProfileSaving(true);
        try {
            await updateUserProfile({profile: profileEditText, nickname: nicknameEdit});
            setExistingProfile(profileEditText);
            setExistingNickname(nicknameEdit);
            setProfileMode('view');
        } catch (e) {
            console.error(e);
        } finally {
            setProfileSaving(false);
        }
    };

    const handleProfileResponseStyleChange = async (responseStyle: string) => {
        const previousStyle = profileResponseStyle;
        setProfileResponseStyle(responseStyle);
        setProfileStyleSaving(true);
        try {
            await updateUserProfile({response_style: responseStyle});
            toast.success(t('profile.responseStyleSaved'));
        } catch {
            setProfileResponseStyle(previousStyle);
            toast.error(t('profile.responseStyleSaveFailed'));
        } finally {
            setProfileStyleSaving(false);
        }
    };

    const profileStartAnalyze = () => {
        setProfileMode('analyze');
        setProfileState({
            status: t('profile.connecting'),
            current: 0,
            total: 0,
            currentTitle: '',
            done: false,
            error: '',
            profile: '',
            analysisCursor: ''
        });
        let cancelled = false;
        const run = async () => {
            try {
                const resp = await fetch('/api/remember', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({max_length: parseInt(profileMaxLength), language: i18n.language}),
                });
                const reader = resp.body!.getReader();
                const decoder = new TextDecoder();
                let buf = '';
                profileAbortRef.current = () => reader.cancel();
                while (true) {
                    const {done, value} = await reader.read();
                    if (done || cancelled) break;
                    buf += decoder.decode(value, {stream: true});
                    const parts = buf.split('\n\n');
                    buf = parts.pop() || '';
                    for (const part of parts) {
                        const eventMatch = part.match(/^event: (\w+)/m);
                        const dataMatch = part.match(/^data: (.+)/m);
                        if (!eventMatch || !dataMatch) continue;
                        const event = eventMatch[1];
                        const data = JSON.parse(dataMatch[1]);
                        if (event === 'status') setProfileState(s => ({...s, status: t('profile.analyzing')}));
                        else if (event === 'progress') setProfileState(s => ({
                            ...s,
                            status: t('profile.analyzing'),
                            current: data.current,
                            total: data.total,
                            currentTitle: data.title
                        }));
                        else if (event === 'done') {
                            setProfileState(s => ({
                                ...s,
                                done: true,
                                status: data.processed > 0
                                    ? t('profile.analysisComplete', {count: data.processed})
                                    : t('profile.noNewConversations'),
                                profile: data.profile,
                                analysisCursor: data.analysis_cursor || '',
                                current: data.processed,
                                total: data.processed
                            }));
                        } else if (event === 'error') setProfileState(s => ({...s, error: data.message}));
                    }
                }
            } catch (e: any) {
                if (!cancelled) setProfileState(s => ({...s, error: e.message}));
            }
        };
        run();
    };

    const applyAnalyzedProfile = async () => {
        if (!profileState.profile || !profileState.analysisCursor) return;
        setProfileSaving(true);
        try {
            await updateUserProfile({
                profile: profileState.profile,
                analysis_cursor: profileState.analysisCursor,
            });
            setExistingProfile(profileState.profile);
            setProfileMode('view');
            toast.success(t('profile.analysisApplied'));
        } catch {
            toast.error(t('profile.analysisApplyFailed'));
        } finally {
            setProfileSaving(false);
        }
    };

    const profilePercent = profileState.total > 0 ? Math.round((profileState.current / profileState.total) * 100) : 0;

    const PROFILE_MAX_LENGTH_OPTIONS = [
        {value: '500', label: `500 (${t('profile.concise')})`},
        {value: '1000', label: '1000'},
        {value: '2000', label: `2000 (${t('profile.default')})`},
        {value: '3000', label: `3000 (${t('profile.detailed')})`},
    ];
    const PROFILE_RESPONSE_STYLE_OPTIONS = [
        {value: 'default', label: t('profile.responseStyleDefault'), description: t('profile.responseStyleDefaultDescription')},
        {value: 'professional', label: t('profile.responseStyleProfessional'), description: t('profile.responseStyleProfessionalDescription')},
        {value: 'friendly', label: t('profile.responseStyleFriendly'), description: t('profile.responseStyleFriendlyDescription')},
        {value: 'candid', label: t('profile.responseStyleCandid'), description: t('profile.responseStyleCandidDescription')},
        {value: 'quirky', label: t('profile.responseStyleQuirky'), description: t('profile.responseStyleQuirkyDescription')},
        {value: 'efficient', label: t('profile.responseStyleEfficient'), description: t('profile.responseStyleEfficientDescription')},
        {value: 'cynical', label: t('profile.responseStyleCynical'), description: t('profile.responseStyleCynicalDescription')},
        {value: 'royal_court', label: t('profile.responseStyleRoyalCourt'), description: t('profile.responseStyleRoyalCourtDescription')},
    ];

    const LANGUAGE_OPTIONS = SUPPORTED_LANGUAGES.map(l => ({value: l.value, label: l.label}));

    if (!isOpen) return null;

    return (
        <ModalOverlay className="settings-overlay">
            <div
                className={`settings-modal${isBackupExporting ? ' settings-modal--backup-exporting' : ''}`}
                onClick={e => e.stopPropagation()}
                onDoubleClick={handlePluginTabUnlock}
            >

                <div className="settings-header">
                    <h3>{t('title')}</h3>
                    <button className="settings-close-btn" onClick={handleClose}>×</button>
                </div>

                {isBackupExporting && (
                    <div className="backup-progress-overlay" role="status" aria-live="polite" aria-busy="true">
                        <div className="backup-progress-card">
                            <span className="backup-progress-spinner" aria-hidden="true"/>
                            <strong>{exportingDrive ? t('backup.exportingDrive') : t('backup.exporting')}</strong>
                            <p>{exportingDrive ? t('backup.exportingDriveDetail') : t('backup.exportingLocalDetail')}</p>
                            <div className="backup-progress-track" aria-hidden="true"><span/></div>
                        </div>
                    </div>
                )}

                {showDriveAccountSelection && !isBackupExporting && (
                    <div className="drive-backup-account-overlay" role="presentation">
                        <section className="drive-backup-account-modal" role="dialog" aria-modal="true" aria-labelledby="drive-backup-account-title">
                            <h4 id="drive-backup-account-title">{t('backup.chooseDriveAccount')}</h4>
                            <p>{t('backup.chooseDriveAccountDescription')}</p>
                            <div className="drive-backup-account-list">
                                {driveBackupAccounts.map(account => (
                                    <label key={account.id} className={selectedDriveBackupAccountId === account.id ? 'selected' : ''}>
                                        <input type="radio" name="drive-backup-account" value={account.id}
                                               checked={selectedDriveBackupAccountId === account.id}
                                               onChange={() => setSelectedDriveBackupAccountId(account.id)}/>
                                        <span><strong>{account.email || account.id}</strong>{account.id === activeDriveBackupAccountId && <small>{t('backup.currentAccount')}</small>}</span>
                                    </label>
                                ))}
                            </div>
                            <div className="drive-backup-account-actions">
                                <button type="button" onClick={() => setShowDriveAccountSelection(false)}>{t('common:cancel')}</button>
                                <button type="button" className="primary" disabled={!selectedDriveBackupAccountId}
                                        onClick={() => void handleExportToDrive(selectedDriveBackupAccountId)}>{t('backup.continueBackup')}</button>
                            </div>
                        </section>
                    </div>
                )}

                <div className="settings-layout" aria-busy={isBackupExporting}>

                    <nav className="settings-sidebar">
                        {([
                            {key: 'general' as Tab, icon: '⚙️', label: t('tabs.general')},
                            {key: 'runtime' as Tab, icon: '🧠', label: t('tabs.runtime')},
                            {key: 'backup' as Tab, icon: '💾', label: t('tabs.backup')},
                            {key: 'api' as Tab, icon: '🔑', label: t('tabs.api')},
                            {key: 'externalData' as Tab, icon: '🌐', label: t('tabs.externalData')},
                            {key: 'skills' as Tab, icon: '🧩', label: t('tabs.skills')},
                            ...(isPluginTabVisible
                                ? [{key: 'plugins' as Tab, icon: '🔌', label: t('tabs.plugins')}]
                                : []),
                            {key: 'profile' as Tab, icon: '👤', label: t('tabs.profile')},
                        ]).map(item => (
                            <button
                                key={item.key}
                                className={`settings-sidebar-item${tab === item.key ? ' active' : ''}`}
                                onClick={() => setTab(item.key)}
                                disabled={isBackupExporting}
                            >
                                <span className="settings-sidebar-icon">{item.icon}</span>
                                {item.label}
                            </button>
                        ))}
                    </nav>

                    <div className={`settings-body${tab === 'backup' ? ' settings-body--backup' : ''}`}>

                        {tab === 'backup' && (
                            <div className={`settings-general settings-backup${isBackupExporting ? ' settings-backup--exporting' : ''}`} aria-busy={isBackupExporting}>
                                <div className="settings-section-label">
                                    <span>{t('backup.title')}</span>
                                    <button className="settings-refresh-btn" onClick={loadStats}
                                            disabled={statsLoading || isBackupExporting}>{statsLoading ? t('common:loading') : `↻ ${t('common:refresh')}`}</button>
                                </div>

                                {/* 원본 문서 포함 스위치 */}
                                <div className="settings-include-files-card">
                                    <div>
                                        <div className="settings-toggle-title">{t('backup.includeFiles')}</div>
                                        <div className="settings-toggle-desc">
                                            {includeFiles ? t('backup.includeFilesDescOn') : t('backup.includeFilesDescOff')}
                                        </div>
                                    </div>
                                    <div
                                        className="settings-switch-track"
                                                onClick={() => !isBackupExporting && setIncludeFiles(v => !v)}
                                        style={{background: includeFiles ? 'var(--accent)' : 'var(--border)'}}
                                    >
                                        <div className="settings-switch-knob"
                                             style={{left: includeFiles ? '21px' : '3px'}}/>
                                    </div>
                                </div>

                                <div className={`settings-backup-select-header${stats.length === 0 ? ' is-placeholder' : ''}`}>
                                    {stats.length > 0 && (
                                        <>
                                        <span className="settings-backup-select-label">{t('backup.selectIndices', {
                                            selected: selectedIndices.length,
                                            total: stats.length
                                        })}</span>
                                        <button className="settings-btn-select-all"
                                                onClick={toggleAll} disabled={isBackupExporting}>{allSelected ? t('common:deselectAll') : t('common:selectAll')}</button>
                                        </>
                                    )}
                                </div>

                                <div className="settings-index-box settings-backup-index-box">
                                    <div className="settings-index-list">
                                        {statsLoading && stats.length === 0 ?
                                            <div className="settings-index-empty">{t('common:loading')}</div>
                                            : stats.length === 0 ?
                                                <div className="settings-index-empty">{t('backup.noIndex')}</div>
                                                : stats.map(s => (
                                                    <div key={s.index}
                                                         className={`settings-index-item ${s.selected ? 'checked' : ''}`}
                                                         onClick={() => !isBackupExporting && toggleIndex(s.index)}>
                                                        <input type="checkbox" checked={s.selected}
                                                               disabled={isBackupExporting}
                                                               onChange={() => toggleIndex(s.index)}
                                                               onClick={e => e.stopPropagation()}/>
                                                        <Tooltip content={getBackupIndexHelp(s.index)} multiline>
                                                            <span className="settings-tooltip" tabIndex={0}
                                                                  onClick={e => e.stopPropagation()}>?</span>
                                                        </Tooltip>
                                                        <div className="settings-index-info">
                                                            <span className="settings-index-name">{s.index}</span>
                                                            <span
                                                                className="settings-index-count">{s.doc_count.toLocaleString()}건</span>
                                                        </div>
                                                    </div>
                                                ))}
                                    </div>
                                </div>

                                <div className="settings-btn-row">
                                    {googleDriveAvailable ? (
                                        <>
                                            <button className="settings-btn-export" onClick={handleExport}
                                                    disabled={isBackupExporting || statsLoading || !selectedIndices.length}>
                                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                                                     stroke="currentColor" strokeWidth="2">
                                                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                                                    <polyline points="7 10 12 15 17 10"/>
                                                    <line x1="12" y1="15" x2="12" y2="3"/>
                                                </svg>
                                                {exporting ? t('backup.exporting') : t('backup.exportLocal')}
                                            </button>
                                            <button className="settings-btn-export settings-btn-export--drive" onClick={() => void handleExportToDrive()}
                                                    disabled={isBackupExporting || statsLoading || !selectedIndices.length}>
                                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                                                     stroke="currentColor" strokeWidth="2">
                                                    <path d="M12 15V3m0 0l-4 4m4-4l4 4"/>
                                                    <path d="M2 17l.621 2.485A2 2 0 0 0 4.561 21h14.878a2 2 0 0 0 1.94-1.515L22 17"/>
                                                    <path d="M5 17h14"/>
                                                </svg>
                                                {exportingDrive ? t('backup.exportingDrive') : t('backup.exportDrive')}
                                            </button>
                                        </>
                                    ) : (
                                        <button className="settings-btn-export" onClick={handleExport}
                                                disabled={isBackupExporting || statsLoading || !selectedIndices.length}>
                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                                                 stroke="currentColor" strokeWidth="2">
                                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                                                <polyline points="7 10 12 15 17 10"/>
                                                <line x1="12" y1="15" x2="12" y2="3"/>
                                            </svg>
                                            {exporting ? t('backup.exporting') : t('backup.export', {count: selectedIndices.length})}
                                        </button>
                                    )}
                                    <button className="settings-btn-import"
                                            onClick={() => fileInputRef.current?.click()}
                                            disabled={isBackupExporting || importing || previewLoading}>
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                                             stroke="currentColor"
                                             strokeWidth="2">
                                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                                            <polyline points="17 8 12 3 7 8"/>
                                            <line x1="12" y1="3" x2="12" y2="15"/>
                                        </svg>
                                        {importing ? t('backup.importing') : previewLoading ? t('common:loading') : t('backup.import')}
                                    </button>
                                </div>
                                <input ref={fileInputRef} type="file" accept=".json,.zip" onChange={handleFileSelection}
                                       className="settings-file-input-hidden"/>

                                {restoreError && <div className="settings-result-error">❌ {restoreError}</div>}
                                {restoreResult && (
                                    <div className="settings-result-success">
                                        <div className="settings-result-success-header">{t('backup.restoreComplete')}</div>
                                        {restoreResult.map(r => (
                                            <div key={r.index} className="settings-result-row">
                                                <span className="settings-result-index">{r.index}</span>
                                                <span
                                                    className="settings-result-counts">{t('backup.newCount', {count: r.inserted})} · {t('backup.skipCount', {count: r.skipped})}{r.error &&
                                                    <span className="settings-result-warn"> ⚠️</span>}</span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}

                        {tab === 'general' && (
                            <div className="settings-general">

                                {/* ── 언어 설정 ── */}
                                <div className="settings-general-section">
                                    <div className="settings-toggle-row settings-language-row">
                                        <div className="settings-toggle-title">{t('general.language')}</div>
                                        <div style={{width: '180px'}}>
                                            <CustomSelect
                                                options={LANGUAGE_OPTIONS}
                                                value={i18n.language}
                                                onChange={(lang) => changeLanguage(lang)}
                                                triggerStyle={{
                                                    fontSize: '13px',
                                                    padding: '5px 10px',
                                                    width: '100%' // 이제 부모(160px)를 꽉 채우도록 설정
                                                }}
                                            />
                                        </div>

                                    </div>
                                </div>

                                {/* ── 부팅 시 자동 시작 ── */}
                                {isElectron && (
                                    <div className="settings-general-section">
                                        <div className="settings-toggle-row">
                                            <div>
                                                <div className="settings-toggle-title">{t('general.autoStart')}</div>
                                                <div className="settings-toggle-desc">{t('general.autoStartDesc')}</div>
                                            </div>
                                            <label className="settings-switch">
                                                <input type="checkbox" checked={autoStart}
                                                       onChange={async e => {
                                                           const v = e.target.checked;
                                                           setAutoStart(v);
                                                           try {
                                                               await window.ragAPI?.setLoginItem?.(v);
                                                           } catch {
                                                               setAutoStart(!v);
                                                           }  // 실패 시 롤백
                                                       }}/>
                                                <span className="settings-switch-slider"/>
                                            </label>
                                        </div>
                                    </div>
                                )}

                                {/* ── LLM 로그 ── */}
                                <div className="settings-general-section">
                                    <div className="settings-toggle-row">
                                        <div>
                                            <div className="settings-toggle-title">{t('general.llmLog')}</div>
                                            <div className="settings-toggle-desc">{t('general.llmLogDesc')}</div>
                                        </div>
                                        <label className="settings-switch">
                                            <input type="checkbox" checked={llmLogging}
                                                   onChange={async e => {
                                                       const v = e.target.checked;
                                                       setLlmLogging(v);
                                                       try {
                                                           await api.setLlmLogging(v);
                                                       } catch {
                                                           setLlmLogging(!v);
                                                       }  // 실패 시 롤백
                                                   }}/>
                                            <span className="settings-switch-slider"/>
                                        </label>
                                    </div>
                                </div>

                                {/* ── Tool 로그 ── */}
                                <div className="settings-general-section">
                                    <div className="settings-toggle-row">
                                        <div>
                                            <div className="settings-toggle-title">{t('general.toolLog')}</div>
                                            <div className="settings-toggle-desc">{t('general.toolLogDesc')}</div>
                                        </div>
                                        <label className="settings-switch">
                                            <input type="checkbox" checked={toolLogging}
                                                   onChange={async e => {
                                                       const v = e.target.checked;
                                                       setToolLogging(v);
                                                       try {
                                                           await api.setToolLogging(v);
                                                       } catch {
                                                           setToolLogging(!v);
                                                       }
                                                   }}/>
                                            <span className="settings-switch-slider"/>
                                        </label>
                                    </div>
                                </div>

                                {/* ── Debug 모드 ── */}
                                <div className="settings-general-section">
                                    <div className="settings-toggle-row">
                                        <div>
                                            <div className="settings-toggle-title">{t('general.debugLog')}</div>
                                            <div className="settings-toggle-desc">{t('general.debugLogDesc')}</div>
                                        </div>
                                        <label className="settings-switch">
                                            <input type="checkbox" checked={debugLogging}
                                                   disabled={debugLoggingRestarting}
                                                   onChange={async e => {
                                                       const v = e.target.checked;
                                                       setDebugLogging(v);
                                                       let restartToastId = '';
                                                       let isVyact = false;
                                                       try {
                                                           const providers = await api.getProviders();
                                                           isVyact = providers.current_type === 'vyact';
                                                           if (isVyact) {
                                                               setDebugLoggingRestarting(true);
                                                               restartToastId = toast.info(t('general.vyactRestarting'), undefined, 0);
                                                           }
                                                           const result = await api.setDebugLogging(v);
                                                           if (restartToastId) toast.dismiss(restartToastId);
                                                           if (result.runtime_restarted) toast.success(t('general.vyactRestarted'));
                                                       } catch {
                                                           if (restartToastId) toast.dismiss(restartToastId);
                                                           setDebugLogging(!v);
                                                           if (isVyact) toast.error(t('general.vyactRestartFailed'));
                                                       } finally {
                                                           setDebugLoggingRestarting(false);
                                                       }
                                                   }}/>
                                            <span className="settings-switch-slider"/>
                                        </label>
                                    </div>
                                </div>

                                {/* 모델 설정은 별도 탭에서 관리 */}

                                {/* MCP 서버 관리는 '연동 설정' 탭으로 이동됨 */}


                                {/* ── TTS 음성 설정 ── */}
                                <div className="settings-general-section">
                                    <div className="settings-mcp-provider">
                                        <div className="settings-mcp-provider-header">
                                            <span className="settings-mcp-provider-name">{t('general.ttsTitle')}</span>
                                            {kokoroAvailable !== null && (
                                                <span className="settings-mcp-coming">
                                                {kokoroAvailable ? t('general.kokoroActive') : t('general.webSpeechMode')}
                                            </span>
                                            )}
                                        </div>
                                        <div className="settings-tts-body">

                                            {kokoroAvailable ? (
                                                <>
                                                    {/* Kokoro 음성 선택 */}
                                                    <label className="settings-tts-label settings-tts-label--block">
                                                        {t('general.kokoroVoice')}
                                                    </label>
                                                    <div className="settings-tts-custom-select">
                                                        <div className="settings-tts-custom-options">
                                                            {KOKORO_VOICES.map(({value, name, lang}) => {
                                                                const prefix = value.slice(0, 2);
                                                                const descKey = KOKORO_PREFIX_DESC[prefix] || prefix;
                                                                const voiceLabel = `${name} — ${t(`general.voiceDesc.${descKey}`)}`;
                                                                const isSelected = ttsDraft.kokoroVoice === value
                                                                    || (!ttsDraft.kokoroVoice && value === 'af_heart');
                                                                return (
                                                                    <div
                                                                        key={value}
                                                                        className={`settings-tts-custom-option${isSelected ? ' selected' : ''}`}
                                                                        onClick={() => {
                                                                            if (previewPlayingRef.current) {
                                                                                if (previewSourceRef.current) {
                                                                                    try {
                                                                                        previewSourceRef.current.stop();
                                                                                    } catch { /* */
                                                                                    }
                                                                                    previewSourceRef.current = null;
                                                                                }
                                                                                previewPlayingRef.current = false;
                                                                                setTtsPreviewPlaying(false);
                                                                            }
                                                                            applyTts({...ttsDraft, kokoroVoice: value});
                                                                        }}
                                                                    >
                                                                        <span>{lang} {voiceLabel}</span>
                                                                        {isSelected && <span
                                                                            className="settings-tts-check">✓</span>}
                                                                    </div>
                                                                );
                                                            })}
                                                        </div>
                                                    </div>
                                                    <p className="settings-hint settings-hint--spaced">
                                                        {t('general.kokoroHint')}
                                                    </p>
                                                </>
                                            ) : (
                                                <>
                                                    {/* Web Speech 폴백 — 기존 영어 음성 선택 */}
                                                    <label className="settings-tts-label settings-tts-label--block">
                                                        {t('general.enVoice')}
                                                    </label>
                                                    <div className="settings-tts-custom-select">
                                                        <div className="settings-tts-custom-options">
                                                            {VOICE_LIST.map(({name, descKey}) => {
                                                                const voiceLabel = `${name} — ${t(`general.voiceDesc.${descKey}`)}`;
                                                                const voice = availableVoices.find(v => v.name === name);
                                                                const installed = installedVoiceNames.has(name);
                                                                const selectedVoice = availableVoices.find(v => v.voiceURI === ttsDraft.enVoiceURI);
                                                                const isSelected = selectedVoice?.name === name;
                                                                return (
                                                                    <div
                                                                        key={name}
                                                                        className={`settings-tts-custom-option${isSelected ? ' selected' : ''}${!installed ? ' not-installed' : ''}`}
                                                                        onClick={() => {
                                                                            if (previewPlayingRef.current) {
                                                                                window.speechSynthesis.cancel();
                                                                                previewPlayingRef.current = false;
                                                                                setTtsPreviewPlaying(false);
                                                                            }
                                                                            if (!installed) {
                                                                                setVoiceInstallHint(true);
                                                                                return;
                                                                            }
                                                                            setVoiceInstallHint(false);
                                                                            applyTts({
                                                                                ...ttsDraft,
                                                                                enVoiceURI: voice!.voiceURI
                                                                            });
                                                                        }}
                                                                    >
                                                                        <span>{installed ? voiceLabel : `${voiceLabel} (${t('general.notInstalled')})`}</span>
                                                                        {isSelected && <span
                                                                            className="settings-tts-check">✓</span>}
                                                                    </div>
                                                                );
                                                            })}
                                                        </div>
                                                    </div>

                                                    {voiceInstallHint && (
                                                        <div className="settings-tts-install-hint">
                                                            <span>{t('general.voiceNotInstalled')}</span>
                                                            <span>{t('general.voiceInstallGuide')}</span>
                                                            <div className="settings-tts-install-hint-btns">
                                                                <a href="x-apple.systempreferences:com.apple.Accessibility-Settings.extension?SpeechSettings"
                                                                   className="settings-tts-install-link-btn">⚙ {t('general.openSettings')}</a>
                                                                <button
                                                                    onClick={() => setVoiceInstallHint(false)}>{t('common:close')}</button>
                                                            </div>
                                                        </div>
                                                    )}
                                                    <p className="settings-hint settings-hint--spaced">
                                                        {t('general.enVoiceHint')}
                                                    </p>
                                                </>
                                            )}

                                            {/* 속도 + 볼륨 한 줄 50%씩 */}
                                            <div className="settings-tts-sliders-row">
                                                <div className="settings-tts-slider-half">
                                                    <div className="settings-tts-slider-header">
                                                        <span
                                                            className="settings-tts-slider-name">{t('general.speed')}</span>
                                                        <span
                                                            className="settings-tts-value">{ttsDraft.rate.toFixed(1)}x</span>
                                                    </div>
                                                    <div className="settings-tts-slider-wrap">
                                                        <span className="settings-tts-tick">0.5</span>
                                                        <input type="range" min="0.5" max="2.0" step="0.1"
                                                               value={ttsDraft.rate}
                                                               onChange={e => setTtsDraft(prev => ({
                                                                   ...prev,
                                                                   rate: parseFloat(e.target.value)
                                                               }))}
                                                               onMouseUp={commitTts}
                                                               onTouchEnd={commitTts}
                                                               className="settings-tts-slider"/>
                                                        <span className="settings-tts-tick">2.0</span>
                                                    </div>
                                                </div>
                                                <div className="settings-tts-slider-half">
                                                    <div className="settings-tts-slider-header">
                                                        <span
                                                            className="settings-tts-slider-name">{t('general.volume')}</span>
                                                        <span
                                                            className="settings-tts-value">{Math.round(ttsDraft.volume * 100)}%</span>
                                                    </div>
                                                    <div className="settings-tts-slider-wrap">
                                                        <span className="settings-tts-tick">0%</span>
                                                        <input type="range" min="0" max="1" step="0.05"
                                                               value={ttsDraft.volume}
                                                               onChange={e => setTtsDraft(prev => ({
                                                                   ...prev,
                                                                   volume: parseFloat(e.target.value)
                                                               }))}
                                                               onMouseUp={commitTts}
                                                               onTouchEnd={commitTts}
                                                               className="settings-tts-slider"/>
                                                        <span className="settings-tts-tick">100%</span>
                                                    </div>
                                                </div>
                                            </div>

                                            {/* 미리보기 */}
                                            <button className="settings-tts-preview-btn" onClick={handleTtsPreview}>
                                                {ttsPreviewPlaying ? (
                                                    <>
                                                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
                                                             stroke="currentColor" strokeWidth="2">
                                                            <rect x="6" y="4" width="4" height="16"/>
                                                            <rect x="14" y="4" width="4" height="16"/>
                                                        </svg>
                                                        {t('general.stop')}
                                                    </>
                                                ) : (
                                                    <>
                                                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
                                                             stroke="currentColor" strokeWidth="2">
                                                            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
                                                            <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
                                                        </svg>
                                                        {t('general.preview')}
                                                    </>
                                                )}
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}

                        {tab === 'runtime' && (
                            <div className="settings-general settings-runtime-settings">
                                <div className="settings-runtime-heading">
                                    <div>
                                        <div className="settings-toggle-title">{t('runtime.title')}</div>
                                        <div className="settings-toggle-desc">{t('runtime.description')}</div>
                                    </div>
                                    <div className="settings-runtime-actions">
                                        <span className={`settings-runtime-saved${runtimeSaved ? ' is-visible' : ''}`} aria-label={runtimeSaved ? t('runtime.saving') : undefined}>
                                            <svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m3 8 3 3 7-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                                        </span>
                                        <button className="settings-runtime-reset" type="button" onClick={restoreDefaultRuntimeSettings} disabled={runtimeSaving}>
                                            {t('general.restoreDefaults')}
                                        </button>
                                    </div>
                                </div>
                                {RUNTIME_SETTING_SECTIONS.map(section => (
                                    <div className="settings-runtime-group" key={section.key}>
                                        <div className="settings-runtime-group-title">{t(`runtime.sections.${section.key}`)}</div>
                                        {section.fields.map(key => {
                                            return <label className="settings-runtime-row" key={key}>
                                                <span className="settings-runtime-label">
                                                    <span className="settings-tooltip" tabIndex={0} aria-label={t('runtime.help')}>
                                                        ?<span className="settings-tooltip-content">{t(`runtime.fields.${key}.help`)}</span>
                                                    </span>
                                                    {t(`runtime.fields.${key}.label`)}
                                                </span>
                                                <span className="settings-runtime-input-wrap">
                                                    <span className={`settings-runtime-saved settings-runtime-field-saved${runtimeSavedField === key ? ' is-visible' : ''}`} aria-label={runtimeSavedField === key ? t('runtime.saving') : undefined}>
                                                        <svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m3 8 3 3 7-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                                                    </span>
                                                    <input className="settings-runtime-input" type="text" inputMode="decimal" value={runtimeInputValues[key] ?? ''}
                                                       placeholder={DEFAULT_RUNTIME_SETTINGS[key] === null ? '-' : ''}
                                                       onChange={e => {
                                                           const rawValue = e.currentTarget.value;
                                                           if (rawValue !== '' && !/^-?\d*\.?\d*$/.test(rawValue)) return;
                                                           setRuntimeInputValues(current => ({...current, [key]: rawValue}));
                                                           const value = Number(rawValue);
                                                           if (rawValue !== '' && Number.isFinite(value)) {
                                                               setRuntimeSettings(current => ({...current, [key]: value}));
                                                           }
                                                       }}
                                                       onBlur={async e => {
                                                           const raw = e.currentTarget.value.trim();
                                                           if (raw === '') {
                                                               const nextSettings = {...runtimeSettings, [key]: null};
                                                               setRuntimeSettings(nextSettings);
                                                               setRuntimeInputValues(current => ({...current, [key]: ''}));
                                                               await saveRuntimeSettings(nextSettings, key);
                                                               return;
                                                           }
                                                           const value = Number(raw);
                                                           if (!Number.isFinite(value)) {
                                                               setRuntimeInputValues(current => ({...current, [key]: runtimeSettings[key] === null ? '' : String(runtimeSettings[key])}));
                                                               return;
                                                           }
                                                           const normalized = normalizeRuntimeSetting(key, value);
                                                           const nextSettings = {...runtimeSettings, [key]: normalized};
                                                           setRuntimeSettings(nextSettings);
                                                           await saveRuntimeSettings(nextSettings, key);
                                                       }}
                                                       onKeyDown={async e => {
                                                           if (e.key !== 'Enter') return;
                                                           e.preventDefault();
                                                           const value = Number(runtimeInputValues[key]);
                                                           if (!Number.isFinite(value)) return;
                                                           const normalized = normalizeRuntimeSetting(key, value);
                                                           const nextSettings = {...runtimeSettings, [key]: normalized};
                                                           setRuntimeSettings(nextSettings);
                                                           await saveRuntimeSettings(nextSettings, key);
                                                       }}/>
                                                </span>
                                            </label>
                                        })}
                                    </div>
                                ))}
                            </div>
                        )}

                        {tab === 'api' && (
                            <div className="settings-general">

                                {/* ── MCP 서버 (신규 통합 관리) ── */}
                                <div className="settings-general-section">
                                    <McpServersSection/>
                                </div>
                            </div>
                        )}

                        {tab === 'externalData' && (
                            <div className="settings-general">
                                <ExternalDataSection/>
                            </div>
                        )}

                        {tab === 'skills' && (
                            <div className="settings-general"
                                 style={{flex: 1, display: 'flex', flexDirection: 'column'}}>
                                <SkillsSection/>
                            </div>
                        )}

                        {tab === 'plugins' && (
                            <div className="settings-general">
                                <PluginsSection/>
                            </div>
                        )}

                        {tab === 'profile' && (
                            <div className="settings-general">
                                {/* 최대 글자 수 — 보기/편집 공통 */}
                                {(profileMode === 'view' || profileMode === 'edit') && (
                                    <div className="settings-general-section settings-profile-preferences-card">
                                        <div className="remember-setup-row">
                                            <span className="settings-profile-preference-copy"><span>{t('profile.responseStyle')}</span><small>{t('profile.responseStyleDescription')}</small></span>
                                            <CustomSelect
                                                options={PROFILE_RESPONSE_STYLE_OPTIONS}
                                                value={profileResponseStyle}
                                                disabled={profileStyleSaving}
                                                onChange={value => void handleProfileResponseStyleChange(value)}
                                                className="settings-profile-style-select"
                                                dropdownClassName="settings-profile-style-dropdown"
                                                portal
                                                triggerStyle={{fontSize: '13px', padding: '8px 10px'}}
                                            />
                                        </div>
                                        <div className="remember-setup-row">
                                            <span className="settings-profile-preference-copy"><span>{t('profile.maxLength')}</span><small>{t('profile.maxLengthDescription')}</small></span>
                                            <CustomSelect
                                                options={PROFILE_MAX_LENGTH_OPTIONS}
                                                value={profileMaxLength}
                                                onChange={handleProfileMaxLengthChange}
                                                className="settings-profile-length-select"
                                                triggerStyle={{fontSize: '13px', padding: '8px 10px'}}
                                            />
                                        </div>
                                    </div>
                                )}

                                {profileMode === 'view' && (
                                    <>
                                        <div className="settings-general-section">
                                            <div className="remember-setup-row">
                                                <span className="remember-setup-label">{t('profile.nickname')}</span>
                                                <span style={{
                                                    fontSize: '14px',
                                                    color: 'var(--text)',
                                                    opacity: existingNickname ? 1 : 0.4
                                                }}>
                                                    {existingNickname || t('common:notSet')}
                                                </span>
                                            </div>
                                        </div>
                                        <div className="settings-general-section settings-profile-content">
                                            <div className="settings-profile-label">{t('profile.currentProfile')}</div>
                                            {profileLoading ? (
                                                <div className="remember-profile-loading">{t('profile.checking')}</div>
                                            ) : existingProfile ? (
                                                <div className="remember-profile-text">{existingProfile}</div>
                                            ) : (
                                                <div className="remember-profile-empty">{t('profile.noProfile')}</div>
                                            )}
                                        </div>
                                        <div className="settings-profile-actions">
                                            <button className="remember-edit-btn" onClick={profileEnterEdit}
                                                    disabled={profileLoading}>
                                                {t('common:edit')}
                                            </button>
                                            <button className="remember-start-btn" onClick={profileStartAnalyze}>
                                                {t('profile.aiAnalyze')}
                                            </button>
                                        </div>
                                    </>
                                )}
                                {profileMode === 'edit' && (
                                    <>
                                        <div className="settings-general-section">
                                            <div className="remember-setup-row">
                                                <span className="remember-setup-label">{t('profile.nickname')}</span>
                                                <input
                                                    type="text"
                                                    value={nicknameEdit}
                                                    onChange={e => setNicknameEdit(e.target.value)}
                                                    placeholder={t('profile.nicknamePlaceholder')}
                                                    style={{
                                                        flex: 1,
                                                        background: 'var(--surface2)',
                                                        border: '1px solid var(--border)',
                                                        borderRadius: '6px',
                                                        padding: '6px 10px',
                                                        color: 'var(--text)',
                                                        fontSize: '13px',
                                                        outline: 'none',
                                                    }}
                                                />
                                            </div>
                                        </div>
                                        <div className="settings-general-section settings-profile-content">
                                            <div className="settings-profile-label">{t('profile.editProfile')}</div>
                                            <textarea
                                                className="remember-edit-textarea"
                                                value={profileEditText}
                                                maxLength={profileMaxLengthLimit}
                                                onChange={e => setProfileEditText(e.target.value.slice(0, profileMaxLengthLimit))}
                                                placeholder={t('profile.editPlaceholder')}
                                                autoFocus
                                            />
                                            <div
                                                className="remember-edit-count">{t('profile.charCount', {
                                                    count: profileEditText.length,
                                                    max: profileMaxLengthLimit,
                                                })}</div>
                                        </div>
                                        <div className="settings-profile-actions">
                                            <button className="remember-cancel-btn"
                                                    onClick={() => setProfileMode('view')}>{t('common:cancel')}</button>
                                            <button className="remember-start-btn" onClick={profileHandleSave}
                                                    disabled={profileSaving}>
                                                {profileSaving ? t('common:saving') : t('common:save')}
                                            </button>
                                        </div>
                                    </>
                                )}
                                {profileMode === 'analyze' && !profileState.done && !profileState.error && (
                                    <div className="settings-general-section">
                                        <div className="remember-progress">
                                            <div className="remember-status">{profileState.status}</div>
                                            {profileState.total > 0 && (
                                                <>
                                                    <div className="remember-bar-wrap">
                                                        <div className="remember-bar"
                                                             style={{width: `${profilePercent}%`}}/>
                                                    </div>
                                                    <div className="remember-count">
                                                        {profileState.current} / {profileState.total}
                                                        {profileState.currentTitle && <span
                                                            className="remember-cur-title"> — {profileState.currentTitle}</span>}
                                                    </div>
                                                </>
                                            )}
                                            <div className="remember-spinner"/>
                                        </div>
                                    </div>
                                )}
                                {profileMode === 'analyze' && profileState.error && (
                                    <div className="settings-general-section">
                                        <div className="remember-error">❌ {profileState.error}</div>
                                        <div className="settings-profile-actions">
                                            <button className="remember-cancel-btn"
                                                    onClick={() => setProfileMode('view')}>{t('common:back')}</button>
                                        </div>
                                    </div>
                                )}
                                {profileMode === 'analyze' && profileState.done && (
                                    <>
                                        <div className="settings-general-section">
                                            <div className="remember-done-msg">✅ {profileState.status}</div>
                                            {profileState.profile && (
                                                <div className="remember-profile-preview" style={{marginTop: '14px'}}>
                                                    <div
                                                        className="settings-profile-label">{t('profile.analyzedProfile')}</div>
                                                    <div className="remember-profile-text">{profileState.profile}</div>
                                                </div>
                                            )}
                                        </div>
                                        <div className="settings-profile-actions">
                                            <button className="remember-cancel-btn"
                                                    onClick={() => setProfileMode('view')}>{t('profile.discardAnalysis')}</button>
                                            {profileState.current > 0 && <button className="remember-start-btn"
                                                    disabled={profileSaving || !profileState.analysisCursor}
                                                    onClick={() => void applyAnalyzedProfile()}>
                                                {profileSaving ? t('common:saving') : t('profile.applyAnalysis')}
                                            </button>}
                                        </div>
                                    </>
                                )}
                            </div>
                        )}

                    </div>
                    {/* settings-body */}

                </div>
                {/* settings-layout */}
                {backupPreview && restoreFile && (
                    <div className="restore-preview-backdrop" onClick={closeRestorePreview}>
                        <section className="restore-preview-modal" role="dialog" aria-modal="true"
                                 aria-labelledby="restore-preview-title" onClick={e => e.stopPropagation()}>
                            <div className="restore-preview-header">
                                <div>
                                    <span className="restore-preview-eyebrow">BACKUP RESTORE</span>
                                    <h4 id="restore-preview-title">{t('backup.previewTitle')}</h4>
                                    <p>{restoreFile.name}</p>
                                </div>
                                <button className="restore-preview-close" onClick={closeRestorePreview} disabled={importing} aria-label={t('common:close')}>×</button>
                            </div>
                            <div className="restore-preview-note">{t('backup.previewDescription')}</div>
                            <div className="restore-preview-selection-header">
                                <span>{t('backup.restoreIndices', {selected: restoreIndices.length, total: backupPreview.indices.length})}</span>
                                <button disabled={importing} onClick={() => setRestoreIndices(restoreIndices.length === backupPreview.indices.length ? [] : backupPreview.indices.map(({name}) => name))}>
                                    {restoreIndices.length === backupPreview.indices.length ? t('common:deselectAll') : t('common:selectAll')}
                                </button>
                            </div>
                            <div className="restore-preview-list">
                                {backupPreview.indices.map(({name, count}) => {
                                    const isSettings = name === 'system_settings';
                                    return <label key={name} className={`restore-preview-item ${restoreIndices.includes(name) ? 'checked' : ''}`}>
                                        <input type="checkbox" checked={restoreIndices.includes(name)} disabled={importing} onChange={() => toggleRestoreIndex(name)}/>
                                        <Tooltip content={getBackupIndexHelp(name)} multiline>
                                            <span className="settings-tooltip" tabIndex={0} onClick={e => e.preventDefault()}>?</span>
                                        </Tooltip>
                                        <span className="restore-preview-item-main"><strong>{name}</strong>{isSettings && <small>{t('backup.settingsOverwrite')}</small>}</span>
                                        <span>{t('backup.documentCount', {count})}</span>
                                    </label>;
                                })}
                            </div>
                            {backupPreview.file_count > 0 && <label className="restore-preview-files">
                                <input type="checkbox" checked={restoreFiles} disabled={importing} onChange={e => setRestoreFiles(e.target.checked)}/>
                                <span><strong>{t('backup.restoreFiles')}</strong><small>{t('backup.restoreFilesDesc', {count: backupPreview.file_count})}</small></span>
                            </label>}
                            <div className="restore-preview-actions">
                                <button className="restore-preview-cancel" onClick={closeRestorePreview} disabled={importing}>{t('common:cancel')}</button>
                                <button className="restore-preview-confirm" onClick={handleRestore} disabled={importing || !restoreIndices.length}>
                                    {importing ? t('backup.importing') : t('backup.restoreSelected', {count: restoreIndices.length})}
                                </button>
                            </div>
                        </section>
                    </div>
                )}
            </div>
        </ModalOverlay>
    );
};

export default SettingsModal;
