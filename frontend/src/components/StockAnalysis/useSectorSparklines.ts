import {useEffect, useSyncExternalStore} from 'react';
import {preloadSectorSparklines, readSectorSparklines, subscribeSectorSparklines} from '../../services/stockSparklineCache';

export function usePrefetchSectorSparklines(symbols: string[], day: string) {
    const symbolsKey = symbols.join(',');
    useEffect(() => {preloadSectorSparklines(symbolsKey.split(',').filter(Boolean), day);}, [symbolsKey, day]);
}

export default function useSectorSparklines(symbols: string[], day: string) {
    const symbolsKey = symbols.join(',');
    const histories = useSyncExternalStore(subscribeSectorSparklines, () => readSectorSparklines(day), () => readSectorSparklines(day));
    useEffect(() => {preloadSectorSparklines(symbolsKey.split(',').filter(Boolean), day, true);}, [symbolsKey, day]);
    return histories;
}

