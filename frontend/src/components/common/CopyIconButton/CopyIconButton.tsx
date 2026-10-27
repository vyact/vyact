import {useEffect, useState} from 'react';
import {Check, Copy} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import {copyToClipboard} from '../../../utils/helpers';

export default function CopyIconButton({text, className = 'icon-btn'}: {text: string; className?: string}) {
    const {t} = useTranslation('main');
    const [copied, setCopied] = useState(false);
    useEffect(() => {
        if (!copied) return;
        const timer = setTimeout(() => setCopied(false), 1500);
        return () => clearTimeout(timer);
    }, [copied]);
    return <button type="button" className={className} data-tooltip-disabled="" aria-label={t(copied ? 'codeFileViewer.copied' : 'codeFileViewer.copy')}
        onClick={async event => {
            event.preventDefault();
            event.stopPropagation();
            setCopied(await copyToClipboard(text));
        }}>
        {copied ? <Check size={14}/> : <Copy size={14}/>}
    </button>;
}
