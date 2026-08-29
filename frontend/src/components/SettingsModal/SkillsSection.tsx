import React, {useEffect, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {getSkills, type Skill, updateSkillsCache} from '../../services/skills';
import {renderMarkdown} from '../../utils/markdownUtils';
import ConfirmModal from '../common/ConfirmModal/ConfirmModal';
import './SkillsSection.css';

interface SkillFormData {
    name: string;
    description: string;
    instructions: string;
}

const EMPTY_FORM: SkillFormData = {name: '', description: '', instructions: ''};

const SkillsSection: React.FC = () => {
    const {t} = useTranslation('settings');
    const [skills, setSkills] = useState<Skill[]>([]);
    const [loading, setLoading] = useState(true);
    const [mode, setMode] = useState<'list' | 'create' | 'edit' | 'view'>('list');
    const [selectedSkill, setSelectedSkill] = useState<Skill | null>(null);
    const [form, setForm] = useState<SkillFormData>(EMPTY_FORM);
    const [saving, setSaving] = useState(false);
    const [skillToDelete, setSkillToDelete] = useState<Skill | null>(null);

    const loadSkills = async () => {
        setLoading(true);
        try {
            setSkills(await getSkills());
        } catch { /* ignore */ }
        setLoading(false);
    };

    useEffect(() => { loadSkills(); }, []);

    const handleCreate = async () => {
        if (!form.name.trim() || !form.description.trim()) return;
        setSaving(true);
        try {
            const res = await fetch('/api/skills', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify(form),
            });
            if (res.ok) {
                const createdSkill: Skill = await res.json();
                setSkills(current => updateSkillsCache([...current, createdSkill]));
                setMode('list');
                setForm(EMPTY_FORM);
            }
        } catch { /* ignore */ }
        setSaving(false);
    };

    const handleUpdate = async () => {
        if (!selectedSkill || !form.name.trim() || !form.description.trim()) return;
        setSaving(true);
        try {
            const res = await fetch(`/api/skills/${selectedSkill.id}`, {
                method: 'PUT',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify(form),
            });
            if (res.ok) {
                const updatedSkill: Skill = await res.json();
                setSkills(current => updateSkillsCache(
                    current.map(skill => skill.id === updatedSkill.id ? updatedSkill : skill),
                ));
                setMode('list');
                setSelectedSkill(null);
                setForm(EMPTY_FORM);
            }
        } catch { /* ignore */ }
        setSaving(false);
    };

    const handleDelete = async (id: string) => {
        try {
            const response = await fetch(`/api/skills/${id}`, {method: 'DELETE'});
            if (!response.ok) return;
            setSkills(current => updateSkillsCache(current.filter(skill => skill.id !== id)));
            if (selectedSkill?.id === id) {
                setMode('list');
                setSelectedSkill(null);
            }
        } catch { /* ignore */ }
        setSkillToDelete(null);
    };

    const handleToggle = async (skill: Skill) => {
        try {
            const response = await fetch(`/api/skills/${skill.id}`, {
                method: 'PUT',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({enabled: !skill.enabled}),
            });
            if (!response.ok) return;
            const updatedSkill: Skill = await response.json();
            setSkills(current => updateSkillsCache(
                current.map(item => item.id === updatedSkill.id ? updatedSkill : item),
            ));
        } catch { /* ignore */ }
    };

    const openEdit = (skill: Skill) => {
        setSelectedSkill(skill);
        setForm({name: skill.name, description: skill.description, instructions: skill.instructions});
        setMode('edit');
    };

    const openView = (skill: Skill) => {
        setSelectedSkill(skill);
        setMode('view');
    };

    const goBack = () => {
        setMode('list');
        setSelectedSkill(null);
        setForm(EMPTY_FORM);
    };

    // ── 리스트 뷰 ──
    if (mode === 'list') {
        return (
            <div className="skills-section">
                <div className="skills-header">
                    <span className="skills-title">{t('skills.title')}</span>
                    <button className="skills-add-btn" onClick={() => { setForm(EMPTY_FORM); setMode('create'); }}>
                        {t('skills.addNew')}
                    </button>
                </div>
                <p className="skills-desc">
                    {t('skills.desc')}
                </p>
                {loading ? (
                    <div className="skills-empty">{t('common:loading')}</div>
                ) : skills.length === 0 ? (
                    <div className="skills-empty">{t('skills.empty')}</div>
                ) : (
                    <div className="skills-list">
                        {skills.map(skill => (
                            <div key={skill.id} className={`skills-item${skill.enabled ? '' : ' disabled'}`}
                                 onClick={() => openView(skill)}>
                                <div className="skills-item-main">
                                    <div className="skills-item-name">{skill.name}</div>
                                    <div className="skills-item-desc">{skill.description}</div>
                                </div>
                                <div className="skills-item-actions" onClick={e => e.stopPropagation()}>
                                    <label className="settings-switch skills-switch">
                                        <input type="checkbox" checked={skill.enabled} onChange={() => handleToggle(skill)} />
                                        <span className="settings-switch-slider" />
                                    </label>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        );
    }

    // ── 상세 보기 ──
    if (mode === 'view' && selectedSkill) {
        return (<>
            <div className="skills-section">
                <div className="skills-detail-header">
                    <button className="skills-back-btn" onClick={goBack}>{t('skills.backToList')}</button>
                    <div className="skills-detail-actions">
                        <button className="skills-edit-btn" onClick={() => openEdit(selectedSkill)}>{t('common:edit')}</button>
                        <button className="skills-delete-btn" onClick={() => setSkillToDelete(selectedSkill)}>{t('common:delete')}</button>
                    </div>
                </div>
                <div className="skills-detail-name">{selectedSkill.name}</div>
                <div className="skills-detail-section">
                    <div className="skills-detail-label">{t('skills.description')}</div>
                    <div className="skills-detail-text">{selectedSkill.description}</div>
                </div>
                <div className="skills-detail-section">
                    <div className="skills-detail-label">{t('skills.instructions')}</div>
                    <div className="skills-detail-text skills-detail-instructions"
                         dangerouslySetInnerHTML={{__html: renderMarkdown(selectedSkill.instructions)}} />
                </div>
            </div>
            {skillToDelete && <ConfirmModal
                title={skillToDelete.name}
                description={t('skills.confirmDelete')}
                options={[
                    {label: t('common:cancel'), value: 'cancel'},
                    {label: t('common:delete'), value: 'delete', variant: 'danger'},
                ]}
                actionLayout="horizontal"
                onClose={() => setSkillToDelete(null)}
                onSelect={value => {
                    if (value === 'delete') void handleDelete(skillToDelete.id);
                    else setSkillToDelete(null);
                }}
            />}
        </>);
    }

    // ── 생성 / 편집 폼 ──
    return (
        <div className="skills-section">
            <div className="skills-detail-header">
                <button className="skills-back-btn" onClick={goBack}>{t('skills.backToList')}</button>
            </div>
            <div className="skills-form-title">{mode === 'create' ? t('skills.createTitle') : t('skills.editTitle')}</div>
            <div className="skills-form">
                <label className="skills-form-label">{t('skills.skillName')}</label>
                <input
                    className="skills-form-input"
                    value={form.name}
                    onChange={e => setForm(f => ({...f, name: e.target.value}))}
                    placeholder={t('skills.skillNamePlaceholder')}
                />
                <label className="skills-form-label">{t('skills.description')}</label>
                <span className="skills-form-hint">{t('skills.descHint')}</span>
                <textarea
                    className="skills-form-textarea skills-form-textarea--short"
                    value={form.description}
                    onChange={e => setForm(f => ({...f, description: e.target.value}))}
                    placeholder={t('skills.descPlaceholder')}
                />
                <label className="skills-form-label">{t('skills.instructions')}</label>
                <span className="skills-form-hint">{t('skills.instructionsHint')}</span>
                <textarea
                    className="skills-form-textarea skills-form-textarea--tall"
                    value={form.instructions}
                    onChange={e => setForm(f => ({...f, instructions: e.target.value}))}
                    placeholder={t('skills.instructionsPlaceholder')}
                />
                <div className="skills-form-actions">
                    <button className="skills-cancel-btn" onClick={goBack}>{t('common:cancel')}</button>
                    <button
                        className="skills-save-btn"
                        onClick={mode === 'create' ? handleCreate : handleUpdate}
                        disabled={saving || !form.name.trim() || !form.description.trim()}
                    >
                        {saving ? t('common:saving') : mode === 'create' ? t('skills.create') : t('common:save')}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default SkillsSection;
