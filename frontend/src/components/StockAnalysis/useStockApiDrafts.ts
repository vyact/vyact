import {useEffect, useState} from 'react';
import {prepareStockApiSettings, stockApiDraftSignature, STOCK_API_KINDS, STOCK_API_MARKETS, stockApiSettings, type StockApiKind, type StockApiSettings} from '../../services/stockApiSettings';
import type {StockMarket} from '../../services/stockAnalysis';

export type StockApiDraft = {
    settings: StockApiSettings;
    bodies: Partial<Record<StockApiKind, string>>;
    dirty: boolean;
    savedSignature: string;
};

function createDraft(settings: StockApiSettings): StockApiDraft {
    const bodies = Object.fromEntries(STOCK_API_KINDS.map(kind => [kind, JSON.stringify(settings.endpoints[kind]?.body ?? {}, null, 2)]));
    return {settings, bodies, dirty: false, savedSignature: stockApiDraftSignature(settings, bodies)};
}

export default function useStockApiDrafts(onSaved: () => void) {
    const [drafts, setDrafts] = useState<Partial<Record<StockMarket, StockApiDraft>>>({});
    const [errors, setErrors] = useState<Partial<Record<StockMarket, string>>>({});
    const [saving, setSaving] = useState(false);
    const [retry, setRetry] = useState(0);
    useEffect(() => {
        const controller = new AbortController();
        void Promise.allSettled(STOCK_API_MARKETS.map(async market => {
            try {
                const settings = await stockApiSettings.load(market, controller.signal);
                if (!controller.signal.aborted) setDrafts(previous => previous[market] ? previous : {...previous, [market]: createDraft(settings)});
            } catch {if (!controller.signal.aborted) setErrors(previous => ({...previous, [market]: 'loadError'}));}
        }));
        return () => controller.abort();
    }, [retry]);

    const updateDraft = (market: StockMarket, update: (draft: StockApiDraft) => StockApiDraft) => {
        setDrafts(previous => {
            const draft = previous[market];
            if (!draft) return previous;
            const updated = update(draft);
            return {...previous, [market]: {...updated, dirty: stockApiDraftSignature(updated.settings, updated.bodies) !== draft.savedSignature}};
        });
        setErrors(previous => ({...previous, [market]: undefined}));
    };
    const save = async (onInvalid: (market: StockMarket) => void) => {
        const pending: {market: StockMarket; settings: StockApiSettings}[] = [];
        for (const market of STOCK_API_MARKETS) {
            const draft = drafts[market];
            if (!draft?.dirty) continue;
            try {pending.push({market, settings: prepareStockApiSettings(draft.settings, draft.bodies)});}
            catch {
                setErrors(previous => ({...previous, [market]: 'invalid'}));
                onInvalid(market);
                return;
            }
        }
        setSaving(true);
        try {
            for (const {market, settings} of pending) {
                try {
                    const saved = await stockApiSettings.save(market, settings);
                    setDrafts(previous => ({...previous, [market]: createDraft(saved)}));
                } catch {
                    setErrors(previous => ({...previous, [market]: 'saveError'}));
                    onInvalid(market);
                    return;
                }
            }
            onSaved();
        } finally {setSaving(false);}
    };
    return {drafts, errors, saving, updateDraft, save, retryLoad: () => {setErrors({}); setRetry(value => value + 1);}};
}
