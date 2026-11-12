import {useState} from 'react';
import {ChevronDown} from 'lucide-react';
import './StockGroupDiscussionPanel.css';
import {useTranslation} from 'react-i18next';
import CustomSelect from '../CustomSelect/CustomSelect';
import StockDiscussionPanel from './StockDiscussionPanel';
import type {StockGroup} from './useStockGroups';
import type {StockMarket, StockSymbol} from '../../services/stockAnalysis';

function conversationSymbol(market: StockMarket, groupId: string) {
    let hash = 2166136261;
    for (const character of groupId) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
    return `G-${market}-${(hash >>> 0).toString(16)}`;
}

export default function StockGroupDiscussionPanel({groups, market, directory}: {
    groups: StockGroup[]; market: StockMarket; directory: StockSymbol[];
}) {
    const {t} = useTranslation('main');
    const [selectedId, setSelectedId] = useState('');
    const selectedGroup = groups.find(group => group.id === selectedId);
    const selectedGroups = selectedGroup ? [selectedGroup] : groups;
    const name = selectedGroup?.name ?? t('stockAnalysis.groups.all');
    const countLabel = (symbols: string[]) => t('stockAnalysis.groups.stocks', {count: new Set(symbols).size});
    const options = [{value: '', label: t('stockAnalysis.groups.all'), description: countLabel(groups.flatMap(group => group.symbols))},
        ...groups.map(group => ({value: group.id, label: group.name, description: countLabel(group.symbols)}))];
    const selectedOption = options.find(option => option.value === (selectedGroup?.id ?? ''))!;
    const renderLabel = (label: string, count: string) => <span className="stock-group-select-label">
        <span className="stock-group-select-name">{label}</span><span className="stock-group-select-count">{count}</span>
    </span>;
    const symbol = conversationSymbol(market, selectedGroup?.id ?? 'all');
    return <StockDiscussionPanel key={`${market}:${selectedGroup?.id ?? 'all'}`} market={market} directory={directory}
        stock={{symbol, name}} groups={selectedGroups}
        groupPicker={<section className="stock-discussion-references">
            <CustomSelect dropdownClassName="stock-group-select-dropdown" value={selectedGroup?.id ?? ''} ariaLabel={t('stockAnalysis.discussion.selectGroup')}
                options={options}
                renderTrigger={(_label, open) => <>{renderLabel(selectedOption.label, selectedOption.description)}
                    <ChevronDown size={14} className={`stock-group-select-chevron${open ? ' is-open' : ''}`} aria-hidden="true"/></>}
                renderOption={option => renderLabel(option.label, option.description ?? '')}
                onChange={setSelectedId} portal/>
        </section>}/>;
}
