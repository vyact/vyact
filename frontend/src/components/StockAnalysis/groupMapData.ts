import type {MarketSector, StockQuote, StockSymbol} from '../../services/stockAnalysis';
import type {StockGroup} from './useStockGroups';

export function buildGroupSectors(groups: StockGroup[], quotes: StockQuote[], directory: StockSymbol[]): MarketSector[] {
    const names = new Map(directory.map(item => [item.symbol, item.name]));
    const bySymbol = new Map(quotes.filter(quote => Number.isFinite(quote.marketCap) && quote.marketCap > 0).map(quote => [quote.symbol, quote]));
    return groups.flatMap(group => {
        const stocks = group.symbols.flatMap(symbol => {
            const quote = bySymbol.get(symbol);
            return quote ? [{symbol, name: names.get(symbol) ?? symbol, weight: quote.marketCap, price: quote.price, change: quote.change}] : [];
        });
        const weight = stocks.reduce((sum, stock) => sum + stock.weight, 0);
        return weight ? [{name: group.name, weight, stocks, change: stocks.reduce((sum, stock) => sum + stock.weight * stock.change, 0) / weight}] : [];
    });
}
