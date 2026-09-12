import {useEffect, useState} from 'react';
import {Check, Copy} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import {copyToClipboard} from '../../utils/helpers';

export default function LogCopyButton({text}: {text: string}) {
    const {t} = useTranslation('main');
    const [copied, setCopied] = useState(false);
    useEffect(() => {
        if (!copied) return;
        const timer = setTimeout(() => setCopied(false), 1500);
        return () => clearTimeout(timer);
    }, [copied]);
    return <button type="button" className="icon-btn log-copy-button" aria-label={t(copied ? 'codeFileViewer.copied' : 'codeFileViewer.copy')}
        onClick={async event => {
            event.preventDefault();
            event.stopPropagation();
            setCopied(await copyToClipboard(text));
        }}>
        {copied ? <Check size={14}/> : <Copy size={14}/>}
    </button>;
}
