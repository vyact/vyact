import {useTranslation} from 'react-i18next';
import CustomSelect from '../CustomSelect/CustomSelect';
import './StockRefreshInterval.css';
import {REFRESH_INTERVALS} from './chartRefreshPreference';


export default function StockRefreshInterval({seconds, onChange}: {seconds: number; onChange: (seconds: number) => void}) {
    const {t} = useTranslation('main');
    return <div className="stock-refresh-interval">
        <span>{t('stockAnalysis.mapRefreshInterval')}</span>
        <CustomSelect value={String(seconds)} onChange={value => onChange(Number(value))}
            options={REFRESH_INTERVALS.map(value => ({value: String(value), label: t(
                value < 60 ? 'stockAnalysis.mapRefreshSeconds' : 'stockAnalysis.mapRefreshMinutes',
                {count: value < 60 ? value : value / 60},
            )}))} ariaLabel={t('stockAnalysis.mapRefreshInterval')} portal alignRight/>
    </div>;
}
