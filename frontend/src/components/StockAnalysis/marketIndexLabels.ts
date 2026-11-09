export const MARKET_INDEX_LABELS = {US: [
    {symbol: 'GSPC', key: 'indexSp500'},
    {symbol: 'IXIC', key: 'indexNasdaq'},
    {symbol: 'RUT', key: 'indexRussell2000'},
], KR: [{symbol: 'KS11', key: 'indexKospi'}, {symbol: 'KQ11', key: 'indexKosdaq'}]} as const;

export const US_INDEX_FUTURE_LABELS: Record<string, string> = {
    'ES=F': 'indexSp500Futures',
    'NQ=F': 'indexNasdaq100Futures',
    'RTY=F': 'indexRussell2000Futures',
};
