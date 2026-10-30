import {LoaderCircle} from 'lucide-react';
import {useTranslation} from 'react-i18next';

interface NovelSaveStatusProps {
    generating: boolean;
    unapplied: boolean;
    dirty: boolean;
    saveStatus: 'saved' | 'saving' | 'error';
}

export default function NovelSaveStatus({generating, unapplied, dirty, saveStatus}: NovelSaveStatusProps) {
    const {t} = useTranslation('main');
    const key = generating ? 'proposalState.generating' : unapplied ? 'proposalState.unapplied' : dirty ? 'changes.unsaved' : `saveState.${saveStatus}`;
    return <span role="status" className={`novel-save-status${!generating && (unapplied || dirty) ? ' is-unsaved' : ''}`}>
        {generating && <LoaderCircle size={12} className="novel-spinner" aria-hidden="true"/>}
        {t(`novelStudio.${key}`)}
    </span>;
}
