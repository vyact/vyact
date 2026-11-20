import {LogOut} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import './WorkspaceExitButton.css';

export default function WorkspaceExitButton({onClick, disabled, className, label}: {
    onClick: () => void;
    disabled?: boolean;
    className?: string;
    label?: string;
}) {
    const {t} = useTranslation('main');
    return <button type="button" data-tooltip-disabled="" aria-label={label ?? t('novelStudio.backToChat')}
                   className={['workspace-exit-button', className].filter(Boolean).join(' ')}
                   disabled={disabled} onClick={onClick}>
        <LogOut size={16} strokeWidth={1.8} aria-hidden="true"/>
        <span>{label ?? t('novelStudio.exitStudio')}</span>
    </button>;
}
