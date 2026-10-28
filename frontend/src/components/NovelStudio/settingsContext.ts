import {SETTING_CATEGORIES, type SettingCandidate, type SettingCategory} from './storyStorage';

export function getSettingsContext(candidates: SettingCandidate[], action: string, excludedCategories: readonly SettingCategory[] = []): SettingCandidate[] {
    const includedCandidates = candidates.filter(candidate => !excludedCategories.includes(candidate.category));
    if (action === 'synthesis') return includedCandidates.filter(candidate => candidate.selected);
    const currentIndex = SETTING_CATEGORIES.indexOf(action as SettingCategory);
    return includedCandidates.filter(candidate => candidate.selected && SETTING_CATEGORIES.indexOf(candidate.category) < currentIndex);
}
