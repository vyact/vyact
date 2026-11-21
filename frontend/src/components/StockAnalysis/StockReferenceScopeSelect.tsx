import {useTranslation} from 'react-i18next';
import CustomSelect from '../CustomSelect/CustomSelect';
import {STOCK_MARKETS, type StockMarket} from '../../services/stockAnalysis';
import StockMarketFlag from './StockMarketFlag';
import {Globe} from 'lucide-react';

export type StockReferenceScope = StockMarket | 'global';

export default function StockReferenceScopeSelect({value, onChange, globalLabel, portal = false, disabled = false, showTriggerIcon = false}: {
    value: StockReferenceScope; onChange: (scope: StockReferenceScope) => void; globalLabel?: string; portal?: boolean; disabled?: boolean; showTriggerIcon?: boolean;
}) {
    const {t} = useTranslation('main');
    const label = (scope: string) => scope === 'global' ? (globalLabel ?? t('stockAnalysis.globalIndicators.title')) : t(`stockAnalysis.countries.${scope}`);
    const renderLabel = (scope: string, text: string) => <span className="stock-market-label">
        {scope === 'global' ? <Globe size={16} strokeWidth={1.6} aria-hidden="true"/> : <StockMarketFlag market={scope as StockMarket}/>}
        <span>{text}</span>
    </span>;
    return <CustomSelect className="stock-market-select" value={value} portal={portal} disabled={disabled}
        ariaLabel={t('stockAnalysis.market')}
        options={['global', ...STOCK_MARKETS].map(scope => ({value: scope, label: label(scope)}))}
        onChange={scope => onChange(scope as StockReferenceScope)}
        renderTriggerLabel={showTriggerIcon ? selectedLabel => renderLabel(value, selectedLabel) : undefined}
        renderOption={option => renderLabel(option.value, option.label)}/>;
}
