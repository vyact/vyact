import React, {useState, useRef} from 'react';
import {Clipboard, ClipboardPaste, Plus, X} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import {api} from '../../services/api';
import {toast} from '../common/ToastNotifications/ToastNotifications';
import {
    LANGUAGES,
    getLanguageDisplayName,
    getPromptTemplate,
    copyToClipboard,
    readFromClipboard,
    ScriptDoc,
    ScriptPair,
    mkId,
    parseRawScript
} from './voiceChat.types';

const PromptCopyBtn: React.FC<{ text: string }> = ({text}) => {
    const {t} = useTranslation('main');
    const [copied, setCopied] = useState(false);
    return (
        <button className="sp-copy-btn" onClick={(e) => {
            e.stopPropagation();
            copyToClipboard(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        }}>
            {copied ? '✓' : t('voiceChat.copy')}
        </button>
    );
};

const ScriptFormView: React.FC<{
    script?: ScriptDoc;
    language: string;
    onSaved: () => void;
    onCancel: () => void
}> = ({script, language, onSaved, onCancel}) => {
    const {t, i18n} = useTranslation('main');
    const [title, setTitle] = useState(script?.title ?? '');
    const [pairs, setPairs] = useState<ScriptPair[]>(() => (script?.pairs ?? []).map(p => ({
        ...p,
        id: p.id ?? mkId()
    })));
    const [saving, setSaving] = useState(false);
    const [pasteError, setPasteError] = useState('');
    const dragIdx = useRef<number | null>(null);
    const dragOverIdx = useRef<number | null>(null);
    const langInfo = LANGUAGES.find(l => l.code === language);

    const handlePaste = async () => {
        try {
            const text = await readFromClipboard();
            if (!text.trim()) {
                setPasteError(t('voiceChat.clipboardEmpty'));
                return;
            }
            const parsed = parseRawScript(text);
            if (parsed.length === 0) {
                setPasteError(t('voiceChat.invalidScriptFormat'));
                return;
            }
            setPairs(parsed);
            setPasteError('');
        } catch {
            setPasteError(t('voiceChat.clipboardReadFailed'));
        }
    };

    const addPair = () => setPairs(prev => [...prev, {id: mkId(), a: '', a_ko: '', b: '', b_ko: ''}]);
    const updatePair = (id: string, field: keyof ScriptPair, val: string) => setPairs(prev => prev.map(p => p.id === id ? {
        ...p,
        [field]: val
    } : p));
    const removePair = (id: string) => setPairs(prev => prev.filter(p => p.id !== id));
    const onDragStart = (i: number) => {
        dragIdx.current = i;
    };
    const onDragOver = (e: React.DragEvent, i: number) => {
        e.preventDefault();
        dragOverIdx.current = i;
    };
    const onDrop = () => {
        if (dragIdx.current === null || dragOverIdx.current === null || dragIdx.current === dragOverIdx.current) return;
        const arr = [...pairs];
        const [moved] = arr.splice(dragIdx.current, 1);
        arr.splice(dragOverIdx.current, 0, moved);
        setPairs(arr);
        dragIdx.current = null;
        dragOverIdx.current = null;
    };

    const handleSave = async () => {
        if (!title.trim()) {
            toast.warning(t('voiceChat.enterTitle'));
            return;
        }
        const valid = pairs.filter(p => p.a.trim() && p.b.trim());
        if (valid.length === 0) {
            toast.warning(t('voiceChat.enterPair'));
            return;
        }
        setSaving(true);
        try {
            const raw = valid.map(p => `${p.a}::${p.a_ko}::${p.b}::${p.b_ko}`).join('||');
            if (script?.id) await api.updateScript(script.id, {title, language, pairs: valid, raw});
            else await api.createScript({title, language, pairs: valid, raw});
            onSaved();
        } catch (e) {
            toast.error(t('voiceChat.saveFailed', {error: String(e)}));
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="sp-form">
            <div className="sp-form-nav">
                <button className="sp-back-btn" onClick={onCancel}>← {t('voiceChat.cancel')}</button>
                <span className="sp-form-heading">{script ? t('voiceChat.editScript') : t('voiceChat.newScriptTitle')}</span>
            </div>
            <div className="sp-form-lang-badge">{langInfo?.flag} {getLanguageDisplayName(language, i18n.language)}</div>
            <div className="sp-form-row">
                <label className="sp-form-label">{t('voiceChat.scriptTitle')}</label>
                <input className="sp-form-input" value={title} onChange={e => setTitle(e.target.value)}
                       placeholder={t('voiceChat.scriptTitlePlaceholder')}/>
            </div>
            <div className="sp-prompt-box sp-prompt-box--compact">
                <div className="sp-prompt-label"><Clipboard size={15} aria-hidden/> {t('voiceChat.aiGenerationPrompt')}</div>
                <PromptCopyBtn text={getPromptTemplate(language)}/>
            </div>
            <div className="sp-action-row">
                <button className="sp-paste-btn" onClick={handlePaste}><ClipboardPaste size={15} aria-hidden/> {t('voiceChat.paste')}</button>
                <button className="sp-add-btn a" onClick={addPair}><Plus size={15} aria-hidden/> {t('voiceChat.addConversation')}</button>
            </div>
            {pasteError && <div className="sp-parse-error">{pasteError}</div>}
            {pairs.length > 0 && (
                <div className="sp-pairs-editor">
                    <div className="sp-pairs-header">
                        <span className="sp-pairs-col-label b-col">← {t('voiceChat.partner')}</span>
                        <span className="sp-pairs-col-label a-col">{t('voiceChat.mySpeech')} →</span>
                    </div>
                    {pairs.map((p, i) => (
                        <div key={p.id} className="sp-pair-row" draggable onDragStart={() => onDragStart(i)}
                             onDragOver={e => onDragOver(e, i)} onDrop={onDrop}>
                            <div className="sp-drag-handle">⠿</div>
                            <div className="sp-pair-col sp-pair-col-b">
                                <input className="sp-pair-input sp-pair-input-b" placeholder={t('voiceChat.partnerSentence')} value={p.b}
                                       onChange={e => updatePair(p.id, 'b', e.target.value)}/>
                                <input className="sp-pair-input sp-pair-input-ko" placeholder={t('voiceChat.partnerTranslation')} value={p.b_ko}
                                       onChange={e => updatePair(p.id, 'b_ko', e.target.value)}/>
                            </div>
                            <div className="sp-pair-col sp-pair-col-a">
                                <input className="sp-pair-input sp-pair-input-a" placeholder={t('voiceChat.mySentence')} value={p.a}
                                       onChange={e => updatePair(p.id, 'a', e.target.value)}/>
                                <input className="sp-pair-input sp-pair-input-ko" placeholder={t('voiceChat.myTranslation')} value={p.a_ko}
                                       onChange={e => updatePair(p.id, 'a_ko', e.target.value)}/>
                            </div>
                            <button className="sp-pair-del" onClick={() => removePair(p.id)}><X size={14} aria-hidden/></button>
                        </div>
                    ))}
                </div>
            )}
            <button className="sp-save-btn" onClick={handleSave} disabled={saving}>{saving ? t('voiceChat.saving') : t('voiceChat.save')}</button>
        </div>
    );
};

export default ScriptFormView;
