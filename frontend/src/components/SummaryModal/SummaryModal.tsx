import React, {useEffect, useState} from 'react';
import {FileText} from 'lucide-react';
import {api} from '../../services/api';
import ModalOverlay from '../common/ModalOverlay/ModalOverlay';
import './SummaryModal.css';

interface SummaryModalProps {
    convId: string;
    onClose: () => void;
}

interface AttachmentSummary {
    batch_id: string;
    attached_at: string;
    source_name: string;
    file_count: number;
    summary: string;
}

/**
 * 대화방 요약 모달.
 * - conv_summary: 지금까지 대화 흐름 요약 (매 턴 갱신)
 * - attachment_summaries: 첨부(zip/파일)별 요약 (첨부할 때마다 배열에 추가)
 *
 * ⚠ 두 값 모두 아직 생성 로직이 붙기 전에는 비어있게 나온다 (조회 UI 먼저 준비된 상태).
 */
const SummaryModal: React.FC<SummaryModalProps> = ({convId, onClose}) => {
    const [loading, setLoading] = useState(true);
    const [convSummary, setConvSummary] = useState('');
    const [attachments, setAttachments] = useState<AttachmentSummary[]>([]);
    const [error, setError] = useState('');

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const data = await api.getConversationSummary(convId);
                if (cancelled) return;
                setConvSummary(data.conv_summary || '');
                setAttachments(data.attachment_summaries || []);
            } catch {
                if (!cancelled) setError('요약을 불러오지 못했습니다.');
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [convId]);

    return (
        <ModalOverlay className="summary-modal-overlay" onClose={onClose} closeOnBackdrop>
            <div className="summary-modal" onClick={e => e.stopPropagation()}>
                <div className="summary-modal-header">
                    <span className="summary-modal-title">대화방 요약</span>
                    <button className="summary-modal-close" onClick={onClose}>✕</button>
                </div>

                <div className="summary-modal-body">
                    {loading && <div className="summary-modal-empty">불러오는 중...</div>}
                    {!loading && error && <div className="summary-modal-empty">{error}</div>}

                    {!loading && !error && (
                        <>
                            <div className="summary-section">
                                <div className="summary-section-label">대화 요약</div>
                                <div className="summary-section-content">
                                    {convSummary || '아직 요약이 없습니다.'}
                                </div>
                            </div>

                            <div className="summary-section">
                                <div className="summary-section-label">
                                    첨부파일 ({attachments.length})
                                </div>
                                {attachments.length === 0 ? (
                                    <div className="summary-section-content">첨부된 파일이 없습니다.</div>
                                ) : (
                                    <div className="summary-attachment-list">
                                        {attachments.map(a => (
                                            <div className="summary-attachment-item" key={a.batch_id}>
                                                <div className="summary-attachment-item-header">
                                                    <FileText size={13}/>
                                                    <span className="summary-attachment-name">{a.source_name}</span>
                                                    <span className="summary-attachment-count">{a.file_count}개</span>
                                                </div>
                                                <div className="summary-attachment-text">{a.summary}</div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </>
                    )}
                </div>
            </div>
        </ModalOverlay>
    );
};

export default SummaryModal;
