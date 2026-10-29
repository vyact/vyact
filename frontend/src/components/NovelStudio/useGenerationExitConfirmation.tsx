import {useState} from 'react';
import {useTranslation} from 'react-i18next';
import ConfirmModal from '../common/ConfirmModal/ConfirmModal';

/** Guard every exit path while a writing-workspace LLM request is active. */
export default function useGenerationExitConfirmation(busy: boolean, onExit: () => void | Promise<void>) {
    const {t} = useTranslation('main');
    const [confirming, setConfirming] = useState(false);
    const [leaving, setLeaving] = useState(false);
    const proceed = async () => {
        if (leaving) return;
        setLeaving(true);
        try {await onExit();}
        finally {setLeaving(false); setConfirming(false);}
    };
    const requestExit = () => {if (leaving) return; if (busy) setConfirming(true); else void proceed();};
    const confirmation = confirming ? <ConfirmModal actionLayout="horizontal" title={t('novelStudio.exitGeneration.title')} description={t('novelStudio.exitGeneration.description')} options={[{label: t('novelStudio.exitGeneration.stay'), value: 'stay'}, {label: t('novelStudio.exitGeneration.leave'), value: 'leave', variant: 'danger'}]} loading={leaving} loadingValue="leave" onClose={() => {if (!leaving) setConfirming(false);}} onSelect={value => {if (leaving) return; if (value === 'leave') void proceed(); else setConfirming(false);}}/> : null;
    return {requestExit, confirmation};
}
