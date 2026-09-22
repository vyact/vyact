import {useId} from 'react';
import {useTranslation} from 'react-i18next';

export default function McpPromptField({value, defaultValue, onChange, separated = false, disabled = false}: {
    value: string;
    defaultValue: string;
    onChange: (value: string) => void;
    separated?: boolean;
    disabled?: boolean;
}) {
    const {t} = useTranslation('settings');
    const inputId = useId();
    return <div className={`mcp-field${separated ? ' mcp-prompt-section' : ''}`}>
        <div className="mcp-prompt-heading">
            <label className="mcp-field-label" htmlFor={inputId}>{t('mcp.promptLabel')}</label>
            <button type="button" className="mcp-icon-btn" disabled={disabled || value === defaultValue}
                    onClick={() => onChange(defaultValue)}>{t('mcp.resetPrompt')}</button>
        </div>
        <textarea id={inputId} className="mcp-input mcp-prompt-textarea"
                  placeholder={t(defaultValue ? 'mcp.promptDefaultPlaceholder' : 'mcp.promptEmptyPlaceholder')}
                  value={value} disabled={disabled} onChange={event => onChange(event.target.value)}/>
    </div>;
}
