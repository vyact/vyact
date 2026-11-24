import {useState} from 'react';
import {useTranslation} from 'react-i18next';
import {Search, X} from 'lucide-react';
import CustomSelect from '../CustomSelect/CustomSelect';

const searchFields = [
    {value: 'subject', label: 'googleWorkspace.subject'},
    {value: 'to', label: 'googleWorkspace.recipient'},
    {value: 'from', label: 'googleWorkspace.sender'},
] as const;

type SearchField = typeof searchFields[number]['value'];

export default function MailSearch({query, disabled, onSearch}: {
    query: string;
    disabled: boolean;
    onSearch: (query: string) => void;
}) {
    const {t} = useTranslation('main');
    const activeSearch = /^(subject|to|from):"(.*)"$/s.exec(query);
    const [field, setField] = useState<SearchField>(() =>
        searchFields.find(option => option.value === activeSearch?.[1])?.value ?? 'subject');
    const [input, setInput] = useState(() => activeSearch?.[2] ?? '');
    const options = searchFields.map(option => ({value: option.value, label: t(option.label)}));

    return <form className="gwp-mail-search" role="search" onSubmit={event => {
        event.preventDefault();
        const term = input.replace(/["\\]/g, ' ').trim();
        if (term) onSearch(`${field}:"${term}"`);
    }}>
        <CustomSelect
            value={field}
            alignRight
            ariaLabel={t('googleWorkspace.mailSearch.field')}
            options={options}
            renderTriggerLabel={() => <span className="gwp-mail-search-field-label">
                {options.map(option => <span key={option.value} aria-hidden={option.value !== field}>
                    {option.label}
                </span>)}
            </span>}
            onChange={value => {
                const option = searchFields.find(option => option.value === value);
                if (option) setField(option.value);
            }}
            disabled={disabled}
        />
        <input value={input} onChange={event => setInput(event.target.value)}
            aria-label={t('common:search')} placeholder={t('common:search')} disabled={disabled}/>
        <button type="submit" aria-label={t('common:search')} disabled={disabled || !input.trim()}>
            <Search aria-hidden="true" size={17}/>
        </button>
        {(input || query) && <button type="button" aria-label={t('googleWorkspace.mailSearch.clear')} disabled={disabled}
            onClick={() => { setInput(''); onSearch(''); }}>
            <X aria-hidden="true" size={17}/>
        </button>}
    </form>;
}
