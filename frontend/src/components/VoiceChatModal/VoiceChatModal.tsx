import React, {useCallback, useState} from 'react';
import {MessageCircle, Mic, NotebookPen, X} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import {ModalTab, VoiceChatModalProps} from './voiceChat.types';
import VoiceChatTab from './VoiceChatTab';
import ScriptPracticeTab from './ScriptPracticeTab';
import ModalOverlay from '../common/ModalOverlay/ModalOverlay';
import './VoiceChatModal.css';

const VoiceChatModal: React.FC<VoiceChatModalProps> = ({isOpen, onClose, onSend}) => {
    const {t} = useTranslation('main');
    const [tab, setTab] = useState<ModalTab>('chat');

    const handleClose = useCallback(() => {
        window.speechSynthesis.cancel();
        window.dispatchEvent(new CustomEvent('voiceTabChange'));
        onClose();
    }, [onClose]);

    const handleTabChange = (newTab: ModalTab) => {
        // 탭 전환 시 진행 중인 음성/스크립트 모두 중단
        window.speechSynthesis.cancel();
        window.dispatchEvent(new CustomEvent('voiceTabChange'));
        setTab(newTab);
    };

    if (!isOpen) return null;
    return (
        <ModalOverlay className="vc-overlay" onClose={handleClose}>
            <div className="vc-modal" onClick={e => e.stopPropagation()}>
                <div className="vc-header">
                    <div className="vc-header-title">
                        <Mic size={20} aria-hidden/>
                        {t('voiceChat.title')}
                    </div>
                    <button className="vc-close-btn" onClick={handleClose}><X size={20} aria-hidden/></button>
                </div>
                <div className="vc-tabs">
                    <button className={`vc-tab${tab === 'chat' ? ' active' : ''}`}
                            onClick={() => handleTabChange('chat')}><MessageCircle size={18} aria-hidden/> {t('voiceChat.conversation')}
                    </button>
                    <button className={`vc-tab${tab === 'script' ? ' active' : ''}`}
                            onClick={() => handleTabChange('script')}><NotebookPen size={18} aria-hidden/> {t('voiceChat.scriptPractice')}
                    </button>
                </div>
                {tab === 'chat'
                    ? <VoiceChatTab onSend={onSend} onClose={handleClose}/>
                    : <ScriptPracticeTab/>
                }
            </div>
        </ModalOverlay>
    );
};

export default VoiceChatModal;
