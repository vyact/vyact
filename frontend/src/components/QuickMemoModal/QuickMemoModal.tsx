import React, {useEffect, useRef, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {Check, Pencil, Trash2, X} from 'lucide-react';
import {api} from '../../services/api';
import type {QuickNote} from '../../types';
import ModalOverlay from '../common/ModalOverlay/ModalOverlay';
import './QuickMemoModal.css';
import {TEXTAREA_MAX_HEIGHT} from '../../constants/ui';

interface QuickMemoModalProps {
    onClose: () => void;
}

// 미완료 먼저, 그 안에서 created_at 내림차순
function sortNotes(list: QuickNote[]): QuickNote[] {
    return [...list].sort((a, b) => {
        if (a.done !== b.done) return a.done ? 1 : -1;
        return (b.created_at || '').localeCompare(a.created_at || '');
    });
}

function formatDate(iso: string | undefined, locale: string): string {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const now = new Date();
    const sameYear = d.getFullYear() === now.getFullYear();
    return d.toLocaleDateString(locale, sameYear
        ? {month: '2-digit', day: '2-digit'}
        : {year: '2-digit', month: '2-digit', day: '2-digit'});
}

const QuickMemoModal: React.FC<QuickMemoModalProps> = ({onClose}) => {
    const {t, i18n} = useTranslation('main');
    const [notes, setNotes] = useState<QuickNote[]>([]);
    const [input, setInput] = useState('');
    const [loading, setLoading] = useState(true);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const [editValue, setEditValue] = useState('');
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const composingRef = useRef(false);

    const load = async () => {
        try {
            const data = await api.getQuickNotes();
            setNotes(sortNotes(data.notes || []));
        } catch {
            /* noop */
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        load();
        inputRef.current?.focus();
    }, []);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                if (editingId) { setEditingId(null); return; }
                onClose();
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [editingId, onClose]);

    const add = async () => {
        const text = input.trim();
        if (!text) return;
        setInput('');
        if (inputRef.current) inputRef.current.style.height = 'auto';
        try {
            const created = await api.createQuickNote(text);
            // 서버 재조회 없이 로컬에 추가 후 정렬 (깜빡임 방지)
            setNotes(prev => sortNotes([created, ...prev]));
        } catch {
            await load();
        }
    };

    const toggleDone = async (n: QuickNote) => {
        // 낙관적: 로컬에서 상태 변경 + 재정렬만. 서버 재조회(load) 안 함 → 깜빡임 없음
        setNotes(prev => sortNotes(prev.map(x => x.id === n.id ? {...x, done: !x.done} : x)));
        try {
            await api.toggleQuickNoteDone(n.id, !n.done);
        } catch {
            await load();
        }
    };

    const remove = async (id: string) => {
        setNotes(prev => prev.filter(x => x.id !== id));
        try {
            await api.deleteQuickNote(id);
        } catch {
            await load();
        }
    };

    const startEdit = (n: QuickNote) => {
        setEditingId(n.id);
        setEditValue(n.text);
    };

    const commitEdit = async (id: string) => {
        const text = editValue.trim();
        setEditingId(null);
        if (!text) return;
        const target = notes.find(x => x.id === id);
        if (target && target.text === text) return;
        setNotes(prev => prev.map(x => x.id === id ? {...x, text} : x));
        try {
            await api.updateQuickNote(id, text);
        } catch {
            await load();
        }
    };

    return (
        <ModalOverlay className="qmemo-overlay">
            <div className="qmemo-modal">
                <div className="qmemo-head">
                    <strong>{t('inputMenu.quickMemo')}</strong>
                    <button className="qmemo-close" onClick={onClose}><X size={18}/></button>
                </div>

                <div className="qmemo-input-row">
                    <textarea
                        ref={inputRef}
                        className="qmemo-input"
                        placeholder={t('quickMemoModal.inputPlaceholder')}
                        value={input}
                        rows={1}
                        onChange={e => {
                            setInput(e.target.value);
                            const el = e.target;
                            el.style.height = 'auto';
                            el.style.height = el.scrollHeight + 'px';
                            el.style.overflowY = el.scrollHeight > TEXTAREA_MAX_HEIGHT ? 'auto' : 'hidden';
                        }}
                        onCompositionStart={() => { composingRef.current = true; }}
                        onCompositionEnd={() => { composingRef.current = false; }}
                        onKeyDown={e => {
                            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && !composingRef.current) {
                                e.preventDefault();
                                add();
                            }
                        }}
                    />
                </div>

                <div className="qmemo-list">
                    {loading ? (
                        <div className="qmemo-empty">{t('quickMemoModal.loading')}</div>
                    ) : notes.length === 0 ? (
                        <div className="qmemo-empty">{t('quickMemoModal.empty')}</div>
                    ) : (
                        notes.map(n => (
                            <div key={n.id} className={`qmemo-item${n.done ? ' done' : ''}${editingId === n.id ? ' editing' : ''}${deletingId === n.id ? ' deleting' : ''}`}>
                                <button
                                    className={`qmemo-check${n.done ? ' checked' : ''}`}
                                    onClick={() => toggleDone(n)}
                                    title={n.done ? t('quickMemoModal.markIncomplete') : t('quickMemoModal.markComplete')}
                                >
                                    {n.done && <Check size={13} strokeWidth={3}/>}
                                </button>

                                {editingId === n.id ? (
                                    <textarea
                                        className="qmemo-edit-input"
                                        autoFocus
                                        value={editValue}
                                        rows={1}
                                        onChange={e => {
                                            setEditValue(e.target.value);
                                            const el = e.target;
                                            el.style.height = 'auto';
                                            el.style.height = el.scrollHeight + 'px';
                                            el.style.overflowY = el.scrollHeight > TEXTAREA_MAX_HEIGHT ? 'auto' : 'hidden';
                                        }}
                                        ref={el => { if (el) { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; el.style.overflowY = el.scrollHeight > TEXTAREA_MAX_HEIGHT ? 'auto' : 'hidden'; el.setSelectionRange(el.value.length, el.value.length); } }}
                                        onKeyDown={e => {
                                            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); commitEdit(n.id); }
                                            if (e.key === 'Escape') setEditingId(null);
                                        }}
                                    />
                                ) : (
                                    <span className="qmemo-text" onDoubleClick={() => startEdit(n)}>{n.text}</span>
                                )}

                                <span className="qmemo-date">{formatDate(n.created_at, i18n.language)}</span>

                                <div className="qmemo-actions">
                                    {editingId === n.id ? (
                                        <>
                                            <button className="qmemo-icon-btn confirm" onClick={() => commitEdit(n.id)} title={t('quickMemoModal.save')}>
                                                <Check size={15} strokeWidth={2.5}/>
                                            </button>
                                            <button className="qmemo-icon-btn danger" onClick={() => setEditingId(null)} title={t('quickMemoModal.cancel')}>
                                                <X size={15}/>
                                            </button>
                                        </>
                                    ) : (
                                        <>
                                            {deletingId !== n.id && (
                                                <button className="qmemo-icon-btn" onClick={() => startEdit(n)} title={t('quickMemoModal.edit')}>
                                                    <Pencil size={15}/>
                                                </button>
                                            )}
                                            {deletingId === n.id ? (
                                                <>
                                                    <span className="qmemo-confirm-text">{t('quickMemoModal.deleteConfirm')}</span>
                                                    <button className="qmemo-icon-btn" onClick={() => setDeletingId(null)} title={t('quickMemoModal.cancel')}>
                                                        <X size={15}/>
                                                    </button>
                                                    <button className="qmemo-icon-btn danger" onClick={() => { setDeletingId(null); remove(n.id); }} title={t('quickMemoModal.confirm')}>
                                                        <Check size={15} strokeWidth={2.5}/>
                                                    </button>
                                                </>
                                            ) : (
                                                <button className="qmemo-icon-btn danger" onClick={() => setDeletingId(n.id)} title={t('quickMemoModal.delete')}>
                                                    <Trash2 size={15}/>
                                                </button>
                                            )}
                                        </>
                                    )}
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>
        </ModalOverlay>
    );
};

export default QuickMemoModal;
