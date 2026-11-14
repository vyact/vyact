import {useState} from 'react';
import {sampleGroupStocks, GROUP_SAMPLE_SIZES, DEFAULT_GROUP_SAMPLE_SIZE} from './groupSampling';
import {ChevronDown} from 'lucide-react';
import './StockGroupDiscussionPanel.css';
import {useTranslation} from 'react-i18next';
import CustomSelect from '../CustomSelect/CustomSelect';
import StockDiscussionPanel from './StockDiscussionPanel';
import type {StockGroup} from './useStockGroups';
import type {StockMarket, StockSymbol} from '../../services/stockAnalysis';

export default function StockGroupDiscussionPanel({groups, market, directory, scopeType = 'group', weights}: {
    weights?: Record<string, number>; scopeType?: 'group' | 'sector'; groups: StockGroup[]; market: StockMarket; directory: StockSymbol[];
}) {
    const {t} = useTranslation('main');
    const [selectedIds, setSelectedIds] = useState<string[]>([]);
    const sampleKey = `vyact:stock-analysis:${scopeType}-sample:${market}`;
    const [sampleSize, setSampleSize] = useState(() => {
        try {
            const saved = Number(localStorage.getItem(sampleKey));
            return GROUP_SAMPLE_SIZES.some(size => size === saved) ? saved : DEFAULT_GROUP_SAMPLE_SIZE;
        } catch { return DEFAULT_GROUP_SAMPLE_SIZE; }
    });
    const selectedGroups = groups.filter(group => selectedIds.includes(group.id));
    const allSelected = selectedGroups.length === 0;
    const scopeGroups = allSelected ? groups : selectedGroups;
    const sampling = allSelected && weights !== undefined;
    const contextGroups = sampling ? sampleGroupStocks(scopeGroups, weights, sampleSize) : scopeGroups;
    const groupCountLabel = (count: number) => t('stockAnalysis.groups.groupCount', {count});
    const allCountLabel = `${groupCountLabel(groups.length)} · ${t('stockAnalysis.groups.stocks', {count: new Set(groups.flatMap(group => group.symbols)).size})}`;
    const name = allSelected ? t('stockAnalysis.groups.all') : selectedGroups.map(group => group.name).join(', ');
    const toggleGroup = (id: string) => setSelectedIds(current => {
        if (!id) return [];
        if (!current.includes(id)) return [...current, id];
        return current.length > 1 ? current.filter(value => value !== id) : current;
    });
    const countLabel = (symbols: string[]) => t('stockAnalysis.groups.stocks', {count: new Set(symbols).size});
    const options = [{value: '', label: t('stockAnalysis.groups.all'), description: allCountLabel},
        ...groups.map(group => ({value: group.id, label: group.name, description: countLabel(group.symbols)}))];
    const scopeCount = allSelected ? allCountLabel : countLabel(scopeGroups.flatMap(group => group.symbols));
    const renderLabel = (label: string, count: string) => <span className="stock-group-select-label">
        <span className="stock-group-select-name">{label}</span><span className="stock-group-select-count">{count}</span>
    </span>;
    const symbol = `MARKET-${market}`;
    return <StockDiscussionPanel market={market} directory={directory}
        stock={{symbol, name}} groups={contextGroups} scopeType={scopeType}
        groupPicker={<section className="stock-discussion-references">
            <CustomSelect dropdownClassName="stock-group-select-dropdown" value="" selectedValues={allSelected ? [''] : selectedGroups.map(group => group.id)} closeOnSelect={false} ariaLabel={t(`stockAnalysis.discussion.${scopeType === 'sector' ? 'selectSector' : 'selectGroup'}`)}
                searchable options={options}
                renderTrigger={(_label, open) => <>{renderLabel(name, scopeCount)}
                    <ChevronDown size={14} className={`stock-group-select-chevron${open ? ' is-open' : ''}`} aria-hidden="true"/></>}
                renderOption={option => renderLabel(option.label, option.description ?? '')}
                onChange={toggleGroup} portal/>
            {sampling && <div className="stock-group-sampling">
                <div className="stock-group-sampling-label">
                    <span>{t(`stockAnalysis.groups.${scopeType === 'sector' ? 'topPerSector' : 'topPerGroup'}`)}</span></div>
                    <CustomSelect value={String(sampleSize)} ariaLabel={t(`stockAnalysis.groups.${scopeType === 'sector' ? 'topPerSector' : 'topPerGroup'}`)}
                        options={GROUP_SAMPLE_SIZES.map(count => ({value: String(count), label: t('stockAnalysis.groups.stocks', {count})}))}
                        onChange={value => {
                            const next = Number(value);
                            setSampleSize(next);
                            try { localStorage.setItem(sampleKey, String(next)); } catch { /* Optional preference. */ }
                        }}/>
            </div>}
        </section>}/>;
}
