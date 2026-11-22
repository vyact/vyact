import {useEffect, type ReactNode} from 'react';
import {useTranslation} from 'react-i18next';
import CustomSelect from '../CustomSelect/CustomSelect';
import type {StockMarket, StockSymbol} from '../../services/stockAnalysis';
import StockReferenceScopeSelect from './StockReferenceScopeSelect';
import useStockDirectory from './useStockDirectory';
import {MARKET_INDEX_LABELS} from './marketIndexLabels';
import type {StockChatScope} from '../common/CommunityChat/stockChatScope';

const UNFILTERED_INSTRUMENT_LIMIT = 200;

export default function StockChatPicker({localMarket, directory, enabled, scope, onScopeChange, accountMenu}: {
    localMarket: StockMarket;
    directory: StockSymbol[];
    enabled: boolean;
    accountMenu?: ReactNode;
    scope: StockChatScope;
    onScopeChange: (scope: StockChatScope) => void;
}) {
    const {t, i18n} = useTranslation('main');
    const selectedSymbol = scope.symbol ?? '';
    const hasMarket = !!scope.market;
    const market = scope.market || localMarket;
    const {rows, error, reload} = useStockDirectory(market, i18n.resolvedLanguage ?? i18n.language, hasMarket, localMarket, directory);
    const label = t('stockAnalysis.community.stockRoom');
    const indices = MARKET_INDEX_LABELS[market].map(({symbol, key}) => ({value: symbol, name: t(`stockAnalysis.${key}`)}));
    const stocks = (rows ?? []).map(({symbol, name}) => ({value: symbol, name}));
    const instruments = [...indices, ...stocks];
    const selectedName = instruments.find(item => item.value === selectedSymbol)?.name;
    useEffect(() => {
        if (selectedName && selectedName !== scope.stockName) {
            onScopeChange({...scope, stockName: selectedName});
        }
    }, [scope, selectedName, onScopeChange]);
    if (selectedSymbol && !selectedName) {
        instruments.unshift({value: selectedSymbol, name: scope.stockName ?? selectedSymbol});
    }
    return <div className="stock-community-picker">
        <StockReferenceScopeSelect value={scope.market || 'global'} globalLabel={t('stockAnalysis.community.allMarkets')}
            portal showTriggerIcon disabled={!enabled} onChange={value => {
                const nextMarket = value === 'global' ? '' : value;
                if (nextMarket !== scope.market) onScopeChange({market: nextMarket});
            }}/>
        <CustomSelect optionsPageSize={100} unfilteredOptionsLimit={UNFILTERED_INSTRUMENT_LIMIT} value={selectedSymbol} searchable portal clearable onClear={() => onScopeChange({market})} disabled={!enabled || !hasMarket} ariaLabel={label} searchPlaceholder={label}
            placeholder={hasMarket ? label : t('stockAnalysis.community.selectMarketFirst')}
            options={instruments.map(({value, name}) => ({value, label: name === value ? value : `${name} · ${value}`}))}
            onChange={symbol => {
                if (symbol === selectedSymbol) return;
                onScopeChange({market, symbol, stockName: instruments.find(item => item.value === symbol)?.name});
            }}/>
        {accountMenu}
        {hasMarket && market !== localMarket && error &&
            <button type="button" className="modal-action-cancel stock-community-picker-retry" onClick={reload}>{t('stockAnalysis.retry')}</button>}
    </div>;
}
