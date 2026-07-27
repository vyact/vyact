import {useCallback, useState} from 'react';
import { useTranslation } from 'react-i18next';
import { COMMANDS } from '../../constants/commands';
import {usePluginExtensions} from '../../plugins/usePluginExtensions';

export function useSlashCommand(
    systemPrompts: { id: string; title: string; content: string }[],
    onSystemPromptSelect?: (promptId: string | null) => void,
    setValue?: (v: string) => void
) {
    const { t } = useTranslation('main');
    const {commands: pluginCommands} = usePluginExtensions();
    const availableCommands = [...COMMANDS, ...pluginCommands];
    const [slashSuggestions, setSlashSuggestions] = useState<typeof availableCommands>([]);
    const [selectedSuggestion, setSelectedSuggestion] = useState(0);
    const [promptSuggestions, setPromptSuggestions] = useState<{ id: string; title: string; content: string }[]>([]);
    const [selectedPromptSuggestion, setSelectedPromptSuggestion] = useState(0);

    const handleValueChange = (v: string) => {
        // @ 시스템 프롬프트 자동완성
        if (v.startsWith('@')) {
            const keyword = v.slice(1).toLowerCase();
            const allPrompts = [{
                id: '',
                title: t('sidebar.none'),
                content: t('chatInput.noSystemPromptDescription'),
            }, ...systemPrompts];
            const filtered = keyword ? allPrompts.filter(p => p.title.toLowerCase().includes(keyword)) : allPrompts;
            setPromptSuggestions(filtered);
            setSelectedPromptSuggestion(0);
            setSlashSuggestions([]);
        } else {
            setPromptSuggestions([]);
        }
        // / 슬래시 자동완성
        if (v.startsWith('/') && !v.includes(' ')) {
            const filtered = availableCommands.filter(c => c.cmd.startsWith(v));
            setSlashSuggestions(filtered);
            setSelectedSuggestion(0);
        } else {
            setSlashSuggestions([]);
        }
    };

    const handleKeyDown = (
        e: React.KeyboardEvent<HTMLTextAreaElement>,
        onSelectSlash: (cmd: string) => void
    ) => {
        if (e.nativeEvent.isComposing || e.keyCode === 229) return false;

        // @ 프롬프트 자동완성 키
        if (promptSuggestions.length > 0) {
            if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedPromptSuggestion(i => (i + 1) % promptSuggestions.length); return true; }
            if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedPromptSuggestion(i => (i - 1 + promptSuggestions.length) % promptSuggestions.length); return true; }
            if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault();
                const selected = promptSuggestions[selectedPromptSuggestion];
                onSystemPromptSelect?.(selected.id || null);
                setValue?.(''); setPromptSuggestions([]);
                return true;
            }
            if (e.key === 'Escape') { setPromptSuggestions([]); setValue?.(''); return true; }
        }

        // / 슬래시 자동완성 키
        if (slashSuggestions.length > 0) {
            if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedSuggestion(i => (i + 1) % slashSuggestions.length); return true; }
            if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedSuggestion(i => (i - 1 + slashSuggestions.length) % slashSuggestions.length); return true; }
            if (e.key === 'Enter') { e.preventDefault(); onSelectSlash(slashSuggestions[selectedSuggestion].cmd); return true; }
            if (e.key === 'Escape') { setSlashSuggestions([]); return true; }
        }

        return false;
    };

    const clearSuggestions = useCallback(() => {
        setSlashSuggestions([]);
        setPromptSuggestions([]);
    }, []);

    return {
        slashSuggestions, selectedSuggestion, setSelectedSuggestion,
        promptSuggestions, selectedPromptSuggestion, setSelectedPromptSuggestion,
        handleValueChange, handleKeyDown, clearSuggestions,
    };
}
