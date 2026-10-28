import {useLayoutEffect, useRef} from 'react';
import {useTranslation} from 'react-i18next';
import ChapterNotes from './ChapterNotes';
import type {Chapter} from './storyStorage';

export default function ManuscriptEditor({chapter, onChange}: {chapter: Chapter; onChange: (patch: Partial<Chapter>) => void}) {
    const {t} = useTranslation('main');
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
    }, [chapter.id, chapter.text]);
    return <div className="novel-manuscript-page">
        <input className="novel-chapter-title" aria-label={t('novelStudio.chapterTitle')} maxLength={200} value={chapter.title} onChange={event => onChange({title: event.target.value})}/>
        <textarea ref={textRef} className="novel-manuscript" aria-label={t('novelStudio.text')} maxLength={1000000} placeholder={t('novelStudio.manuscriptPlaceholder')} value={chapter.text} onChange={event => onChange({text: event.target.value})}/>
        <ChapterNotes notes={chapter.workNotes ?? []}/>
    </div>;
}
