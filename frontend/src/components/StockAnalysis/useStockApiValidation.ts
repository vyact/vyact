import {isMarketIndexSymbol} from '../../utils/stockSymbols';
import {useEffect, useRef, useState} from 'react';
import {prepareStockApiSettings, stockApiDraftSignature, stockApiExamples, stockApiSettings,
    type StockApiKind, type StockApiSettings, type StockApiValidationResult} from '../../services/stockApiSettings';
import type {StockMarket} from '../../services/stockAnalysis';

type ValidationState = {signature: string; running: boolean; result?: StockApiValidationResult};

export default function useStockApiValidation(market: StockMarket, kind: StockApiKind, settings: StockApiSettings, body: string, language: string) {
    const [testOverrides, setTestOverrides] = useState<Record<string, string>>({});
    const example = stockApiExamples(market, kind, language);
    const testValues = {...example.values, ...testOverrides};
    if (kind === 'prices' && isMarketIndexSymbol(testValues.symbol.trim()) && testOverrides.period === undefined) testValues.period = 'max';
    const endpoint = settings.endpoints[kind];
    const selectedSettings = {...settings, endpoints: {[kind]: endpoint}};
    const signature = `${market}:${kind}:${JSON.stringify(testValues)}:${stockApiDraftSignature(selectedSettings, {[kind]: body})}`;
    const [state, setState] = useState<ValidationState>();
    const pending = useRef<{signature: string; controller: AbortController} | null>(null);
    useEffect(() => () => {
        if (pending.current?.signature === signature) pending.current.controller.abort();
    }, [signature]);

    const validate = async () => {
        pending.current?.controller.abort();
        let prepared: StockApiSettings;
        try {
            if (Object.keys(example.body).some(key => !testValues[key]?.trim())) throw new Error('invalid');
            prepared = prepareStockApiSettings(selectedSettings, {[kind]: body});
        }
        catch {
            setState({signature, running: false, result: {ok: false, code: 'invalid_config', status: null, fields: []}});
            return;
        }
        const controller = new AbortController();
        pending.current = {signature, controller};
        setState({signature, running: true});
        try {
            const result = await stockApiSettings.validate(market, kind, prepared, (kind === 'sparkline' ? testValues.symbols : testValues.symbol).trim(), testValues.language.trim(), controller.signal,
                kind === 'prices' || kind === 'sparkline' ? {period: testValues.period.trim(), interval: testValues.interval.trim()} : undefined);
            if (!controller.signal.aborted) setState({signature, running: false, result});
        } catch {
            if (!controller.signal.aborted) setState({signature, running: false,
                result: {ok: false, code: 'request_failed', status: null, fields: []}});
        }
    };
    return {validate, testValues, setTestValue: (key: string, value: string) => setTestOverrides(previous => ({...previous, [key]: value})), validating: state?.signature === signature && state.running,
        result: state?.signature === signature ? state.result : undefined};
}
