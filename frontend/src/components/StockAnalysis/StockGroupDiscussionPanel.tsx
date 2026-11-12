import {useState} from 'react';
import {ChevronDown} from 'lucide-react';
import './StockGroupDiscussionPanel.css';
import {useTranslation} from 'react-i18next';
import CustomSelect from '../CustomSelect/CustomSelect';
import StockDiscussionPanel from './StockDiscussionPanel';
import type {StockGroup} from './useStockGroups';
import type {StockMarket, StockSymbol} from '../../services/stockAnalysis';

export default function StockGroupDiscussionPanel({groups, market, directory}: {
    groups: StockGroup[]; market: StockMarket; directory: StockSymbol[];
}) {
    const {t} = useTranslation('main');
    const [selectedIds, setSelectedIds] = useState<string[]>([]);
    const selectedGroups = groups.filter(group => selectedIds.includes(group.id));
    const allSelected = selectedGroups.length === 0;
    const scopeGroups = allSelected ? groups : selectedGroups;
    const name = allSelected ? t('stockAnalysis.groups.all') : selectedGroups.map(group => group.name).join(', ');
    const toggleGroup = (id: string) => setSelectedIds(current => {
        if (!id) return [];
        if (!current.includes(id)) return [...current, id];
        return current.length > 1 ? current.filter(value => value !== id) : current;
    });
    const countLabel = (symbols: string[]) => t('stockAnalysis.groups.stocks', {count: new Set(symbols).size});
    const options = [{value: '', label: t('stockAnalysis.groups.all'), description: countLabel(groups.flatMap(group => group.symbols))},
        ...groups.map(group => ({value: group.id, label: group.name, description: countLabel(group.symbols)}))];
    const scopeCount = countLabel(scopeGroups.flatMap(group => group.symbols));
    const renderLabel = (label: string, count: string) => <span className="stock-group-select-label">
        <span className="stock-group-select-name">{label}</span><span className="stock-group-select-count">{count}</span>
    </span>;
    const symbol = `MARKET-${market}`;
    return <StockDiscussionPanel market={market} directory={directory}
        stock={{symbol, name}} groups={scopeGroups}
        groupPicker={<section className="stock-discussion-references">
            <CustomSelect dropdownClassName="stock-group-select-dropdown" value="" selectedValues={allSelected ? [''] : selectedGroups.map(group => group.id)} closeOnSelect={false} ariaLabel={t('stockAnalysis.discussion.selectGroup')}
                options={options}
                renderTrigger={(_label, open) => <>{renderLabel(name, scopeCount)}
                    <ChevronDown size={14} className={`stock-group-select-chevron${open ? ' is-open' : ''}`} aria-hidden="true"/></>}
                renderOption={option => renderLabel(option.label, option.description ?? '')}
                onChange={toggleGroup} portal/>
        </section>}/>;
}
