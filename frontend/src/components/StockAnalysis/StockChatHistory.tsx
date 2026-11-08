import {useEffect, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {Plus} from 'lucide-react';
import ModalOverlay from '../common/ModalOverlay/ModalOverlay';
import ModalCloseButton from '../common/ModalOverlay/ModalCloseButton';
import {assertOk} from '../../utils/apiError';
import type {Message} from '../../types';
import './StockChatHistory.css';

interface Conversation {id: string; title: string; updated_at: string; messages?: Message[]}
export default function StockChatHistory({symbol, onClose, onSelect, onNew}: {
    symbol: string; onClose: () => void; onSelect: (id: string, messages: Message[]) => void; onNew: () => void;
}) {
    const {t, i18n} = useTranslation('main');
    const tr = (key: string) => t(`stockAnalysis.discussion.${key}`);
    const [rows, setRows] = useState<Conversation[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);
    const [selecting, setSelecting] = useState(false);
    useEffect(() => {
        const controller = new AbortController();
        fetch(`/api/stock-analysis/conversations/${encodeURIComponent(symbol)}`, {signal: controller.signal})
            .then(async response => {await assertOk(response); return response.json();})
            .then(result => {if (!controller.signal.aborted) {setRows(result); setLoading(false);}})
            .catch(() => {if (!controller.signal.aborted) {setError(true); setLoading(false);}});
        return () => controller.abort();
    }, [symbol]);
    const select = async (id: string) => {
        setSelecting(true);
        setError(false);
        try {
            const response = await fetch(`/api/stock-analysis/conversations/${encodeURIComponent(symbol)}/${id}`);
            await assertOk(response);
            const data: Conversation = await response.json();
            onSelect(id, data.messages ?? []);
        } catch {setError(true); setSelecting(false);}
    };
    return <ModalOverlay onClose={selecting ? undefined : onClose} closeOnBackdrop captureEscape aria-labelledby="stock-chat-history-title">
        <section className="stock-chat-history">
            <header><h2 id="stock-chat-history-title">{tr('historyTitle')}</h2><ModalCloseButton onClick={onClose} disabled={selecting}/></header>
            <button type="button" className="modal-action-cancel stock-chat-history-new" disabled={selecting} onClick={onNew}><Plus size={15}/>{tr('newConversation')}</button>
            {loading && <p role="status">{t('stockAnalysis.loading')}</p>}
            {error && <p role="alert">{tr('historyError')}</p>}
            {!loading && !error && !rows.length && <p>{tr('historyEmpty')}</p>}
            <ul>{rows.map(row => <li key={row.id}><button type="button" disabled={selecting} onClick={() => void select(row.id)}>
                <span>{row.title}</span><time dateTime={row.updated_at}>{new Intl.DateTimeFormat(i18n.resolvedLanguage ?? i18n.language, {month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'}).format(new Date(row.updated_at))}</time>
            </button></li>)}</ul>
        </section>
    </ModalOverlay>;
}
