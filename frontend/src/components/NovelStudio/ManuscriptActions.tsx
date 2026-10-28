import {CircleHelp, FileText, NotebookPen} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import {Tooltip} from '../common/Tooltip/Tooltip';

export default function ManuscriptActions({hasText, active, busy, onChoose}: {hasText: boolean; active: string; busy: boolean; onChoose: (action: string) => void}) {
    const {t} = useTranslation('main');
    return <div className="novel-manuscript-actions">{[hasText ? 'continue' : 'start', 'outline', 'review'].map(action => {
        const isNote = action === 'outline' || action === 'review';
        const unavailable = action === 'review' && !hasText;
        const help = <div className="novel-action-help-content">
            <strong>{t(`novelStudio.manuscriptActions.${action}`)}</strong>
            <p>{t(`novelStudio.${action}Prompt`)}</p>
            <div className="novel-action-help-result"><span>{isNote ? <NotebookPen size={15}/> : <FileText size={15}/>}<b>{t(`novelStudio.${isNote ? 'saveWorkNote' : 'addToManuscript'}`)}</b></span><p>{t(`novelStudio.${isNote ? 'noteSaveHelp' : 'manuscriptApplyHelp'}`)}</p></div>
            {unavailable && <small>{t('novelStudio.reviewNeedsText')}</small>}
        </div>;
        return <div className={`novel-manuscript-action${active === action ? ' is-active' : ''}${unavailable ? ' is-unavailable' : ''}`} key={action}>
            <Tooltip content={help} multiline size="medium"><button type="button" className="novel-manuscript-action-help" aria-label={t(`novelStudio.manuscriptActionHelp.${action}`)}><CircleHelp size={15}/></button></Tooltip>
            <button type="button" className="novel-manuscript-action-select" data-tooltip-disabled="" aria-pressed={active === action} disabled={busy || unavailable} onClick={() => onChoose(action)}>{t(`novelStudio.manuscriptActions.${action}`)}</button>
        </div>;
    })}</div>;
}
