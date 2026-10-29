import {Pencil, Check} from 'lucide-react';
import {renderMarkdown} from '../../utils/markdownUtils';
import {useLayoutEffect, useMemo, useRef, useState} from 'react';
import {useTranslation} from 'react-i18next';
import ChapterNotes from './ChapterNotes';
import type {Chapter} from './storyStorage';

export default function ManuscriptEditor({chapter, onChange}: {chapter: Chapter; onChange: (patch: Partial<Chapter>) => void}) {
    const {t} = useTranslation('main');
    const [editing, setEditing] = useState(!chapter.text.trim());
    const html = useMemo(() => editing ? '' : renderMarkdown(chapter.text), [chapter.text, editing]);
    const textRef = useRef<HTMLTextAreaElement>(null);
    useLayoutEffect(() => {
        const input = textRef.current;
        if (!input) return;
        const resize = () => {input.style.height = '0px'; input.style.height = `${input.scrollHeight}px`;};
        resize();
        let previousWidth = input.clientWidth;
        const observer = new ResizeObserver(() => {
            if (input.clientWidth !== previousWidth) {previousWidth = input.clientWidth; resize();}
        });
        observer.observe(input);
        return () => observer.disconnect();
    }, [chapter.id, chapter.text, editing]);
    return <div className="novel-manuscript-page">
        <header className="novel-manuscript-heading">{editing ? <input className="novel-chapter-title" aria-label={t('novelStudio.chapterTitle')} maxLength={200} value={chapter.title} onChange={event => onChange({title: event.target.value})}/> : <h2>{chapter.title}</h2>}<button type="button" className="modal-action-cancel" aria-pressed={editing} data-tooltip-disabled="" onClick={() => setEditing(!editing)}>{editing ? <Check size={15}/> : <Pencil size={15}/>}<span>{t(`novelStudio.${editing ? 'finishManuscriptEdit' : 'editManuscript'}`)}</span></button></header>
        {editing ? <textarea ref={textRef} className="novel-manuscript" aria-label={t('novelStudio.text')} maxLength={1000000} placeholder={t('novelStudio.manuscriptPlaceholder')} value={chapter.text} onChange={event => onChange({text: event.target.value})}/> : <article className="novel-manuscript-reading" dangerouslySetInnerHTML={{__html: html}}/>}
        <ChapterNotes notes={chapter.workNotes ?? []}/>
    </div>;
}
