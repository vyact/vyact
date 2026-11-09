import type {ReactNode, Ref, TextareaHTMLAttributes} from 'react';
import McpMenu from '../ChatInput/McpMenu';
import type {McpServer} from '../../types';
import './McpPromptInput.css';

interface Props extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange'> {
    value: string;
    onChange: (value: string) => void;
    selectedServers: McpServer[];
    onSelectedServersChange: (servers: McpServer[]) => void;
    scopeHelp: string;
    actions?: ReactNode;
    context?: ReactNode;
    preview?: ReactNode;
    textareaRef?: Ref<HTMLTextAreaElement>;
    showTools?: boolean;
}

export default function McpPromptInput({value, onChange, selectedServers, onSelectedServersChange, scopeHelp, textareaRef, actions, context, preview, showTools = true, ...props}: Props) {
    return <div className="mcp-prompt-input">
        {preview}
        <textarea {...props} value={value} ref={textareaRef} onChange={event => onChange(event.target.value)}/>
        {context}
        <div className="mcp-prompt-toolbar">
            {showTools && <McpMenu disabled={props.disabled} selection={{servers: selectedServers, onChange: onSelectedServersChange, scopeHelp}}/>}
            {actions}
        </div>
    </div>;
}
