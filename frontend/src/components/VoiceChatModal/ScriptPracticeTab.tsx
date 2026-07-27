import React, {useState} from 'react';
import {CircleHelp, Trash2} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import {api} from '../../services/api';
import {Tooltip} from '../common/Tooltip/Tooltip';
import {LANGUAGES, getLanguageDisplayName, getPromptTemplate, copyToClipboard, ScriptView, ScriptDoc} from './voiceChat.types';
import PracticeView from './PracticeView';
import ScriptFormView from './ScriptFormView';

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

const ScriptPracticeTab: React.FC = () => {
    const {t, i18n} = useTranslation('main');
    const [view, setView] = useState<ScriptView>('lang');
    const [selectedLang, setSelectedLang] = useState('en-US');
    const [scripts, setScripts] = useState<ScriptDoc[]>([]);
    const [activeScript, setActiveScript] = useState<ScriptDoc | null>(null);
    const [loading, setLoading] = useState(false);
    const langInfo = LANGUAGES.find(l => l.code === selectedLang);

    const loadScripts = async () => {
        setLoading(true);
        try {
            const data = await api.listScripts();
            setScripts(data.scripts || []);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    const handleLangSelect = async (code: string) => {
        setSelectedLang(code);
        setView('list');
        setLoading(true);
        try {
            const data = await api.listScripts();
            setScripts(data.scripts || []);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    const handleSelect = async (s: ScriptDoc) => {
        const full = await api.getScript(s.id);
        setActiveScript(full);
        setView('practice');
    };

    const handleDelete = async (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        if (!confirm(t('voiceChat.deleteScriptConfirm'))) return;
        await api.deleteScript(id);
        await loadScripts();
    };

    const handleSaved = async () => {
        await loadScripts();
        setView('list');
        setActiveScript(null);
    };

    if (view === 'lang') return (
        <div className="vc-setup">
            <div className="vc-section-label">{t('voiceChat.practiceLanguageSelect')}</div>
            <div className="vc-lang-grid">
                {LANGUAGES.map(lang => (
                    <button key={lang.code} className={`vc-lang-btn${selectedLang === lang.code ? ' selected' : ''}`}
                            onClick={() => handleLangSelect(lang.code)}>
                        <span className="vc-lang-flag">{lang.flag}</span>
                        <span className="vc-lang-label">{getLanguageDisplayName(lang.code, i18n.language)}</span>
                    </button>
                ))}
            </div>
        </div>
    );

    if (view === 'practice' && activeScript) return <PracticeView script={activeScript} onBack={() => setView('list')}
                                                                  onEdit={() => setView('edit')}/>;
    if (view === 'edit' && activeScript) return <ScriptFormView script={activeScript} language={selectedLang}
                                                                onSaved={handleSaved}
                                                                onCancel={() => setView('practice')}/>;
    if (view === 'new') return <ScriptFormView language={selectedLang} onSaved={handleSaved}
                                               onCancel={() => setView('list')}/>;

    const filtered = scripts.filter(s => s.language === selectedLang);
    return (
        <div className="sp-list-view">
            <div className="sp-lang-bar">
                <span className="sp-lang-badge">{langInfo?.flag} {getLanguageDisplayName(selectedLang, i18n.language)}</span>
                <button className="sp-lang-change-btn" onClick={() => setView('lang')}>{t('voiceChat.changeLanguage')}</button>
            </div>
            <div className="sp-prompt-box sp-prompt-box--compact">
                <div className="sp-prompt-label">
                    <Tooltip content={t('voiceChat.scriptPromptHelp')} multiline large>
                        <button type="button" className="sp-prompt-help" aria-label={t('voiceChat.scriptPromptHelp')}>
                            <CircleHelp size={15} aria-hidden/>
                        </button>
                    </Tooltip> {t('voiceChat.scriptPrompt')}
                </div>
                <PromptCopyBtn text={getPromptTemplate(selectedLang)}/>
            </div>
            <div className="sp-list-header">
                <span className="sp-list-title">{t('voiceChat.savedScripts')}</span>
                <button className="sp-new-btn" onClick={() => setView('new')}>{t('voiceChat.newScript')}</button>
            </div>
            {loading ? <div className="sp-loading">{t('voiceChat.loading')}</div>
                : filtered.length === 0
                    ? <div className="sp-empty">{t('voiceChat.noSavedScripts')}<br/>{t('voiceChat.noSavedScriptsHint')}</div>
                    : <div className="sp-list">
                        {filtered.map(s => (
                            <div key={s.id} className="sp-item" onClick={() => handleSelect(s)}>
                                <span className="sp-item-title">{s.title}</span>
                                <button className="sp-item-del" onClick={e => handleDelete(s.id, e)} title={t('voiceChat.delete')}><Trash2 size={17} aria-hidden/></button>
                            </div>
                        ))}
                    </div>
            }
        </div>
    );
};

export default ScriptPracticeTab;
