import {Check, ChevronDown} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import CustomSelect from '../CustomSelect/CustomSelect';
import {STOCK_MARKETS, type StockMarket} from '../../services/stockAnalysis';
import './StockMarketSelect.css';

const FLAGS: Record<StockMarket, string> = {US: '🇺🇸', KR: '🇰🇷', JP: '🇯🇵'};
export default function StockMarketSelect({value, onChange, compact = false, portal = true}: {
    value: StockMarket; onChange: (market: StockMarket) => void; compact?: boolean; portal?: boolean;
}) {
    const {t} = useTranslation('main');
    const label = (market: StockMarket) => t(`stockAnalysis.${compact ? `countries.${market}` : market}`);
    const content = (market: StockMarket) => <span className="stock-market-label"><span className="stock-market-flag" aria-hidden="true">{FLAGS[market]}</span><span>{label(market)}</span></span>;
    return <CustomSelect className="stock-market-select" value={value} portal={portal}
        ariaLabel={t('stockAnalysis.market')} options={STOCK_MARKETS.map(market => ({value: market, label: label(market)}))}
        onChange={market => {if (STOCK_MARKETS.includes(market as StockMarket)) onChange(market as StockMarket);}}
        renderTrigger={(_, open) => <>{content(value)}<ChevronDown size={14} aria-hidden="true" className={open ? 'stock-market-chevron-open' : undefined}/></>}
        renderOption={(option, selected) => <>{content(option.value as StockMarket)}{selected && <Check size={14} aria-hidden="true"/>}</>}/>;
}
