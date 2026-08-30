import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import './RememberModal.css';
import CustomSelect from '../CustomSelect/CustomSelect';
import ModalOverlay from '../common/ModalOverlay/ModalOverlay';
import {getUserProfile, updateUserProfile} from '../../services/userProfile';

interface RememberModalProps {
    onClose: () => void;
    onDone: (profile: string, message: string) => void;
}

interface ProgressState {
    status: string;
    current: number;
    total: number;
    currentTitle: string;
    done: boolean;
    error: string;
    profile: string;
}

type Mode = 'view' | 'edit' | 'analyze';

const RememberModal: React.FC<RememberModalProps> = ({onClose, onDone }) => {
    const {t, i18n} = useTranslation('main');
    const maxLengthOptions = [500, 1000, 2000, 3000].map(value => ({
        value: String(value),
        label: t(`rememberModal.length${value}`, {count: value}),
    }));
    const [maxLength, setMaxLength] = useState('2000');
    const [existingProfile, setExistingProfile] = useState<string | null>(null);
    const [profileLoading, setProfileLoading] = useState(true);
    const [mode, setMode] = useState<Mode>('view');
    const [editText, setEditText] = useState('');
    const [saving, setSaving] = useState(false);

    // AI 분석 상태
    const [state, setState] = useState<ProgressState>({
        status: '', current: 0, total: 0, currentTitle: '', done: false, error: '', profile: '',
    });
    const abortRef = useRef<(() => void) | null>(null);

    // 기존 프로필 조회
    useEffect(() => {
        getUserProfile()
            .then(data => {
                setExistingProfile(data?.profile || null);
            })
            .catch(() => setExistingProfile(null))
            .finally(() => setProfileLoading(false));
    }, []);

    // 편집 모드 진입
    const enterEdit = () => {
        setEditText(existingProfile || '');
        setMode('edit');
    };

    // 직접 저장
    const handleSave = async () => {
        setSaving(true);
        try {
            await updateUserProfile({profile: editText});
            setExistingProfile(editText);
            setMode('view');
            onDone(editText, t('rememberModal.saved'));
        } catch (e) {
            console.error(e);
        } finally {
            setSaving(false);
        }
    };

    // AI 분석 시작
    const startAnalyze = () => {
        setMode('analyze');
        setState({status: t('rememberModal.connecting'), current: 0, total: 0, currentTitle: '', done: false, error: '', profile: ''});

        let cancelled = false;

        const run = async () => {
            try {
                const resp = await fetch('/api/remember', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        max_length: parseInt(maxLength),
                        language: i18n.language,
                    }),
                });
                const reader = resp.body!.getReader();
                const decoder = new TextDecoder();
                let buf = '';

                abortRef.current = () => reader.cancel();

                while (true) {
                    const { done, value } = await reader.read();
                    if (done || cancelled) break;
                    buf += decoder.decode(value, { stream: true });
                    const parts = buf.split('\n\n');
                    buf = parts.pop() || '';
                    for (const part of parts) {
                        const eventMatch = part.match(/^event: (\w+)/m);
                        const dataMatch = part.match(/^data: (.+)/m);
                        if (!eventMatch || !dataMatch) continue;
                        const event = eventMatch[1];
                        const data = JSON.parse(dataMatch[1]);

                        if (event === 'status') {
                            setState(s => ({ ...s, status: data.message }));
                        } else if (event === 'progress') {
                            setState(s => ({
                                ...s, status: t('rememberModal.analyzingConversations'),
                                current: data.current, total: data.total, currentTitle: data.title,
                            }));
                        } else if (event === 'done') {
                            setState(s => ({
                                ...s, done: true, status: data.message,
                                profile: data.profile, current: data.processed, total: data.processed,
                            }));
                            setExistingProfile(data.profile);
                            onDone(data.profile, data.message);
                        } else if (event === 'error') {
                            setState(s => ({ ...s, error: data.message }));
                        }
                    }
                }
            } catch (error: unknown) {
                if (!cancelled) {
                    const message = error instanceof Error ? error.message : String(error);
                    setState(s => ({ ...s, error: message }));
                }
            }
        };

        run();
        return () => {
            cancelled = true;
            abortRef.current?.();
        };
    };

    useEffect(() => {
        return () => abortRef.current?.();
    }, []);

    const isAnalyzing = mode === 'analyze' && !state.done && !state.error;
    const isBusy = isAnalyzing || saving;

    // ESC 키로 닫기
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && !isBusy) onClose();
        };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, [isBusy]);

    const percent = state.total > 0 ? Math.round((state.current / state.total) * 100) : 0;

    return (
        <ModalOverlay className="remember-overlay">
            <div className="remember-modal">
                {/* 헤더 */}
                <div className="remember-header">
                    <div className="remember-header-left">
                        <span className="remember-icon">🧩</span>
                        <span>{t('rememberModal.title')}</span>
                    </div>
                    <button className="remember-close-x" aria-label={t('rememberModal.close')} onClick={() => !isBusy && onClose()} disabled={isBusy}>✕</button>
                </div>

                <div className="remember-body">
                    {/* ── 보기 모드 ── */}
                    {mode === 'view' && (
                        <>
                            {/* AI 분석 설정 */}
                            <div className="remember-setup-row">
                                <span className="remember-setup-label">{t('rememberModal.maxLength')}</span>
                                <CustomSelect
                                    options={maxLengthOptions}
                                    value={maxLength}
                                    onChange={setMaxLength}
                                    triggerStyle={{ fontSize: '13px', padding: '5px 10px' }}
                                />
                            </div>

                            <div className="remember-existing">
                                <div className="remember-profile-label">{t('rememberModal.currentProfile')}</div>
                                {profileLoading ? (
                                    <div className="remember-profile-loading">{t('rememberModal.loading')}</div>
                                ) : existingProfile ? (
                                    <div className="remember-profile-text">{existingProfile}</div>
                                ) : (
                                    <div className="remember-profile-empty">{t('rememberModal.empty')}</div>
                                )}
                            </div>
                        </>
                    )}

                    {/* ── 편집 모드 ── */}
                    {mode === 'edit' && (
                        <div className="remember-edit-wrap">
                            <div className="remember-profile-label">{t('rememberModal.editTitle')}</div>
                            <textarea
                                className="remember-edit-textarea"
                                value={editText}
                                onChange={e => setEditText(e.target.value)}
                                placeholder={t('rememberModal.placeholder')}
                                autoFocus
                            />
                            <div className="remember-edit-count">
                                {t('rememberModal.characterCount', {count: editText.length})}
                            </div>
                        </div>
                    )}

                    {/* ── AI 분석 모드 ── */}
                    {mode === 'analyze' && !state.done && !state.error && (
                        <div className="remember-progress">
                            <div className="remember-status">{state.status}</div>
                            {state.total > 0 && (
                                <>
                                    <div className="remember-bar-wrap">
                                        <div className="remember-bar" style={{ width: `${percent}%` }} />
                                    </div>
                                    <div className="remember-count">
                                        {state.current} / {state.total}
                                        {state.currentTitle && <span className="remember-cur-title"> — {state.currentTitle}</span>}
                                    </div>
                                </>
                            )}
                            <div className="remember-spinner" />
                        </div>
                    )}

                    {mode === 'analyze' && state.error && (
                        <div className="remember-error">❌ {state.error}</div>
                    )}

                    {mode === 'analyze' && state.done && (
                        <div className="remember-done">
                            <div className="remember-done-msg">✅ {state.status}</div>
                            {state.profile && (
                                <div className="remember-profile-preview">
                                    <div className="remember-profile-label">{t('rememberModal.updatedProfile')}</div>
                                    <div className="remember-profile-text">{state.profile}</div>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* 푸터 */}
                <div className="remember-footer">
                    {mode === 'view' && (
                        <>
                            <button className="remember-cancel-btn" onClick={onClose}>{t('rememberModal.close')}</button>
                            <button className="remember-edit-btn" onClick={enterEdit} disabled={profileLoading}>
                                ✏️ {t('rememberModal.edit')}
                            </button>
                            <button className="remember-start-btn" onClick={startAnalyze}>
                                🔍 {t('rememberModal.analyze')}
                            </button>
                        </>
                    )}
                    {mode === 'edit' && (
                        <>
                            <button className="remember-cancel-btn" onClick={() => setMode('view')}>{t('rememberModal.cancel')}</button>
                            <button className="remember-start-btn" onClick={handleSave} disabled={saving}>
                                {saving ? t('rememberModal.saving') : `💾 ${t('rememberModal.save')}`}
                            </button>
                        </>
                    )}
                    {mode === 'analyze' && (
                        <button
                            className="remember-close-btn"
                            onClick={() => setMode('view')}
                            disabled={isAnalyzing}
                        >
                            {isAnalyzing ? t('rememberModal.analyzing') : t('rememberModal.back')}
                        </button>
                    )}
                </div>
            </div>
        </ModalOverlay>
    );
};

export default RememberModal;
