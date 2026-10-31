import {useState} from 'react';
import {LoaderCircle} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import ToggleSwitch from '../common/ToggleSwitch/ToggleSwitch';
import {TASK_GUIDANCE_MAX_LENGTH} from './writingInstruction';

interface TaskGuidanceEditorProps {
    value: string;
    savedValue: string;
    customized: boolean;
    enabled: boolean;
    disabled: boolean;
    onChange: (value: string) => void;
    onEnabledChange: (enabled: boolean) => void;
    onSave: () => Promise<void>;
    onRestore: () => Promise<void>;
}

export default function TaskGuidanceEditor({value, savedValue, customized, enabled, disabled, onChange, onEnabledChange, onSave, onRestore}: TaskGuidanceEditorProps) {
    const {t} = useTranslation('main');
    const [saving, setSaving] = useState(false);
    const [failed, setFailed] = useState(false);
    const dirty = value !== savedValue;
    const run = async (operation: () => Promise<void>) => {
        if (saving) return;
        setSaving(true); setFailed(false);
        try {await operation();} catch {setFailed(true);} finally {setSaving(false);}
    };
    return <div className="novel-task-guidance">
        <div className="novel-task-guidance-heading"><label htmlFor="novel-task-guidance">{t('novelStudio.compactLabels.taskGuidance')}</label><ToggleSwitch checked={enabled} disabled={disabled || saving} label={t('novelStudio.includeTaskGuidance')} onChange={onEnabledChange}/></div>
        {enabled && <>
            <textarea id="novel-task-guidance" className="novel-task-guidance-editor" maxLength={TASK_GUIDANCE_MAX_LENGTH} disabled={disabled || saving} value={value} onChange={event => onChange(event.target.value)}/>
            <div className="novel-guidance-actions">{(saving || failed || dirty) && <span className={dirty ? 'novel-guidance-dirty' : ''} role="status">{t(`novelStudio.${saving ? 'saveState.saving' : failed ? 'saveState.error' : 'changes.unsaved'}`)}</span>}
                <button type="button" className="modal-action-cancel novel-editor-action" disabled={disabled || saving || (!customized && !dirty && !failed)} onClick={() => void run(onRestore)}>{t('novelStudio.guidance.restore')}</button>
                <button type="button" className="modal-action-submit novel-editor-action" disabled={disabled || saving || (!dirty && !failed)} onClick={() => void run(onSave)}>{saving && <LoaderCircle size={13} className="novel-spinner" aria-hidden="true"/>} {t('novelStudio.guidance.save')}</button>
            </div>
        </>}
    </div>;
}
