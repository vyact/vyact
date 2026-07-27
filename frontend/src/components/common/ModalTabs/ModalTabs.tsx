import './ModalTabs.css';

export interface ModalTabItem<T extends string> {
    key: T;
    label: React.ReactNode;
}

interface ModalTabsProps<T extends string> {
    tabs: ModalTabItem<T>[];
    activeKey: T;
    onChange: (key: T) => void;
    disabled?: boolean;
}

/**
 * 모달 상단 탭 (underline 스타일 · 설정 모달 기준).
 * 여러 모달에서 공통으로 사용한다.
 */
function ModalTabs<T extends string>({ tabs, activeKey, onChange, disabled = false }: ModalTabsProps<T>) {
    return (
        <div className="modal-tabs-bar">
            {tabs.map(tab => (
                <button
                    key={tab.key}
                    className={`modal-tab ${activeKey === tab.key ? 'active' : ''}`}
                    onClick={() => onChange(tab.key)}
                    disabled={disabled}
                >
                    {tab.label}
                </button>
            ))}
        </div>
    );
}

export default ModalTabs;