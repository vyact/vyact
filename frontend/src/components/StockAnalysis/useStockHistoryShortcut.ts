import useStockAnalysisShortcut from './useStockAnalysisShortcut';

export default function useStockHistoryShortcut(onOpen: () => void, disabled: boolean, historyOpen = false) {
    useStockAnalysisShortcut('H', onOpen, disabled, historyOpen ? '.stock-chat-history-overlay' : undefined);
}
