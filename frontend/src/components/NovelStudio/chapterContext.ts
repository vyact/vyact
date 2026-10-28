import type {Chapter} from './storyStorage';
export function getEarlierChapters(chapters: Chapter[], currentId: string): Chapter[] {
    const position = chapters.findIndex(chapter => chapter.id === currentId);
    return position > 0 ? chapters.slice(0, position).filter(chapter => chapter.text.trim()) : [];
}
export function buildChapterContext(chapters: Chapter[], currentId: string, enabled: boolean): string {
    return enabled ? getEarlierChapters(chapters, currentId).map(chapter => `${chapter.title}\n${chapter.text}`).join('\n\n').slice(-30000) : '';
}
