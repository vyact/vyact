import {assertOk} from '../utils/apiError';
import type {StockMarket} from './stockAnalysis';

export interface FinancialCollectionStatus {
    settings: {autoUpdate: boolean};
    job: {status: 'idle' | 'running' | 'paused' | 'completed'; total: number; processed: number; failed: number; empty: number; currentSymbol?: string; completedAt?: string};
}
export async function financialCollectionRequest(market: StockMarket, action?: 'start' | 'pause' | 'resume' | 'retry', autoUpdate?: boolean, signal?: AbortSignal): Promise<FinancialCollectionStatus> {
    const settings = autoUpdate !== undefined;
    const response = await fetch(`/api/stock-analysis/financial-collection/${market}${settings ? '/settings' : action ? `/${action}` : ''}`, {
        method: settings ? 'PUT' : action ? 'POST' : 'GET', signal,
        ...(settings ? {headers: {'Content-Type': 'application/json'}, body: JSON.stringify({autoUpdate})} : {}),
    });
    await assertOk(response);
    return response.json();
}
