import type {StockInvestorGroup} from '../../services/stockAnalysis';
import {HISTORY_PERIODS, INVESTOR_GROUPS} from './historyData';

type HistoryPreferences = {period: number; investors: StockInvestorGroup[] | 'all'};
const STORAGE_KEY = 'vyact:stock-history:preferences';
let sessionPreferences: HistoryPreferences = {period: 20, investors: 'all'};

export function readHistoryPreferences(): HistoryPreferences {
    try {
        const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
        return {
            period: HISTORY_PERIODS.some(value => value === saved.period) ? saved.period : sessionPreferences.period,
            investors: saved.investors === 'all' ? 'all' : Array.isArray(saved.investors)
                ? INVESTOR_GROUPS.filter(group => saved.investors.includes(group))
                : saved.investor === 'all' ? 'all' : INVESTOR_GROUPS.includes(saved.investor)
                    ? [saved.investor] : sessionPreferences.investors,
        };
    } catch {return sessionPreferences;}
}

export function saveHistoryPreferences(preferences: HistoryPreferences): void {
    sessionPreferences = preferences;
    try {localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));} catch { /* Keep session preferences. */ }
}
