import {assertOk} from '../utils/apiError';

export interface StockNewsArticle {title: string; url: string; publisher: string; publishedAt: string | null; summary: string}

export async function getStockNews(symbol: string, signal: AbortSignal): Promise<StockNewsArticle[]> {
    const response = await fetch(`/api/stock-analysis/news/${encodeURIComponent(symbol)}`, {signal});
    await assertOk(response);
    return response.json();
}
