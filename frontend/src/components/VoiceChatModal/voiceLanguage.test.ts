import {expect, it} from 'vitest';
import {buildVoiceSystemPrompt, LANGUAGES, VOICE_SYSTEM_PROMPTS} from './voiceChat.types';

it('retains French instructions with a custom system prompt', () => {
    const prompt = buildVoiceSystemPrompt('fr-FR', 'Custom assistant instructions');
    expect(prompt).toContain('Custom assistant instructions');
    expect(prompt.endsWith(VOICE_SYSTEM_PROMPTS['fr-FR'])).toBe(true);
});
it('has conversation instructions for every selectable language', () => {
    for (const language of LANGUAGES) {
        expect(VOICE_SYSTEM_PROMPTS[language.code]).toBeTruthy();
        expect(buildVoiceSystemPrompt(language.code)).toBe(VOICE_SYSTEM_PROMPTS[language.code]);
    }
});
