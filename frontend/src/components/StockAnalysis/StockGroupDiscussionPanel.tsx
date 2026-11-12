import {useState} from 'react';
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
    const symbol = conversationSymbol(market, selectedGroup?.id ?? 'all');
    return <StockDiscussionPanel key={`${market}:${selectedGroup?.id ?? 'all'}`} market={market} directory={directory}
        stock={{symbol, name}} groups={selectedGroups}
        groupPicker={<section className="stock-discussion-references">
            <CustomSelect value={selectedGroup?.id ?? ''} ariaLabel={t('stockAnalysis.discussion.selectGroup')}
                options={[{value: '', label: t('stockAnalysis.groups.all')}, ...groups.map(group => ({value: group.id, label: group.name}))]}
                onChange={setSelectedId} portal/>
        </section>}/>;
}
