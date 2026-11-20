import {useState, type ReactNode} from 'react';
import {useTranslation} from 'react-i18next';
import CustomSelect from '../CustomSelect/CustomSelect';
import type {StockMarket, StockSymbol} from '../../services/stockAnalysis';
import StockReferenceScopeSelect, {type StockReferenceScope} from './StockReferenceScopeSelect';
import useStockDirectory from './useStockDirectory';
import {MARKET_INDEX_LABELS} from './marketIndexLabels';

export default function StockChatPicker({localMarket, directory, enabled, onScopeChange, accountMenu}: {
    localMarket: StockMarket;
    directory: StockSymbol[];
    enabled: boolean;
    accountMenu?: ReactNode;
    onScopeChange: (market: StockMarket | '', marketName: string, symbol?: string, stockName?: string) => void;
}) {
    const {t, i18n} = useTranslation('main');
    const [filter, setFilter] = useState<StockReferenceScope>('global');
    const [selectedSymbol, setSelectedSymbol] = useState('');
    const hasMarket = filter !== 'global';
    const market = hasMarket ? filter : localMarket;
    const {rows, error, reload} = useStockDirectory(market, i18n.resolvedLanguage ?? i18n.language, hasMarket, localMarket, directory);
    const label = t('stockAnalysis.community.stockRoom');
    const indices = MARKET_INDEX_LABELS[market].map(({symbol, key}) => ({value: symbol, name: t(`stockAnalysis.${key}`)}));
    const stocks = (rows ?? []).map(({symbol, name}) => ({value: symbol, name}));
    const instruments = [...indices, ...stocks];
    const marketName = t(`stockAnalysis.countries.${market}`);
    const clearStock = () => {
        setSelectedSymbol('');
        onScopeChange(market, marketName);
    };
    return <div className="stock-community-picker">
        <StockReferenceScopeSelect value={filter} globalLabel={t('stockAnalysis.community.allMarkets')}
            portal disabled={!enabled} onChange={scope => {
                if (scope === filter) return;
                setFilter(scope);
                setSelectedSymbol('');
                onScopeChange(scope === 'global' ? '' : scope, scope === 'global' ? '' : t(`stockAnalysis.countries.${scope}`));
            }}/>
        <CustomSelect optionsPageSize={100} value={selectedSymbol} searchable portal clearable onClear={clearStock} disabled={!enabled || !hasMarket} ariaLabel={label} searchPlaceholder={label}
            placeholder={hasMarket ? label : t('stockAnalysis.community.selectMarketFirst')}
            options={instruments.map(({value, name}) => ({value, label: `${name} · ${value}`}))}
            onChange={symbol => {
                if (symbol === selectedSymbol) return;
                setSelectedSymbol(symbol);
                onScopeChange(market, marketName, symbol, instruments.find(item => item.value === symbol)?.name ?? symbol);
            }}/>
        {accountMenu}
        {hasMarket && market !== localMarket && error &&
            <button type="button" className="modal-action-cancel stock-community-picker-retry" onClick={reload}>{t('stockAnalysis.retry')}</button>}
    </div>;
}
