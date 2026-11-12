import {assertOk} from '../../utils/apiError';

export type QuestionScope = 'stock' | 'groups';
export type SavedStockQuestion = {id: string; title: string; question: string};
export const SAVED_QUESTION_TITLE_LIMIT = 80;
export const SAVED_QUESTION_LIMIT = 200;
export const SAVED_QUESTION_TEXT_LIMIT = 4000;
const cacheKey = (scope: QuestionScope) => `vyact:stock-analysis:saved-questions:${scope}`;
export function normalizeSavedQuestions(value: unknown): SavedStockQuestion[] {
    if (!Array.isArray(value)) return [];
    const ids = new Set<string>();
    return value.filter((item): item is SavedStockQuestion => {
        if (!item || typeof item.id !== 'string' || !item.id || item.id.length > 64 || ids.has(item.id)
            || typeof item.title !== 'string' || !item.title.trim() || item.title.length > SAVED_QUESTION_TITLE_LIMIT
            || typeof item.question !== 'string' || !item.question.trim() || item.question.length > SAVED_QUESTION_TEXT_LIMIT) return false;
        ids.add(item.id); return true;
    }).slice(0, SAVED_QUESTION_LIMIT);
}
export function readSavedQuestionCache(scope: QuestionScope): SavedStockQuestion[] {
    try {return normalizeSavedQuestions(JSON.parse(localStorage.getItem(cacheKey(scope)) ?? '[]'));} catch {return [];}
}
function cache(scope: QuestionScope, items: SavedStockQuestion[]) {
    try {localStorage.setItem(cacheKey(scope), JSON.stringify(items));} catch { /* Optional cache. */ }
}
export async function loadSavedQuestions(scope: QuestionScope, signal: AbortSignal) {
    const response = await fetch(`/api/stock-analysis/saved-questions/${scope}`, {signal, cache: 'no-store'});
    await assertOk(response);
    const data = await response.json();
    const items = normalizeSavedQuestions(data.items);
    if (!signal.aborted) cache(scope, items);
    return items;
}
export async function saveQuestions(scope: QuestionScope, items: SavedStockQuestion[]) {
    const response = await fetch(`/api/stock-analysis/saved-questions/${scope}`, {method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({items})});
    await assertOk(response);
    cache(scope, items);
}
