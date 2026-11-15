import {useTranslation} from 'react-i18next';
import CustomSelect from '../CustomSelect/CustomSelect';
import {STOCK_MARKETS, type StockMarket} from '../../services/stockAnalysis';
import StockMarketFlag from './StockMarketFlag';
import {Globe2} from 'lucide-react';

export type StockReferenceScope = StockMarket | 'global';

export default function StockReferenceScopeSelect({value, onChange}: {
    value: StockReferenceScope; onChange: (scope: StockReferenceScope) => void;
}) {
    const {t} = useTranslation('main');
    const label = (scope: string) => scope === 'global' ? t('stockAnalysis.globalIndicators.title') : t(`stockAnalysis.countries.${scope}`);
    return <CustomSelect className="stock-market-select" value={value} portal={false}
        ariaLabel={t('stockAnalysis.market')}
        options={[...STOCK_MARKETS, 'global'].map(scope => ({value: scope, label: label(scope)}))}
        onChange={scope => onChange(scope as StockReferenceScope)}
        renderOption={option => <span className="stock-market-label">
            {option.value === 'global' ? <Globe2 size={16} aria-hidden="true"/> : <StockMarketFlag market={option.value as StockMarket}/>}
            <span>{option.label}</span>
        </span>}/>;
}
