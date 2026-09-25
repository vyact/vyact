import {useLayoutEffect, useRef} from 'react';
import {X} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import CustomSelect from '../CustomSelect/CustomSelect';
import type {SelectOption} from '../CustomSelect/CustomSelect';
import './CodeInputBlock.css';

export const CODE_LANGUAGE_OPTIONS: SelectOption[] = [
    ...[
        ['bash', 'Bash'], ['c', 'C'], ['cpp', 'C++'], ['csharp', 'C#'], ['css', 'CSS'],
        ['diff', 'Diff'], ['go', 'Go'], ['html', 'HTML'], ['java', 'Java'],
        ['javascript', 'JavaScript'], ['json', 'JSON'], ['jsx', 'JSX'], ['kotlin', 'Kotlin'],
        ['markdown', 'Markdown'], ['php', 'PHP'], ['python', 'Python'], ['ruby', 'Ruby'],
        ['rust', 'Rust'], ['sql', 'SQL'], ['swift', 'Swift'], ['tsx', 'TSX'],
        ['typescript', 'TypeScript'], ['xml', 'XML'], ['yaml', 'YAML'],
    ].map(([value, label]) => ({value, label})),
];

export interface CodeInputValue {
    language: string;
    code: string;
}

export function removeCodeBlockTrigger(text: string): string | null {
    return /(^|\n)```$/.test(text) ? text.slice(0, -3).trimEnd() : null;
}

export function parseFencedCodeInput(text: string): CodeInputValue | null {
    const match = text.trim().match(/^(`{3,}|~{3,})([\w+#.-]*)\r?\n([\s\S]*?)\r?\n\1$/);
    if (!match) return null;
    return {language: match[2].toLowerCase(), code: match[3]};
}

export function formatCodeInput({language, code}: CodeInputValue): string {
    const longestFence = Math.max(3, ...Array.from(code.matchAll(/`+/g), match => match[0].length + 1));
    const fence = '`'.repeat(longestFence);
    return `${fence}${language}\n${code.replace(/\n+$/, '')}\n${fence}`;
}

interface CodeInputBlockProps {
    value: CodeInputValue;
    onChange: (value: CodeInputValue) => void;
    onRemove: () => void;
    onSend: () => void;
    disabled: boolean;
}

export default function CodeInputBlock({value, onChange, onRemove, onSend, disabled}: CodeInputBlockProps) {
    const {t} = useTranslation('main');
    const editorRef = useRef<HTMLTextAreaElement>(null);
    useLayoutEffect(() => {
        const editor = editorRef.current;
        if (!editor) return;
        editor.style.height = 'auto';
        editor.style.height = `${Math.min(editor.scrollHeight, 240)}px`;
    }, [value.code]);
    const languageOptions = [
        {value: '', label: t('chatInput.codeAutoDetect')},
        {value: 'text', label: t('chatInput.codePlainText')},
        ...CODE_LANGUAGE_OPTIONS,
    ];
    if (value.language && !languageOptions.some(option => option.value === value.language)) {
        languageOptions.push({value: value.language, label: value.language});
    }
    return <div className="code-input-block">
        <div className="code-input-block__header">
            <CustomSelect
                className="code-input-block__language"
                dropdownClassName="code-input-block__language-menu"
                options={languageOptions}
                value={value.language}
                onChange={language => onChange({...value, language})}
                searchable
                searchPlaceholder={t('chatInput.codeLanguageSearch')}
                ariaLabel={t('chatInput.codeLanguage')}
                portal
            />
            <button type="button" className="code-input-block__remove" onClick={onRemove} aria-label={t('chatInput.removeCodeBlock')}>
                <X size={15} aria-hidden="true"/>
            </button>
        </div>
        <textarea
            ref={editorRef}
            className="code-input-block__editor"
            value={value.code}
            onChange={event => onChange({...value, code: event.target.value})}
            onKeyDown={event => {
                event.stopPropagation();
                if (event.nativeEvent.isComposing || event.key !== 'Enter' || event.shiftKey) return;
                event.preventDefault();
                if (!event.repeat && !disabled) onSend();
            }}
            placeholder={t('chatInput.codePlaceholder')}
            spellCheck={false}
            aria-label={t('chatInput.codeBlock')}
        />
    </div>;
}
