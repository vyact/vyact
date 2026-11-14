import {Check, ChevronDown} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import CustomSelect from '../CustomSelect/CustomSelect';
import {STOCK_MARKETS, type StockMarket} from '../../services/stockAnalysis';
import StockMarketFlag from './StockMarketFlag';
import './StockMarketSelect.css';

export default function StockMarketSelect({value, onChange, compact = false, portal = true, disabled = false}: {
    value: StockMarket; onChange: (market: StockMarket) => void; compact?: boolean; portal?: boolean; disabled?: boolean;
}) {
    const {t} = useTranslation('main');
    const label = (market: StockMarket) => t(`stockAnalysis.${compact ? `countries.${market}` : market}`);
    const content = (market: StockMarket) => <span className="stock-market-label"><StockMarketFlag market={market}/><span>{label(market)}</span></span>;
    return <CustomSelect className="stock-market-select" value={value} portal={portal} disabled={disabled}
        ariaLabel={t('stockAnalysis.market')} options={STOCK_MARKETS.map(market => ({value: market, label: label(market)}))}
        onChange={market => {if (STOCK_MARKETS.includes(market as StockMarket)) onChange(market as StockMarket);}}
        renderTrigger={(_, open) => <>{content(value)}<ChevronDown size={14} aria-hidden="true" className={open ? 'stock-market-chevron-open' : undefined}/></>}
        renderOption={(option, selected) => <>{content(option.value as StockMarket)}{selected && <Check size={14} aria-hidden="true"/>}</>}/>;
}
