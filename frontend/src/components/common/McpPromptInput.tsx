import type {Ref, TextareaHTMLAttributes} from 'react';
import {useTranslation} from 'react-i18next';
import McpMenu from '../ChatInput/McpMenu';
import type {McpServer} from '../../types';
import './McpPromptInput.css';

interface Props extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange'> {
    value: string;
    onChange: (value: string) => void;
    selectedServers: McpServer[];
    onSelectedServersChange: (servers: McpServer[]) => void;
    scopeHelp: string;
    textareaRef?: Ref<HTMLTextAreaElement>;
}

export default function McpPromptInput({value, onChange, selectedServers, onSelectedServersChange, scopeHelp, textareaRef, ...props}: Props) {
    const {t} = useTranslation('main');
    return <div className="mcp-prompt-input">
        <textarea {...props} value={value} ref={textareaRef} onChange={event => onChange(event.target.value)}/>
        <div className="mcp-prompt-toolbar">
            <McpMenu disabled={props.disabled} selection={{servers: selectedServers, onChange: onSelectedServersChange, scopeHelp}}/>
            <span className="mcp-prompt-scope">{t('mcpMenu.title')}</span>
        </div>
    </div>;
}
