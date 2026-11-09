import {useTranslation} from 'react-i18next';
import {CheckCircle2, ChevronDown, LoaderCircle, ShieldCheck, TriangleAlert} from 'lucide-react';
import CustomSelect from '../CustomSelect/CustomSelect';
import {stockApiExamples, type StockApiEndpoint, type StockApiKind, type StockApiSettings} from '../../services/stockApiSettings';
import type {StockMarket} from '../../services/stockAnalysis';
import useStockApiValidation from './useStockApiValidation';
import {INVESTOR_GROUPS} from './historyData';

const PRICE_RESPONSE_FIELDS = ['day', 'open', 'high', 'low', 'close', 'volume', 'tradingValue', 'changePercent', 'investors', 'buyVolume', 'buyAmount', 'sellVolume', 'sellAmount', 'netVolume', 'netAmount'] as const;

const RESPONSE_FIELDS: Record<StockApiKind, {field: string; label: string}[]> = {
    prices: PRICE_RESPONSE_FIELDS.map(field => ({field, label: field})),
    quotes: ['symbol', 'date', 'price', 'changePercent', 'marketCap'].map(field => ({field: field === 'changePercent' ? 'change' : field, label: field})),
    symbols: ['symbol', 'name', 'preferred', 'exchange'].map(field => ({field, label: field})),
    sparkline: [{field: '{symbol}', label: 'sparklineValues'}],
    marketIndices: ['symbol', 'price', 'change', 'changePercent', 'date', 'closes'].map(field => ({field, label: field})),
    sectorMap: [
        {field: 'date', label: 'date'}, {field: 'quoteDate', label: 'quoteDate'}, {field: 'sectors', label: 'sectors'},
        {field: 'sectors[].name', label: 'sectorName'}, {field: 'sectors[].weight', label: 'sectorWeight'},
        {field: 'sectors[].change', label: 'changePercent'}, {field: 'sectors[].stocks', label: 'stocks'},
        ...['symbol', 'name', 'preferred', 'exchange', 'price'].map(field => ({field: `sectors[].stocks[].${field}`, label: field})),
        {field: 'sectors[].stocks[].weight', label: 'stockWeight'}, {field: 'sectors[].stocks[].change', label: 'changePercent'},
    ],
};

const VALIDATION_FAILURE_CODES = new Set(['url_required', 'timeout', 'http_error', 'connection_error', 'invalid_json', 'invalid_schema', 'invalid_dates', 'invalid_config', 'request_failed']);

