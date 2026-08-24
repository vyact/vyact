import React from 'react';
import {Pencil, Settings} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import CustomSelect from '../CustomSelect/CustomSelect';
import type {SelectOption} from '../CustomSelect/CustomSelect';
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
    const handleLocalModelSelect = (model: string, modelType?: ModelType) => {
        const needsDownload = !installed.includes(model);
        onModelChange(model, needsDownload, modelType);
    };

    const allModelIds = installed;
    const options: SelectOption[] = allModelIds.map(id => {
        return {value: id, label: id};
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
                    <span style={{overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}}>
                        {opt.label}
                    </span>
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
    const footer = undefined;

    if (currentProvider !== 'vyact') {
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
            onChange={id => handleLocalModelSelect(id)}
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
