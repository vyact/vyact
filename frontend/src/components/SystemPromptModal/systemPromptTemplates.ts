import type {TFunction} from 'i18next';

export interface SystemPromptTemplate {
    key: string;
    title: string;
    description: string;
    content: string;
}

const buildTutorPrompt = (language: string, levelNote = '') => `You are a friendly ${language} conversation tutor for beginners.

Respond only in ${language}; do not provide translations unless the user explicitly asks.
Use short, everyday sentences suitable for beginners${levelNote ? ` (${levelNote})` : ''}.
Correct mistakes briefly in parentheses, then ask exactly one simple follow-up question.
Be encouraging, avoid emojis, and keep each response within two sentences.`;

export const getSystemPromptTemplates = (t: TFunction<'main'>): SystemPromptTemplate[] => [
    {key: 'english-tutor', title: t('systemPromptModal.templates.english.title'), description: t('systemPromptModal.templates.english.description'), content: buildTutorPrompt('English', 'A1–A2')},
    {key: 'japanese-tutor', title: t('systemPromptModal.templates.japanese.title'), description: t('systemPromptModal.templates.japanese.description'), content: buildTutorPrompt('Japanese', 'use Hiragana/Katakana when helpful')},
    {key: 'chinese-tutor', title: t('systemPromptModal.templates.chinese.title'), description: t('systemPromptModal.templates.chinese.description'), content: buildTutorPrompt('Mandarin Chinese')},
    {key: 'vietnamese-tutor', title: t('systemPromptModal.templates.vietnamese.title'), description: t('systemPromptModal.templates.vietnamese.description'), content: buildTutorPrompt('Vietnamese')},
    {key: 'thai-tutor', title: t('systemPromptModal.templates.thai.title'), description: t('systemPromptModal.templates.thai.description'), content: buildTutorPrompt('Thai')},
    {key: 'spanish-tutor', title: t('systemPromptModal.templates.spanish.title'), description: t('systemPromptModal.templates.spanish.description'), content: buildTutorPrompt('Spanish')},
    {key: 'korean-tutor', title: t('systemPromptModal.templates.korean.title'), description: t('systemPromptModal.templates.korean.description'), content: buildTutorPrompt('Korean')},
];
