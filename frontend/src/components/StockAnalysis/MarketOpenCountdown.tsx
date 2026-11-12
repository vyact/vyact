import {useEffect, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {marketOpeningCountdown} from './marketOpeningCountdown';
import {Clock3} from 'lucide-react';

const MILLISECONDS_PER_MINUTE = 60_000;
const MINUTES_PER_HOUR = 60;

export function formatTimeUntilOpen(opening: number, now: number, language: string): string | null {
    const remaining = opening * 1000 - now;
    if (!Number.isFinite(remaining) || remaining <= 0) return null;
    const totalMinutes = Math.ceil(remaining / MILLISECONDS_PER_MINUTE);
    const hours = Math.floor(totalMinutes / MINUTES_PER_HOUR);
    const minutes = totalMinutes % MINUTES_PER_HOUR;
    const format = (value: number, unit: 'hour' | 'minute') => new Intl.NumberFormat(language, {
        style: 'unit', unit, unitDisplay: 'short',
    }).format(value);
    return [hours ? format(hours, 'hour') : '', minutes ? format(minutes, 'minute') : ''].filter(Boolean).join(' ');
}

export default function MarketOpenCountdown({opening, includePremarket = false}: {opening?: number; includePremarket?: boolean}) {
    const {t, i18n} = useTranslation('main');
    const [now, setNow] = useState(Date.now);
    useEffect(() => {
        if (!opening) return;
        setNow(Date.now());
        const timer = window.setInterval(() => setNow(Date.now()), 1000);
        return () => window.clearInterval(timer);
    }, [opening]);
    const language = i18n.resolvedLanguage ?? 'en';
    const countdown = opening ? marketOpeningCountdown(opening, now, includePremarket) : null;
    const time = countdown ? formatTimeUntilOpen(countdown.target, now, language) : null;
    if (!time || !countdown || !opening) return null;
    const label = countdown.stage === 'premarketUpcoming' ? 'premarketOpensIn'
        : countdown.stage === 'premarketActive' ? 'premarketRegularOpensIn' : 'regularMarketOpensIn';
    return <div className="stock-market-open-countdown" role="timer">
        <Clock3 size={12} aria-hidden="true"/>
        {t(`stockAnalysis.${label}`, {time})}
    </div>;
}
