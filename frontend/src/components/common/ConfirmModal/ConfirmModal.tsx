import React from 'react';
import {LoaderCircle} from 'lucide-react';
import ModalOverlay from '../ModalOverlay/ModalOverlay';
import './ConfirmModal.css';

interface ConfirmModalOption {
    label: string;
    value: string;
    variant?: 'default' | 'primary' | 'danger';
}

interface ConfirmModalProps {
    title: string;
    description?: string;
    details?: string[];
    options: ConfirmModalOption[];
    onSelect: (value: string) => void;
    onClose: () => void;
    actionLayout?: 'vertical' | 'horizontal';
    loading?: boolean;
    loadingValue?: string;
    loadingLabel?: string;
    loadingProgress?: number;
}

/**
 * 공용 확인/선택 모달.
 * 삭제 확인처럼 단순 예/아니오 뿐 아니라, 여러 선택지 중 하나를 고르는 용도(예: zip 파일 개수 제한 확인)로도 사용.
 */
const ConfirmModal: React.FC<ConfirmModalProps> = ({
    title, description, details, options, onSelect, onClose, actionLayout = 'vertical',
    loading = false, loadingValue, loadingLabel, loadingProgress,
}) => {
    return (
        <ModalOverlay className="confirm-modal-overlay" onClose={loading ? () => undefined : onClose}
                      closeOnBackdrop={!loading}>
            <div className="confirm-modal" onClick={e => e.stopPropagation()}>
                <div className="confirm-modal-title">{title}</div>
                {description && <div className="confirm-modal-desc">{description}</div>}
                {!!details?.length && <ul className="confirm-modal-details">
                    {details.map(detail => <li key={detail}>{detail}</li>)}
                </ul>}
                {loading && loadingProgress !== undefined && <div className="confirm-modal-progress">
                    <div className="confirm-modal-progress-track">
                        <div className="confirm-modal-progress-value" style={{width: `${loadingProgress}%`}}/>
                    </div>
                </div>}
                <div className={`confirm-modal-actions ${actionLayout}`}>
                    {options.map(opt => {
                        const isLoadingOption = loading && opt.value === loadingValue;
                        return (
                        <button
                            key={opt.value}
                            className={`confirm-modal-btn${opt.variant === 'danger' ? ' danger' : opt.variant === 'primary' ? ' primary' : ''}`}
                            onClick={() => onSelect(opt.value)}
                            disabled={loading}
                        >
                            {isLoadingOption && <LoaderCircle className="confirm-modal-spinner"
                                                              aria-hidden="true" size={16}/>}
                            {isLoadingOption ? loadingLabel || opt.label : opt.label}
                        </button>
                        );
                    })}
                </div>
            </div>
        </ModalOverlay>
    );
};

export default ConfirmModal;
