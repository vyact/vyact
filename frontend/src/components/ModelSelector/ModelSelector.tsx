import React, {useEffect, useState} from 'react';
import {Pencil, Settings} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import CustomSelect from '../CustomSelect/CustomSelect';
import type {SelectOption} from '../CustomSelect/CustomSelect';
import {getRecommendedModelDisplay} from '../../utils/recommendedModels';
import './ModelSelector.css';

interface ModelSelectorProps {
    installed: string[];
    mtpSupported: string[];
    mtpActive: string | null;
    selectedModel: string;
    currentProvider: string;
    onModelChange: (model: string, needsDownload: boolean, modelType?: ModelType) => void;
    onProviderSettingsOpen: () => void;
}

interface RecommendedModel {
    id: string;
    name: string;
    desc: string;
    type: ModelType;
}

type ModelType = 'chat' | 'image_gen' | 'image_edit';

const ModelSelector: React.FC<ModelSelectorProps> = ({
                                                         installed,
                                                         mtpSupported,
                                                         mtpActive,
                                                         selectedModel,
                                                         currentProvider,
                                                         onModelChange,
                                                         onProviderSettingsOpen,
                                                     }) => {
    const {t} = useTranslation('main');
    const [recommendedModels, setRecommendedModels] = useState<RecommendedModel[]>([]);
    const [defaultModel, setDefaultModel] = useState<string>('');
    const [customModel, setCustomModel] = useState('');
    const [customModelType, setCustomModelType] = useState<ModelType>('chat');
    const [tooltipModel, setTooltipModel] = useState<string | null>(null);
    const [tooltipPos, setTooltipPos] = useState({x: 0, y: 0});

    useEffect(() => {
        fetch('/api/models/recommended')
            .then(res => res.json())
            .then(data => {
                setRecommendedModels(data.models);
                setDefaultModel(data.default || '');
            })
            .catch(err => console.error('Failed to load models:', err));
    }, []);

    const handleLocalModelSelect = (model: string, modelType?: ModelType) => {
        const needsDownload = !installed.includes(model);
        onModelChange(model, needsDownload, modelType);
    };

    const handleCustomSubmit = () => {
        if (!customModel.trim()) return;
        handleLocalModelSelect(customModel.trim(), customModelType);
        setCustomModel('');
    };

    // 추천 + 설치된 모델 합치기
    const recommendedIds = currentProvider === 'ollama' ? recommendedModels.map(m => m.id) : [];
    const allModelIds = Array.from(new Set([...recommendedIds, ...installed]));
    const options: SelectOption[] = allModelIds.map(id => {
        const info = recommendedModels.find(m => m.id === id);
        return {value: id, label: info ? getRecommendedModelDisplay(info, t).name : id};
    });

    // 트리거: dot + 모델명
    const renderTrigger = (_label: string, open: boolean) => {
        const isInstalled = installed.includes(selectedModel);
        const showMtp = currentProvider === 'vyact' && mtpActive === selectedModel;
        return (
            <>
                <div className={`mdot ${isInstalled ? 'installed' : 'not-installed'}`}/>
                {showMtp && <span className="mtp-model-badge">MTP</span>}
                <span className="mname">{selectedModel || t('modelSelector.selectModel')}</span>
                <span className={`custom-select-arrow${open ? ' open' : ''}`}>▼</span>
            </>
        );
    };

    // 옵션 아이템: dot/체크 + 모델명 + 추천뱃지 + 설치상태
    const renderOption = (opt: SelectOption, isSelected: boolean) => {
        const isInst = installed.includes(opt.value);
        const info = recommendedModels.find(m => m.id === opt.value);
        const displayModel = info ? getRecommendedModelDisplay(info, t) : null;
        const showMtp = currentProvider === 'vyact' && mtpSupported.includes(opt.value);

        return (
            <>
                {/* 좌측 선택/dot */}
                <div className="dd-left-icon">
                    {isSelected ? (
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
                             stroke="var(--accent)" strokeWidth="3">
                            <polyline points="20 6 9 17 4 12"/>
                        </svg>
                    ) : (
                        <div className={`mdot ${isInst ? 'installed' : 'not-installed'}`}/>
                    )}
                </div>

                {/* 모델명 + 툴팁 + 추천뱃지 */}
                <div className="dd-model-name">
                    {showMtp && <span className="mtp-model-badge">MTP</span>}
                    {displayModel?.desc && (
                        <span
                            className="model-info-icon-wrapper"
                            onMouseEnter={e => {
                                const rect = e.currentTarget.getBoundingClientRect();
                                setTooltipPos({x: rect.right, y: rect.top});
                                setTooltipModel(opt.value);
                            }}
                            onMouseLeave={() => setTooltipModel(null)}
                        >
                            <span className="model-info-icon">?</span>
                            {tooltipModel === opt.value && (
                                <span
                                    className="model-tooltip"
                                    style={{left: `${tooltipPos.x}px`, top: `${tooltipPos.y}px`}}
                                >
                                    <strong style={{
                                        display: 'block',
                                        marginBottom: '4px',
                                        color: '#fff',
                                        fontSize: '13px'
                                    }}>
                                        {displayModel.name}
                                    </strong>
                                    {displayModel.desc}
                                </span>
                            )}
                        </span>
                    )}
                    <span style={{overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}}>
                        {opt.label}
                    </span>
                    {opt.value === defaultModel && (
                        <span style={{
                            flexShrink: 0, fontSize: '9px', fontWeight: 600,
                            padding: '1px 5px', borderRadius: '10px',
                            background: 'rgba(99,102,241,0.2)',
                            border: '1px solid rgba(99,102,241,0.4)',
                            color: '#818cf8', letterSpacing: '0.3px',
                        }}>추천</span>
                    )}
                </div>

                {/* 우측 설치/다운로드 */}
                <div className="dd-right-status">
                    {isInst ? (
                        <span className="dd-icon-installed" title="설치됨">
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
                                 stroke="currentColor" strokeWidth="2.5">
                                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                                <polyline points="22 4 12 14.01 9 11.01"/>
                            </svg>
                        </span>
                    ) : (
                        <span className="dd-icon-download" title="다운로드 필요">
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
                                 stroke="currentColor" strokeWidth="2.5">
                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                                <polyline points="7 10 12 15 17 10"/>
                                <line x1="12" y1="15" x2="12" y2="3"/>
                            </svg>
                        </span>
                    )}
                </div>
            </>
        );
    };

    // 하단 커스텀 모델 입력
    const footer = currentProvider === 'ollama' ? (
            <div className="custom-model-input">
                <input
                type="text"
                placeholder={t('modelSelector.customPlaceholder')}
                value={customModel}
                onChange={e => setCustomModel(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleCustomSubmit()}
                    onClick={e => e.stopPropagation()}
                />
                <div className="custom-model-actions">
                    <div className="custom-model-type" role="group" aria-label={t('modelSelector.modelType')}>
                        <button
                            type="button"
                            className={customModelType === 'chat' ? 'active' : ''}
                            onClick={() => setCustomModelType('chat')}
                        >{t('modelSelector.chatType')}</button>
                        <button
                            type="button"
                            className={customModelType === 'image_gen' ? 'active' : ''}
                            onClick={() => setCustomModelType('image_gen')}
                            data-instant-tooltip={t('modelSelector.imageGenTooltip')}
                            data-instant-tooltip-multiline=""
                            data-instant-tooltip-large=""
                        >{t('modelSelector.imageType')}</button>
                    </div>
                    <button className="custom-model-add" onClick={handleCustomSubmit} disabled={!customModel.trim()}>
                        {t('modelSelector.add')}
                    </button>
                </div>
            </div>
    ) : undefined;

    if (currentProvider !== 'ollama' && currentProvider !== 'vyact') {
        return (
            <div className="model-select-wrap">
                <div className="cloud-config">
                    <div className="cloud-model-row">
                        <div className="cloud-model-display">
                            <span className="cloud-model-status" aria-hidden="true"/>
                            <span>{selectedModel || t('modelSelector.noModel')}</span>
                        </div>
                        <button className="cloud-model-settings" type="button" onClick={onProviderSettingsOpen} aria-label={t('modelSelector.settingsManage')}><Pencil size={16}/></button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <CustomSelect
            options={options}
            value={selectedModel}
            onChange={id => handleLocalModelSelect(id, recommendedModels.find(model => model.id === id)?.type)}
            searchable
            searchPlaceholder={t('modelSelector.modelSearch')}
            searchAction={currentProvider === 'vyact' ? (
                <button
                    type="button"
                    className="custom-select-search-action"
                    aria-label={t('modelSelector.settingsManage')}
                    onClick={onProviderSettingsOpen}
                >
                    <Settings size={15} aria-hidden="true"/>
                </button>
            ) : undefined}
            className="model-select-wrap"
            renderTrigger={renderTrigger}
            renderOption={renderOption}
            footer={footer}
        />
    );
};

export default ModelSelector;