export default function StockApiEndpointSettings({market, kind, endpoint, body, settings, expanded, disabled, onToggle, onChange, onBodyChange}: {
    market: StockMarket; kind: StockApiKind; endpoint?: StockApiEndpoint; body: string; settings: StockApiSettings;
    expanded: boolean; disabled: boolean; onToggle: () => void;
    onChange: (patch: Partial<StockApiEndpoint>) => void; onBodyChange: (value: string) => void;
}) {
    const {t, i18n} = useTranslation('main');
    const tr = (key: string) => t(`stockAnalysis.api.${key}`);
    const examples = stockApiExamples(market, kind, i18n.resolvedLanguage ?? i18n.language);
    const {validate, validating, result, testValues, setTestValue} = useStockApiValidation(market, kind, settings, body, i18n.resolvedLanguage ?? i18n.language);
    const errorKey = result && VALIDATION_FAILURE_CODES.has(result.code) ? result.code : 'request_failed';
    const tokens = Object.keys(examples.body);
    const requestExampleBody = Object.fromEntries(tokens.map(token => [token, testValues[token].trim()]));
    const postExampleBody = {...requestExampleBody, ...((kind === 'sparkline' || kind === 'quotes') ? {symbols: testValues.symbols.split(',').map(value => value.trim())} : {})};
    const requestExampleUrl = `${examples.url}?${new URLSearchParams(requestExampleBody).toString()}`;
    const id = `stock-api-${market}-${kind}`;
    const configured = Boolean(endpoint?.url.trim());
    return <section className={`stock-api-endpoint${expanded ? ' is-expanded' : ''}`}>
        <button type="button" className="stock-api-endpoint-toggle" aria-expanded={expanded} aria-controls={id} onClick={onToggle}>
            <span className="stock-api-endpoint-title"><strong>{tr(kind)}</strong>{configured && <span>{endpoint?.url}</span>}</span>
            <span className="stock-api-source-badge" data-custom={configured}>{configured ? endpoint?.method ?? 'GET' : tr('builtInBadge')}</span>
            <ChevronDown size={17} aria-hidden="true"/>
        </button>
        <div className="stock-api-endpoint-content" id={id} hidden={!expanded}>
            <div className="stock-api-endpoint-fields">
                <div className="stock-api-url-field">
                    <label htmlFor={`${id}-url`}>{tr('url')}</label>
                    <div className="stock-api-url-input-row"><input id={`${id}-url`} type="url" value={endpoint?.url ?? ''} placeholder={examples.url} onChange={event => onChange({url: event.target.value})}/>
                        <button type="button" className="modal-action-cancel stock-api-validate-button" disabled={disabled || !configured || validating}
                            aria-label={t('stockAnalysis.api.validateEndpoint', {name: tr(kind)})} onClick={() => void validate()}>
                            {validating ? <LoaderCircle size={15} className="stock-api-validation-spinner" aria-hidden="true"/> : <ShieldCheck size={15} aria-hidden="true"/>}{tr(validating ? 'validating' : 'validate')}
                        </button>
                    </div>
                </div>
                <label>{tr('method')}<CustomSelect value={endpoint?.method ?? 'GET'} disabled={disabled} ariaLabel={`${tr(kind)} · ${tr('method')}`} portal
                    options={[{value: 'GET', label: 'GET'}, {value: 'POST', label: 'POST'}]}
                    onChange={value => onChange({method: value as 'GET' | 'POST'})}/></label>
            </div>
            {result && <div className="stock-api-validation-result" data-state={result.ok ? result.code === 'empty' ? 'empty' : 'valid' : 'error'} role={result.ok ? 'status' : 'alert'}>
                {result.ok && result.code !== 'empty' ? <CheckCircle2 size={16} aria-hidden="true"/> : <TriangleAlert size={16} aria-hidden="true"/>}
                <div><strong>{result.ok ? result.code === 'empty' ? tr('validationEmpty') : t('stockAnalysis.api.validationSuccess', {count: result.count, status: result.status}) : tr(`validation_${errorKey}`)}</strong>
                    {!result.ok && result.status !== null && <span>{t('stockAnalysis.api.validationHttp', {status: result.status})}</span>}
                    {!!result.fields.length && <span>{t('stockAnalysis.api.validationFields', {fields: result.fields.join(', ')})}</span>}
                    {(kind === 'prices' || kind === 'sparkline' || kind === 'quotes') && <span>{t('stockAnalysis.api.validationSample', {symbol: kind === 'sparkline' || kind === 'quotes' ? testValues.symbols : testValues.symbol})}</span>}
                </div>
            </div>}
            {endpoint?.method === 'POST' && <label>{tr('body')}<textarea spellCheck={false} rows={5} value={body} onChange={event => onBodyChange(event.target.value)}/></label>}
            <div className="stock-api-variables">
                <p className="stock-api-variables-hint">{tr('testValuesHint')}</p>
                <table><thead><tr><th scope="col">{tr('variable')}</th><th scope="col">{tr('meaning')}</th><th scope="col">{tr('exampleValue')}</th><th scope="col">{tr('testValue')}</th></tr></thead>
                    <tbody>{tokens.map(token => <tr key={token}><th scope="row"><code>{token}</code></th>
                        <td>{tr(token === 'period' ? kind === 'sparkline' ? 'periodSparkline' : 'periodPrices' : `variable_${token}`)}</td>
                        <td><code>{examples.values[token]}</code></td>
                        <td className="stock-api-test-value"><input className="stock-api-test-input" aria-label={t('stockAnalysis.api.testParameter', {parameter: token})}
                            value={testValues[token]} readOnly={token === 'market'} spellCheck={false} autoComplete="off"
                            onChange={event => setTestValue(token, token === 'symbol' || token === 'symbols' ? event.target.value.replace(/^\^/, '') : event.target.value)}/></td>
                    </tr>)}</tbody>
                </table>
                {(tokens.includes('symbol') || tokens.includes('symbols')) && <p className="stock-api-index-code-help">{tr('indexCodeLabel')} · {market === 'KR'
                    ? <><code>KS11</code> = {t('stockAnalysis.indexKospi')} · <code>KQ11</code> = {t('stockAnalysis.indexKosdaq')}</>
                    : market === 'JP' ? <><code>N225</code> = {t('stockAnalysis.indexNikkei225')}</>
                    : <><code>GSPC</code> = {t('stockAnalysis.indexSp500')} · <code>IXIC</code> = {t('stockAnalysis.indexNasdaq')}</>}</p>}
            </div>
            <details className="stock-api-examples"><summary>{tr('examples')}</summary>
                <p>{tr('requestExample')}</p><pre>{`GET ${requestExampleUrl}\n\nPOST ${examples.url.split('?')[0]}\nContent-Type: application/json\n\n${JSON.stringify(postExampleBody, null, 2)}`}</pre>
                <p>{tr('responseExample')}</p><pre>{JSON.stringify(examples.response, null, 2)}</pre>
                <table className="stock-api-response-fields">
                    <thead><tr><th scope="col">{tr('variable')}</th><th scope="col">{tr('meaning')}</th></tr></thead>
                    <tbody>{RESPONSE_FIELDS[kind].map(({field, label}) => <tr key={field}>
                        <th scope="row"><code>{field}</code></th><td>{tr(`responseFields.${label}`)}</td>
                    </tr>)}{kind === 'prices' && INVESTOR_GROUPS.map(group => <tr key={group}>
                        <th scope="row"><code>{`investors.${group}`}</code></th><td>{t(`stockAnalysis.history.groups.${group}`)}</td>
                    </tr>)}</tbody>
                </table>
                {market === 'KR' && (kind === 'symbols' || kind === 'sectorMap') && <p>{tr('koreanSymbols')}</p>}
            </details>
        </div>
    </section>;
}
