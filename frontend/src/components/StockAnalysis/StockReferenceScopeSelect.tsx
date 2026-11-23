import type {RefObject} from 'react';
import {useTranslation} from 'react-i18next';
import CustomSelect from '../CustomSelect/CustomSelect';
import {STOCK_MARKETS, type StockMarket} from '../../services/stockAnalysis';
import StockMarketFlag from './StockMarketFlag';
import {Globe} from 'lucide-react';

const LANGUAGES_WITH_SHORT_MARKET_NAMES = new Set(['ko', 'zh', 'ja', 'th']);

export type StockReferenceScope = StockMarket | 'global';

export default function StockReferenceScopeSelect({value, onChange, globalLabel, portal = false, disabled = false, compactTrigger = false, portalWidthBoundaryRef}: {
    value: StockReferenceScope; onChange: (scope: StockReferenceScope) => void; globalLabel?: string; portal?: boolean; disabled?: boolean; compactTrigger?: boolean;
    portalWidthBoundaryRef?: RefObject<HTMLElement | null>;
}) {
    const {t, i18n} = useTranslation('main');
    const language = (i18n.resolvedLanguage ?? i18n.language).split('-')[0];
    const useMarketCode = value !== 'global' && !LANGUAGES_WITH_SHORT_MARKET_NAMES.has(language);
    const label = (scope: string) => scope === 'global' ? (globalLabel ?? t('stockAnalysis.globalIndicators.title')) : t(`stockAnalysis.countries.${scope}`);
    const renderLabel = (scope: string, text: string) => <span className="stock-market-label">
        {scope === 'global' ? <Globe size={16} strokeWidth={1.6} aria-hidden="true"/> : <StockMarketFlag market={scope as StockMarket}/>}
        <span>{text}</span>
    </span>;
    return <CustomSelect className="stock-market-select" value={value} portal={portal} disabled={disabled}
        portalWidthBoundaryRef={portalWidthBoundaryRef} dropdownClassName={portalWidthBoundaryRef ? "stock-chat-market-dropdown" : undefined}
        ariaLabel={compactTrigger ? `${t('stockAnalysis.market')}: ${label(value)}` : t('stockAnalysis.market')}
        options={['global', ...STOCK_MARKETS].map(scope => ({value: scope, label: label(scope)}))}
        onChange={scope => onChange(scope as StockReferenceScope)}
        renderTriggerLabel={compactTrigger ? selectedLabel => renderLabel(value, useMarketCode ? value : selectedLabel) : undefined}
        renderOption={option => renderLabel(option.value, option.label)}/>;
}
