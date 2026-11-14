import {useTranslation} from 'react-i18next';
import useVyvowTokenStatus from '../../hooks/useVyvowTokenStatus';
import type {StockMarket} from '../../services/stockAnalysis';
import './StockExternalLinks.css';

const KOREAN_STOCK_CODE = /^[0-9][A-Z0-9]{5}$/;
const STOCK_LINKS = [
    {key: 'naver', letter: 'N', url: 'https://finance.naver.com/item/board.naver?code='},
    {key: 'toss', letter: 'T', url: 'https://www.tossinvest.com/stocks/'},
    {key: 'dart', letter: 'D', url: 'https://dart.fss.or.kr/html/search/SearchCompany_M2.html?textCrpNM='},
] as const;

export default function StockExternalLinks({market, symbol}: {market: StockMarket; symbol: string}) {
    const {t} = useTranslation('main');
    const eligible = market === 'KR' && KOREAN_STOCK_CODE.test(symbol);
    const hasToken = useVyvowTokenStatus(eligible);
    if (!hasToken) return null;
    return <span className="stock-external-links">
        {STOCK_LINKS.map(link => <a key={link.key} className={`stock-external-link stock-external-link-${link.key}`}
            href={`${link.url}${encodeURIComponent(symbol)}`} target="_blank" rel="noopener noreferrer"
            aria-label={t(`stockAnalysis.externalLinks.${link.key}`)}>
            {link.letter}
        </a>)}
    </span>;
}
