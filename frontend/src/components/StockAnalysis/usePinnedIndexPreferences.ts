import {normalizePinnedIndices, PINNED_INDICES_KEY} from './pinnedIndexPreferences';
import useCachedStockPreferences from './useCachedStockPreferences';

export default function usePinnedIndexPreferences() {
    return useCachedStockPreferences('pinned-indices', PINNED_INDICES_KEY, normalizePinnedIndices);
}
