export const NOVEL_STUDIO_PANEL_ID = 'novel-studio';
export interface Chapter {id: string; title: string; text: string}
export const SETTING_CATEGORIES = ['createDirection', 'createPremise', 'createCharacters', 'createWorld', 'createPlot', 'createStyle'] as const;
export type SettingCategory = typeof SETTING_CATEGORIES[number];
export interface SettingCandidate {id: string; category: SettingCategory; title: string; content: string; selected: boolean; generationInstruction?: string; authorDirection?: string}
export interface Story {id: string; title: string; bible: string; chapters: Chapter[]; settingsCandidates?: SettingCandidate[]}
export function createChapter(title: string): Chapter {return {id: crypto.randomUUID(), title, text: ''};}
export function createStory(title: string, chapterTitle: string): Story {
    return {id: crypto.randomUUID(), title, bible: '', chapters: [createChapter(chapterTitle)]};
}
