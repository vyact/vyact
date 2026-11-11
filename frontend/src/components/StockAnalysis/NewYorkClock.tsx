import {useEffect, useState} from 'react';
import {useTranslation} from 'react-i18next';

export default function NewYorkClock() {
    const {t, i18n} = useTranslation('main');
    const [now, setNow] = useState(Date.now);
    useEffect(() => {
        const timer = window.setInterval(() => setNow(Date.now()), 1000);
        return () => window.clearInterval(timer);
    }, []);
    const date = new Intl.DateTimeFormat(i18n.resolvedLanguage, {
        timeZone: 'America/New_York', month: 'numeric', day: 'numeric',
        hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).format(now);
    return <span className="stock-market-clock">{t('stockAnalysis.newYorkTime', {time: date})}</span>;
}
