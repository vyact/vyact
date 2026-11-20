import {useTranslation} from 'react-i18next';
import CustomSelect from '../CustomSelect/CustomSelect';
import {STOCK_MARKETS, type StockMarket} from '../../services/stockAnalysis';
import StockMarketFlag from './StockMarketFlag';
import {Globe} from 'lucide-react';

export type StockReferenceScope = StockMarket | 'global';

export default function StockReferenceScopeSelect({value, onChange, globalLabel, portal = false, disabled = false}: {
    value: StockReferenceScope; onChange: (scope: StockReferenceScope) => void; globalLabel?: string; portal?: boolean; disabled?: boolean;
}) {
    const {t} = useTranslation('main');
    const label = (scope: string) => scope === 'global' ? (globalLabel ?? t('stockAnalysis.globalIndicators.title')) : t(`stockAnalysis.countries.${scope}`);
    return <CustomSelect className="stock-market-select" value={value} portal={portal} disabled={disabled}
        ariaLabel={t('stockAnalysis.market')}
        options={['global', ...STOCK_MARKETS].map(scope => ({value: scope, label: label(scope)}))}
        onChange={scope => onChange(scope as StockReferenceScope)}
        renderOption={option => <span className="stock-market-label">
            {option.value === 'global' ? <Globe size={16} strokeWidth={1.6} aria-hidden="true"/> : <StockMarketFlag market={option.value as StockMarket}/>}
            <span>{option.label}</span>
        </span>}/>;
}
