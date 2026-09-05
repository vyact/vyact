import {useTranslation} from 'react-i18next';
import type {VyactHardwareInfo} from '../../../services/api';
import {formatModelBytes} from '../../../utils/vyactModelDisplay';
import {Tooltip} from '../Tooltip/Tooltip';
import './ModelMemoryCapacity.css';

function MetalMemoryHelp({hasRecommendation}: {hasRecommendation: boolean}) {
    const {t} = useTranslation('main');
    return <div className="vyact-metal-help">
        <p>{t('modelSelector.metalRecommendedMemoryHelp')}</p>
        <div>
            <p>{t('modelSelector.memoryColorGuide')}</p>
            <ul className="vyact-memory-legend">
                {(['comfortable', 'tight', 'over'] as const).map(tone => <li key={tone}>
                    <span className={`vyact-memory-legend-dot vyact-memory-legend-dot--${tone}`} aria-hidden="true"/>
                    <span>{t(`modelSelector.memoryColor_${tone}`)}</span>
                </li>)}
            </ul>
        </div>
        <p>{t('modelSelector.memoryColorCaution')}</p>
        {!hasRecommendation && <p>{t('modelSelector.memoryColorFallback')}</p>}
    </div>;
}

export default function ModelMemoryCapacity({hardware}: {hardware: VyactHardwareInfo}) {
    const {t} = useTranslation('main');
    const isMac = hardware.platform === 'darwin';
    const metalBytes = hardware.metal_recommended_working_set_bytes;
    return <div className={`vyact-memory-capacity${isMac ? ' vyact-memory-capacity--mac' : ''}`}>
        <span className="vyact-system-memory">
            <small>{t(hardware.memory_mode === 'unified' ? 'modelSelector.unifiedMemory' : 'modelSelector.systemMemory')}</small>
            <strong>{formatModelBytes(hardware.system_memory.total_bytes)}</strong>
        </span>
        {isMac && <span className="vyact-metal-memory">
            <small>{t('modelSelector.metalRecommendedMemory')}
                <Tooltip content={<MetalMemoryHelp hasRecommendation={Boolean(metalBytes && metalBytes > 0)}/>} multiline size="medium">
                    <i className="vyact-memory-help" tabIndex={0} aria-label={t('modelSelector.metalRecommendedMemory')}>?</i>
                </Tooltip>
            </small>
            <strong>{metalBytes && metalBytes > 0 ? formatModelBytes(metalBytes) : t('modelSelector.memoryUnavailable')}</strong>
            <span>{t('modelSelector.metalRecommendationNote')}</span>
        </span>}
        {hardware.memory_mode !== 'unified' && hardware.gpus.map(gpu => <span className="vyact-gpu-memory" key={`${gpu.backend}-${gpu.index}-${gpu.name}`}>
            <small>{t('modelSettings.gpuIndex', {index: gpu.index + 1})} · {gpu.backend}</small>
            <span title={gpu.name}>{gpu.name}</span>
            {gpu.total_bytes
                ? <strong className="vyact-gpu-vram"><small>{t('modelSelector.vram')}</small>{formatModelBytes(gpu.total_bytes)}</strong>
                : <em>{t('modelSelector.sharedOrUnknownMemory')}</em>}
        </span>)}
        {hardware.memory_mode !== 'unified' && hardware.gpus.length === 0 && !isMac && <span>{t('modelSelector.cpuExecution')}</span>}
    </div>;
}

export function MaxContextHelp() {
    const {t} = useTranslation('main');
    const explanation = t('modelSelector.maxContextHelp');
    return <Tooltip content={explanation} multiline size="medium">
        <i className="vyact-memory-help" tabIndex={0} aria-label={explanation}>?</i>
    </Tooltip>;
}
