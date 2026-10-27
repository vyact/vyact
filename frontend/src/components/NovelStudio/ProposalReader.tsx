import {useMemo, useState, type ReactNode} from 'react';
import {FileText, LoaderCircle, Pencil, ArrowLeft} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import {renderMarkdown} from '../../utils/markdownUtils';

export default function ProposalReader({text, action, busy, onChange, title, onReturn, context, maxLength}: {text: string; action: string; busy: boolean; onChange: (text: string) => void; title?: string; onReturn?: () => void; context?: ReactNode; maxLength?: number}) {
    const {t} = useTranslation('main');
    const [editing, setEditing] = useState(false);
    const html = useMemo(() => renderMarkdown(text), [text]);
    return <section className="novel-response-reader" aria-label={t('novelStudio.proposal')}>
        <header><div className="novel-response-title"><span className="novel-response-eyebrow">{t(onReturn ? `novelStudio.${action}` : 'novelStudio.responseReview')}</span><h2>{title || t(`novelStudio.${action}`)}</h2></div><div className="novel-response-tools"><button disabled={busy} aria-pressed={editing} onClick={() => setEditing(!editing)}>{editing ? <FileText size={15}/> : <Pencil size={15}/>} {t(`novelStudio.${editing ? 'readResponse' : 'editResponse'}`)}</button>{onReturn && <button onClick={onReturn}><ArrowLeft size={15}/>{t('novelStudio.backToList')}</button>}</div></header>
        {busy ? <div className="novel-response-loading" role="status"><LoaderCircle className="novel-spinner" size={24}/><h3>{t('novelStudio.generatingResponse')}</h3><p>{t('novelStudio.responseHelp')}</p></div>
            : editing ? <textarea className="novel-response-editor" aria-label={t('novelStudio.proposal')} value={text} maxLength={maxLength} onChange={event => onChange(event.target.value)}/>
                : <article className="novel-response-content">{context}<div dangerouslySetInnerHTML={{__html: html}}/></article>}
    </section>;
}
