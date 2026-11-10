import type {StockMarket} from '../../services/stockAnalysis';
import './StockMarketFlag.css';

const MARKET_FLAGS: Record<StockMarket, string> = {US: '🇺🇸', KR: '🇰🇷', JP: '🇯🇵'};
export default function StockMarketFlag({market}: {market: StockMarket}) {
    return <span className="stock-market-flag" aria-hidden="true">{MARKET_FLAGS[market]}</span>;
}
