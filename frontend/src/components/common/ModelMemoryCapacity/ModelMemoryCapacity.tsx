import {useTranslation} from 'react-i18next';
import type {VyactHardwareInfo} from '../../../services/api';
import {formatModelBytes} from '../../../utils/vyactModelDisplay';
import OverflowTooltipText from '../OverflowTooltipText/OverflowTooltipText';
import {Tooltip} from '../Tooltip/Tooltip';
import './ModelMemoryCapacity.css';

function MetalMemoryHelp() {
    const {t} = useTranslation('main');
    return <div className="vyact-metal-help">
        <p>{t('modelSelector.metalRecommendedMemoryHelp')}</p>

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
                <Tooltip content={<MetalMemoryHelp/>} multiline size="medium">
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

function ModelMetadataHelp({helpKey}: {helpKey: 'maxContextHelp' | 'layersHelp'}) {
    const {t} = useTranslation('main');
    const explanation = t(`modelSelector.${helpKey}`);
    return <Tooltip content={explanation} multiline size="medium">
        <i className="vyact-memory-help" tabIndex={0} aria-label={explanation}>?</i>
    </Tooltip>;
}

export function ModelArchitectureDetail({architecture}: {architecture?: string}) {
    const {t} = useTranslation('main');
    const value = architecture?.trim();
    const displayValue = value && !['GGUF', 'MLX'].includes(value.toUpperCase())
        ? value : t('modelSelector.metadataUnavailable');
    return <span>
        <small>{t('modelSelector.architecture')}</small>
        <OverflowTooltipText text={displayValue}/>
    </span>;
}

export function MaxContextHelp() {
    return <ModelMetadataHelp helpKey="maxContextHelp"/>;
}

export function LayersHelp() {
    return <ModelMetadataHelp helpKey="layersHelp"/>;
}
