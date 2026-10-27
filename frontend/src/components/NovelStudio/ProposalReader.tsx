import {useMemo, useState} from 'react';
import {ArrowLeft, FileText, LoaderCircle, Pencil} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import {renderMarkdown} from '../../utils/markdownUtils';

export default function ProposalReader({text, action, busy, onChange, onBack}: {text: string; action: string; busy: boolean; onChange: (text: string) => void; onBack: () => void}) {
    const {t} = useTranslation('main');
    const [editing, setEditing] = useState(false);
    const html = useMemo(() => renderMarkdown(text), [text]);
    return <section className="novel-response-reader" aria-label={t('novelStudio.proposal')}>
        <header><div><span className="novel-response-eyebrow">{t('novelStudio.responseReview')}</span><h2>{t(`novelStudio.${action}`)}</h2></div><div className="novel-response-tools"><button disabled={busy} aria-pressed={editing} onClick={() => setEditing(!editing)}>{editing ? <FileText size={15}/> : <Pencil size={15}/>} {t(`novelStudio.${editing ? 'readResponse' : 'editResponse'}`)}</button><button disabled={busy} onClick={onBack}><ArrowLeft size={15}/>{t('novelStudio.backToWorkspace')}</button></div></header>
        {busy ? <div className="novel-response-loading" role="status"><LoaderCircle className="novel-spinner" size={24}/><h3>{t('novelStudio.generatingResponse')}</h3><p>{t('novelStudio.responseHelp')}</p></div>
            : editing ? <textarea className="novel-response-editor" aria-label={t('novelStudio.proposal')} value={text} onChange={event => onChange(event.target.value)}/>
                : <article className="novel-response-content" dangerouslySetInnerHTML={{__html: html}}/>}
    </section>;
}
