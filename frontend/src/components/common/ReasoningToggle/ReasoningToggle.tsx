import React from 'react';
import { useTranslation } from 'react-i18next';
import CustomSelect from '../../CustomSelect/CustomSelect';
import {
    defaultReasoningValue,
    isReasoningActive,
    type ReasoningCapability,
    type ReasoningValue,
    useReasoning,
} from '../../../utils/reasoning';
import './ReasoningToggle.css';

interface ReasoningToggleProps {
    disabled?: boolean;
    capability: ReasoningCapability;
}

/**
 * 추론(gemma thinking) on/off 스위치.
 * 상태는 localStorage에 저장되며(ES 미사용), 웹앱과 크롬 확장이 각각 독립적으로 동작한다.
 * 좌측 물음표에 마우스를 올리면 켜면/끄면 좋은 경우를 한 번에 안내하는 툴팁이 표시된다.
 */
const ReasoningToggle: React.FC<ReasoningToggleProps> = ({disabled, capability}) => {
    const { t } = useTranslation('main');
    const [value, setValue] = useReasoning();
    const enabled = isReasoningActive(value);

    React.useEffect(() => {
        const valid = capability.control === 'toggle'
            ? value === 'off' || value === 'on'
            : capability.control === 'effort'
                ? (value === 'none' && capability.supports_none) || capability.efforts.includes(value as Exclude<ReasoningValue, 'off' | 'on' | 'none'>)
                : value === 'off';
        if (!valid) setValue(defaultReasoningValue(capability));
    }, [capability, setValue, value]);

    const handleToggle = () => {
        if (!disabled) setValue(enabled ? 'off' : 'on');
    };

    return (
        <div className={`reasoning-toggle${enabled ? ' on' : ''}${disabled ? ' disabled' : ''}`}>
            {/* 좌측 물음표 — hover 시 툴팁만 표시(토글 아님) */}
            <span className="reasoning-help" aria-label={t('reasoning.label')}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                     strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
                    <line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
                <span className="reasoning-tooltip" role="tooltip">
                    <span className="reasoning-tooltip-title">{t('reasoning.title')}</span>
                    <span className="reasoning-tooltip-intro">{t('reasoning.intro')}</span>
                    <span className="reasoning-tooltip-section">
                        <span className="reasoning-tooltip-label on">{t('reasoning.onLabel')}</span>
                        <ul className="reasoning-tooltip-list">
                            {(t('reasoning.onItems', {returnObjects: true}) as string[]).map((it, i) => <li key={i}>{it}</li>)}
                        </ul>
                    </span>
                    <span className="reasoning-tooltip-section">
                        <span className="reasoning-tooltip-label off">{t('reasoning.offLabel')}</span>
                        <ul className="reasoning-tooltip-list">
                            {(t('reasoning.offItems', {returnObjects: true}) as string[]).map((it, i) => <li key={i}>{it}</li>)}
                        </ul>
                    </span>
                </span>
            </span>

            {capability.control === 'effort' ? <div className="reasoning-effort-control">
                <span className="reasoning-toggle-label">{t('reasoning.label')}</span>
                <CustomSelect
                    portal
                    alignRight
                    disabled={disabled}
                    ariaLabel={t('reasoning.effortLabel')}
                    className="reasoning-effort-select"
                    value={value}
                    options={[
                        ...(capability.supports_none ? [{value: 'none', label: t('reasoning.efforts.none')}] : []),
                        ...capability.efforts.map(effort => ({value: effort, label: t(`reasoning.efforts.${effort}`)})),
                    ]}
                    onChange={nextValue => setValue(nextValue as ReasoningValue)}
                />
            </div> : <span
                className="reasoning-toggle-control"
                onClick={handleToggle}
                role="switch"
                aria-checked={enabled}
                aria-disabled={disabled}
                tabIndex={disabled ? -1 : 0}
                onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        handleToggle();
                    }
                }}
            >
                <span className="reasoning-toggle-label">{t('reasoning.label')}</span>
                <span className="reasoning-toggle-track">
                    <span className="reasoning-toggle-knob" />
                </span>
            </span>}
        </div>
    );
};

export default ReasoningToggle;
