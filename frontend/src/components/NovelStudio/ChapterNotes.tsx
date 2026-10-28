import {useMemo} from 'react';
import {useTranslation} from 'react-i18next';
import {renderMarkdown} from '../../utils/markdownUtils';
import type {Chapter} from './storyStorage';
export default function ChapterNotes({notes}: {notes: NonNullable<Chapter['workNotes']>}) {
    const {t} = useTranslation('main');
    const rendered = useMemo(() => notes.map(note => ({...note, html: renderMarkdown(note.content)})), [notes]);
    if (!notes.length) return null;
    return <section className="novel-chapter-notes"><h3>{t('novelStudio.workNotes')}</h3>{rendered.map(note => <details key={note.id}><summary>{t(`novelStudio.manuscriptActions.${note.kind}`)}</summary><div className="novel-candidate-preview-content" dangerouslySetInnerHTML={{__html: note.html}}/></details>)}</section>;
}
