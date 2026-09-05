import type {ReactNode} from 'react';
import {CircleQuestionMark} from 'lucide-react';
import {Tooltip} from '../Tooltip/Tooltip';
import './SettingLabel.css';

interface SettingLabelProps {
    label: string;
    help: ReactNode;
    description?: string;
}

export default function SettingLabel({label, help, description}: SettingLabelProps) {
    return <span className="setting-label">
        <Tooltip content={help} multiline size="medium">
            <button type="button" className="setting-label-help" aria-label={typeof help === 'string' ? `${label}: ${help}` : label}>
                <CircleQuestionMark size={15}/>
            </button>
        </Tooltip>
        <span><strong>{label}</strong>{description && <small>{description}</small>}</span>
    </span>;
}
