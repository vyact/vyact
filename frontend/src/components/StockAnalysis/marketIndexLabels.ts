export const MARKET_INDEX_LABELS = {US: [
    {symbol: 'GSPC', key: 'indexSp500'},
    {symbol: 'IXIC', key: 'indexNasdaq'},
    {symbol: 'RUT', key: 'indexRussell2000'},
], TW: [{symbol: 'TWII', key: 'indexTaiex'}], HK: [{symbol: 'HSI', key: 'indexHangSeng'}], CN: [{symbol: '000001.SS', key: 'indexShanghai'}, {symbol: '399001.SZ', key: 'indexShenzhen'}], JP: [{symbol: 'N225', key: 'indexNikkei225'}], KR: [{symbol: 'KS11', key: 'indexKospi'}, {symbol: 'KQ11', key: 'indexKosdaq'}]} as const;

export const INDEX_FUTURE_LABELS: Record<string, string> = {
    'NIY=F': 'indexNikkei225Futures',
    'ES=F': 'indexSp500Futures',
    'NQ=F': 'indexNasdaq100Futures',
    'RTY=F': 'indexRussell2000Futures',
};

export const CASH_INDEX_CHART_LABELS: Record<string, string> = {
    N225: 'indexNikkei225',
    GSPC: 'indexSp500Chart',
    IXIC: 'indexNasdaqCompositeChart',
    RUT: 'indexRussell2000Chart',
};
