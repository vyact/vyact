import {useState} from 'react';
import {useTranslation} from 'react-i18next';
import type {StockMarket, StockSymbol} from '../../services/stockAnalysis';
import {Check, Plus, Search} from 'lucide-react';
import ModalOverlay from '../common/ModalOverlay/ModalOverlay';
import ModalCloseButton from '../common/ModalOverlay/ModalCloseButton';
import {STOCK_GROUP_NAME_LIMIT, STOCK_GROUP_SIZE_LIMIT, type StockGroup} from './useStockGroups';
import './StockGroups.css';

const GROUP_SEARCH_LIMIT = 50;

export default function StockGroupDialog({group, market, directory, existingGroups, onSave, onClose}: {
    group?: StockGroup; market: StockMarket; directory: StockSymbol[]; existingGroups: StockGroup[]; onSave: (group: StockGroup) => void; onClose: () => void;
}) {
    const {t} = useTranslation('main');
    const tr = (key: string, options?: Record<string, unknown>) => t(`stockAnalysis.groups.${key}`, options);
    const [query, setQuery] = useState('');
    const [name, setName] = useState(group?.name ?? '');
    const [symbols, setSymbols] = useState(group?.symbols ?? []);
    const duplicateName = existingGroups.some(item => item.id !== group?.id && item.name.toLocaleLowerCase() === name.trim().toLocaleLowerCase());
    const search = query.trim().toLocaleLowerCase();
    const names = new Map(directory.map(stock => [stock.symbol, stock.name]));
    const results = search ? directory.filter(stock => `${stock.symbol} ${stock.name}`.toLocaleLowerCase().includes(search)).slice(0, GROUP_SEARCH_LIMIT)
        : symbols.map(symbol => ({symbol, name: names.get(symbol) ?? symbol}));
    const toggleSymbol = (symbol: string) => setSymbols(current => current.includes(symbol) ? current.filter(value => value !== symbol)
        : current.length < STOCK_GROUP_SIZE_LIMIT ? [...current, symbol] : current);
    return <ModalOverlay onClose={onClose} closeOnBackdrop captureEscape aria-labelledby="stock-group-title">
        <form className="stock-group-dialog" onSubmit={event => {
            event.preventDefault();
            if (!name.trim() || duplicateName) return;
            onSave({id: group?.id ?? crypto.randomUUID(), market, name: name.trim(), symbols});
            onClose();
        }}>
            <header><div className="stock-group-dialog-title"><h2 id="stock-group-title">{tr(group ? 'edit' : 'create')}</h2><small>{tr('limit', {count: STOCK_GROUP_SIZE_LIMIT})}</small></div><ModalCloseButton onClick={onClose}/></header>
            <label htmlFor="stock-group-name">{tr('name')}</label>
            <input id="stock-group-name" value={name} onChange={event => setName(event.target.value)} maxLength={STOCK_GROUP_NAME_LIMIT} required autoFocus/>
            {duplicateName && <p role="alert">{tr('duplicateName')}</p>}
            <label htmlFor="stock-group-search">{tr('stocks', {count: symbols.length})}</label>
            <div className="stock-analysis-search stock-group-search"><Search size={16} aria-hidden="true"/>
                <input id="stock-group-search" type="search" value={query} placeholder={t('stockAnalysis.search')}
                    onChange={event => setQuery(event.target.value)} onKeyDown={event => {if (event.key === 'Enter') event.preventDefault();}}/>
            </div>
            <ul className="stock-group-search-results" aria-label={tr('selectStocks')}>{results.map(stock => {
                const selected = symbols.includes(stock.symbol);
                return <li key={stock.symbol}><button type="button" aria-pressed={selected}
                    disabled={!selected && symbols.length >= STOCK_GROUP_SIZE_LIMIT} onClick={() => toggleSymbol(stock.symbol)}>
                    <span><strong>{stock.name}</strong><small>{stock.symbol}</small></span>
                    {selected ? <Check size={16} aria-hidden="true"/> : <Plus size={16} aria-hidden="true"/>}
                </button></li>;
            })}{!results.length && <li className="stock-group-no-results">{search ? tr('noResults') : t('stockAnalysis.search')}</li>}</ul>
            <footer><button type="button" className="modal-action-cancel" onClick={onClose}>{t('common:cancel')}</button>
                <button type="submit" className="modal-action-submit" disabled={!name.trim() || duplicateName}>{t('common:save')}</button></footer>
        </form>
    </ModalOverlay>;
}
