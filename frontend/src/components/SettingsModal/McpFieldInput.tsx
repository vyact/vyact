import {useEffect, useRef, useState} from 'react';
import {useTranslation} from 'react-i18next';
import CustomSelect from '../CustomSelect/CustomSelect';

export interface McpField {
    key: string;
    label: string;
    type: 'text' | 'secret' | 'dir_list' | 'lines' | 'env' | 'select' | 'file_json' | 'toggle';
    required?: boolean;
    options?: { value: string; label: string }[];
}

interface McpFieldInputProps {
    field: McpField;
    value: unknown;
    onChange: (value: unknown) => void;
}

function DirectoryListInput({field, value, onChange}: McpFieldInputProps) {
    const {t} = useTranslation('settings');
    const [draft, setDraft] = useState('');
    const directories = Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
    const addDirectory = () => {
        if (!draft.trim()) return;
        onChange([...directories, draft.trim()]);
        setDraft('');
    };

    return <div className="mcp-field">
        <label className="mcp-field-label">{t(`mcpCatalog.fields.${field.key}`, {defaultValue: field.label})}</label>
        <div className="mcp-dir-list">
            {directories.map((directory, index) => <div key={index} className="mcp-dir-chip">
                <span>{directory}</span>
                <button onClick={() => onChange(directories.filter((_, itemIndex) => itemIndex !== index))}>✕</button>
            </div>)}
        </div>
        <div className="mcp-dir-add">
            <input className="mcp-input" value={draft} onChange={event => setDraft(event.target.value)}
                   placeholder="/Users/alex/work" onKeyDown={event => event.key === 'Enter' && addDirectory()}/>
            <button className="mcp-btn-primary" onClick={addDirectory}>{t('mcp.add')}</button>
        </div>
    </div>;
}

function JsonFileInput({field, value, onChange}: McpFieldInputProps) {
    const {t} = useTranslation('settings');
    const fileRef = useRef<HTMLInputElement>(null);
    const hasValue = Boolean(value);

    return <div className="mcp-field">
        <label className="mcp-field-label">{t(`mcpCatalog.fields.${field.key}`, {defaultValue: field.label})}</label>
        <div className="mcp-file-upload">
            <input ref={fileRef} type="file" accept=".json,application/json" style={{display: 'none'}}
                   onChange={event => {
                       const file = event.target.files?.[0];
                       if (!file) return;
                       const reader = new FileReader();
                       reader.onload = () => {
                           try {
                               onChange(JSON.stringify(JSON.parse(reader.result as string)));
                           } catch {
                               onChange(null);
                           }
                       };
                       reader.readAsText(file);
                       event.target.value = '';
                   }}/>
            <button className={`mcp-btn-ghost mcp-file-btn ${hasValue ? 'uploaded' : ''}`}
                    onClick={() => fileRef.current?.click()}>
                {hasValue ? t('mcp.uploaded') : t('mcp.selectJsonFile')}
            </button>
            {hasValue && <button className="mcp-btn-ghost mcp-file-clear" onClick={() => onChange(null)}>✕</button>}
        </div>
    </div>;
}

function LinesInput({field, value, onChange}: McpFieldInputProps) {
    const {t} = useTranslation('settings');
    const initialText = Array.isArray(value) ? value.join('\n') : (typeof value === 'string' ? value : '');
    const [text, setText] = useState(initialText);

    useEffect(() => {
        setText(Array.isArray(value) ? value.join('\n') : (typeof value === 'string' ? value : ''));
        // This resets the draft only when a different catalog field is mounted.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [field.key]);

    return <div className="mcp-field">
        <label className="mcp-field-label">{t(`mcpCatalog.fields.${field.key}`, {defaultValue: field.label})}</label>
        <textarea className="mcp-input mcp-textarea" value={text} onChange={event => {
            setText(event.target.value);
            onChange(event.target.value.split('\n').filter(Boolean));
        }}/>
    </div>;
}

function EnvironmentInput({field, value, onChange}: McpFieldInputProps) {
    const {t} = useTranslation('settings');
    const toText = (currentValue: unknown) => currentValue && typeof currentValue === 'object'
        ? Object.entries(currentValue).map(([key, item]) => `${key}=${item}`).join('\n') : '';
    const [text, setText] = useState(toText(value));

    useEffect(() => {
        setText(toText(value));
        // This resets the draft only when a different catalog field is mounted.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [field.key]);

    return <div className="mcp-field">
        <label className="mcp-field-label">{t(`mcpCatalog.fields.${field.key}`, {defaultValue: field.label})}</label>
        <textarea className="mcp-input mcp-textarea" value={text} onChange={event => {
            const environment: Record<string, string> = {};
            setText(event.target.value);
            event.target.value.split('\n').forEach(line => {
                const separatorIndex = line.indexOf('=');
                if (separatorIndex > 0) environment[line.slice(0, separatorIndex).trim()] = line.slice(separatorIndex + 1).trim();
            });
            onChange(environment);
        }}/>
    </div>;
}

export default function McpFieldInput(props: McpFieldInputProps) {
    const {field, value, onChange} = props;
    const {t} = useTranslation('settings');
    if (field.type === 'dir_list') return <DirectoryListInput {...props}/>;
    if (field.type === 'lines') return <LinesInput {...props}/>;
    if (field.type === 'env') return <EnvironmentInput {...props}/>;
    if (field.type === 'file_json') return <JsonFileInput {...props}/>;

    if (field.type === 'select' && field.options) return <div className="mcp-field">
        <label className="mcp-field-label">{t(`mcpCatalog.fields.${field.key}`, {defaultValue: field.label})}</label>
        <CustomSelect options={field.options.map(option => ({value: option.value, label: t(`mcpCatalog.options.${option.value}`, {defaultValue: option.label})}))}
                      value={typeof value === 'string' ? value : field.options[0]?.value || ''} onChange={onChange}/>
    </div>;

    if (field.type === 'toggle') return <div className="mcp-field mcp-toggle-field">
        <label className="mcp-field-label" htmlFor={`mcp-field-${field.key}`}>{t(`mcpCatalog.fields.${field.key}`, {defaultValue: field.label})}</label>
        <label className="mcp-switch">
            <input id={`mcp-field-${field.key}`} type="checkbox" checked={Boolean(value)} onChange={event => onChange(event.target.checked)}/>
            <span className="mcp-slider"/>
        </label>
    </div>;

    return <div className="mcp-field">
        <label className="mcp-field-label">{t(`mcpCatalog.fields.${field.key}`, {defaultValue: field.label})}</label>
        <input className="mcp-input" type={field.type === 'secret' ? 'password' : 'text'}
               value={typeof value === 'string' ? value : ''} onChange={event => onChange(event.target.value)}
               placeholder={field.type === 'secret' ? '••••••••' : ''}/>
    </div>;
}
