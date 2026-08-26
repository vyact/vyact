import {CircleQuestionMark} from 'lucide-react';
import {Tooltip} from '../Tooltip/Tooltip';
import './SettingLabel.css';

interface SettingLabelProps {
    label: string;
    help: string;
    description?: string;
}

export default function SettingLabel({label, help, description}: SettingLabelProps) {
    return <span className="setting-label">
        <Tooltip content={help} multiline large>
            <button type="button" className="setting-label-help" aria-label={`${label}: ${help}`}>
                <CircleQuestionMark size={15}/>
            </button>
        </Tooltip>
        <span><strong>{label}</strong>{description && <small>{description}</small>}</span>
    </span>;
}
