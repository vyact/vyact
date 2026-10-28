import type {Story} from './storyStorage';
export interface TitleSource {id: string; title: string; content: string}
export function getTitleSources(story: Story): {chapters: TitleSource[]; settings: TitleSource[]} {
    return {
        chapters: story.chapters.filter(item => item.text.trim()).map(item => ({id: `chapter:${item.id}`, title: item.title, content: item.text})),
        settings: (story.finalSettings ?? []).filter(item => item.content.trim()).map(item => ({id: `setting:${item.id}`, title: item.title, content: item.content})),
    };
}
export function selectTitleSources(sources: TitleSource[], excluded: ReadonlySet<string>): TitleSource[] {
    return sources.filter(source => !excluded.has(source.id));
}
