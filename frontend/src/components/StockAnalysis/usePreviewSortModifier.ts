import {useCallback, useEffect, useState} from 'react';
import {previewSortModifier} from './sectorPreviewSort';

export default function usePreviewSortModifier() {
    const [sortByChange, setSortByChange] = useState(false);
    const platform = typeof navigator === 'undefined' ? '' : navigator.platform;
    const trackSortModifier = useCallback((event: {metaKey: boolean; ctrlKey: boolean}) => {
        setSortByChange(previewSortModifier(event, platform));
    }, [platform]);
    useEffect(() => {
        const reset = () => setSortByChange(false);
        const visibility = () => {if (document.hidden) reset();};
        window.addEventListener('keydown', trackSortModifier);
        window.addEventListener('keyup', trackSortModifier);
        window.addEventListener('blur', reset);
        document.addEventListener('visibilitychange', visibility);
        return () => {
            window.removeEventListener('keydown', trackSortModifier);
            window.removeEventListener('keyup', trackSortModifier);
            window.removeEventListener('blur', reset);
            document.removeEventListener('visibilitychange', visibility);
        };
    }, [trackSortModifier]);
    return {sortByChange, trackSortModifier};
}
