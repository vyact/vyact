import React, {useState} from 'react';
import {Pencil, Settings, Trash2} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import CustomSelect from '../CustomSelect/CustomSelect';
import type {SelectOption} from '../CustomSelect/CustomSelect';
import ConfirmModal from '../common/ConfirmModal/ConfirmModal';
import './ModelSelector.css';

interface ModelSelectorProps {
    installed: string[];
    mtpSupported: string[];
    mtpActive: string | null;
    selectedModel: string;
    currentProvider: string;
    disabled?: boolean;
    onModelChange: (model: string, needsDownload: boolean, modelType?: ModelType) => void;
    onModelDelete: (model: string) => Promise<void>;
    onProviderSettingsOpen: () => void;
}

type ModelType = 'chat' | 'image_gen' | 'image_edit';

const getModelDisplayName = (modelId: string) => modelId.split('/').filter(Boolean).pop() || modelId;

const ModelSelector: React.FC<ModelSelectorProps> = ({
                                                         installed,
                                                         mtpSupported,
                                                         mtpActive,
                                                         selectedModel,
                                                         currentProvider,
                                                         disabled = false,
                                                         onModelChange,
                                                         onModelDelete,
                                                         onProviderSettingsOpen,
                                                     }) => {
    const {t} = useTranslation('main');
    const [modelToDelete, setModelToDelete] = useState<string | null>(null);
    const [isDeleting, setIsDeleting] = useState(false);
    const handleLocalModelSelect = (model: string, modelType?: ModelType) => {
        const needsDownload = !installed.includes(model);
        onModelChange(model, needsDownload, modelType);
    };

    const allModelIds = installed;
    const options: SelectOption[] = allModelIds.map(id => {
        return {value: id, label: getModelDisplayName(id)};
    });

    // 트리거: dot + 모델명
    const renderTrigger = (_label: string, open: boolean) => {
        const isInstalled = installed.includes(selectedModel);
        const showMtp = currentProvider === 'vyact' && mtpActive === selectedModel;
        return (
            <>
                <div className={`mdot ${isInstalled ? 'installed' : 'not-installed'}`}/>
                {showMtp && <span className="mtp-model-badge">MTP</span>}
                <span className="mname">
                    {selectedModel ? getModelDisplayName(selectedModel) : t('modelSelector.selectModel')}
                </span>
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
                    <span className="dd-model-label" title={opt.value}>
                        {opt.label}
                    </span>
                </div>

                {!isSelected && isInst && <button type="button" className="dd-model-delete"
                    aria-label={t('modelSelector.deleteModel', {model: opt.label})}
                    onClick={event => {
                        event.stopPropagation();
                        setModelToDelete(opt.value);
                    }}>
                    <Trash2 size={14} aria-hidden="true"/>
                </button>}
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

    return (<>
        <CustomSelect
            options={options}
            value={selectedModel}
            onChange={id => handleLocalModelSelect(id)}
            searchable
            disabled={disabled}
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
        {modelToDelete && <ConfirmModal
            title={t('modelSelector.deleteModelConfirm', {model: getModelDisplayName(modelToDelete)})}
            description={t('modelSelector.deleteModelDescription')}
            options={[
                {label: t('modelSelector.cancel'), value: 'cancel'},
                {label: t('modelSelector.delete'), value: 'delete', variant: 'danger'},
            ]}
            actionLayout="horizontal"
            loading={isDeleting}
            loadingValue="delete"
            loadingLabel={t('modelSelector.deletingModel')}
            onClose={() => setModelToDelete(null)}
            onSelect={value => {
                if (value !== 'delete') {
                    setModelToDelete(null);
                    return;
                }
                setIsDeleting(true);
                void onModelDelete(modelToDelete).catch(() => undefined).finally(() => {
                    setIsDeleting(false);
                    setModelToDelete(null);
                });
            }}
        />}
    </>);
};

export default ModelSelector;
