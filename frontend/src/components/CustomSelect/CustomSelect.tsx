import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {createPortal} from 'react-dom';
import {X} from 'lucide-react';
import './CustomSelect.css';

export interface SelectOption {
    value: string;
    label: string;
    disabled?: boolean;
}

interface CustomSelectProps {
    options: SelectOption[];
    value: string;
    selectedValues?: string[];
    onChange: (value: string) => void;
    placeholder?: string;
    searchable?: boolean;
    searchPlaceholder?: string;
    disabled?: boolean;
    alignRight?: boolean;
    triggerStyle?: React.CSSProperties;
    className?: string;
    dropdownBackground?: string;  // 드롭다운 배경색 (기본: var(--surface2))
    // 커스텀 렌더러
    renderTrigger?: (selectedLabel: string, open: boolean) => React.ReactNode;
    renderOption?: (opt: SelectOption, isSelected: boolean) => React.ReactNode;
    searchAction?: React.ReactNode;
    clearable?: boolean;
    onClear?: () => void;
    clearLabel?: string;
    footer?: React.ReactNode;
    emptyState?: React.ReactNode;
    ariaLabel?: string;
    portal?: boolean;
    onOpen?: () => void;
    header?: React.ReactNode;
    closeOnSelect?: boolean;
}

const CustomSelect: React.FC<CustomSelectProps> = ({
                                                       options,
                                                       value,
                                                       selectedValues,
                                                       onChange,
                                                       placeholder = '선택',
                                                       searchable = false,
                                                       searchPlaceholder = '검색...',
                                                       disabled = false,
                                                       alignRight = false,
                                                       triggerStyle,
                                                       className = '',
                                                       dropdownBackground,
                                                       renderTrigger,
                                                       renderOption,
                                                       searchAction,
                                                       clearable = false,
                                                       onClear,
                                                       clearLabel = 'Clear selection',
                                                       footer,
                                                       emptyState,
                                                       ariaLabel,
                                                       portal = false,
                                                       onOpen,
                                                       header,
                                                       closeOnSelect = true,
                                                   }) => {
    const [open, setOpen] = useState(false);
    const [search, setSearch] = useState('');
    const [dropdownPlacement, setDropdownPlacement] = useState<'up' | 'down'>('down');
    const [portalPosition, setPortalPosition] = useState<React.CSSProperties>({});
    const wrapRef = useRef<HTMLDivElement>(null);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const searchRef = useRef<HTMLInputElement>(null);
    const selectedLabel = options.find(o => o.value === value)?.label ?? '';
    const isSelected = (optionValue: string) => selectedValues
        ? selectedValues.includes(optionValue)
        : optionValue === value;
    const showClearButton = clearable && Boolean(onClear) && Boolean(selectedValues?.length || value);
    const filtered = searchable && search
        ? options.filter(o => o.label.toLowerCase().includes(search.toLowerCase()))
        : options;

    useEffect(() => {
        const handler = (e: PointerEvent) => {
            const target = e.target as Node;
            if (wrapRef.current && !wrapRef.current.contains(target) && !dropdownRef.current?.contains(target)) {
                setOpen(false);
                setSearch('');
            }
        };
        if (open) document.addEventListener('pointerdown', handler, true);
        return () => document.removeEventListener('pointerdown', handler, true);
    }, [open]);

    useEffect(() => {
        const closeForEmbeddedContent = () => {
            setOpen(false);
            setSearch('');
        };
        window.addEventListener('vyact:email-body-interaction', closeForEmbeddedContent);
        return () => window.removeEventListener('vyact:email-body-interaction', closeForEmbeddedContent);
    }, []);

    useEffect(() => {
        if (open && searchable && searchRef.current) {
            searchRef.current.focus();
        }
    }, [open, searchable]);

    useLayoutEffect(() => {
        if (!open) return;

        const updateDropdownPlacement = () => {
            const triggerRect = wrapRef.current?.getBoundingClientRect();
            const dropdownHeight = dropdownRef.current?.getBoundingClientRect().height ?? 0;
            if (!triggerRect || !dropdownHeight) return;

            const spaceBelow = window.innerHeight - triggerRect.bottom;
            const spaceAbove = triggerRect.top;
            const nextPlacement = dropdownHeight + 4 > spaceBelow && spaceAbove > spaceBelow ? 'up' : 'down';
            setDropdownPlacement(nextPlacement);
            if (portal) {
                setPortalPosition({
                    left: triggerRect.left,
                    top: nextPlacement === 'up'
                        ? Math.max(4, triggerRect.top - dropdownHeight - 4)
                        : triggerRect.bottom + 4,
                    width: triggerRect.width,
                });
            }
        };

        updateDropdownPlacement();
        window.addEventListener('resize', updateDropdownPlacement);
        window.addEventListener('scroll', updateDropdownPlacement, true);
        return () => {
            window.removeEventListener('resize', updateDropdownPlacement);
            window.removeEventListener('scroll', updateDropdownPlacement, true);
        };
    }, [open, filtered.length, portal]);

    const handleSelect = (optValue: string) => {
        onChange(optValue);
        if (closeOnSelect) {
            setOpen(false);
            setSearch('');
        }
    };

    const dropdown = open ? (
        <div
            ref={dropdownRef}
            className={`custom-select-dropdown ${dropdownPlacement === 'up' ? 'drop-up' : 'drop-down'}${portal ? ' portal' : ''}`}
            style={{
                ...portalPosition,
                ...(dropdownBackground ? {background: dropdownBackground} : {}),
            }}
        >
            {header}
            {searchable && (
                <div className="custom-select-search">
                    <input
                        ref={searchRef}
                        type="text"
                        placeholder={searchPlaceholder}
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        onClick={e => e.stopPropagation()}
                    />
                    {searchAction && (
                        <span className="custom-select-search-action-slot" onClick={() => {
                            setOpen(false);
                            setSearch('');
                        }}>
                            {searchAction}
                        </span>
                    )}
                </div>
            )}

            <div className="custom-select-list">
                {filtered.length > 0 ? (
                    filtered.map(opt => (
                        <div
                            key={opt.value}
                            className={`custom-select-item${isSelected(opt.value) ? ' selected' : ''}${opt.disabled ? ' disabled' : ''}`}
                            aria-disabled={opt.disabled || undefined}
                            onClick={event => {
                                event.stopPropagation();
                                if (opt.disabled) return;
                                handleSelect(opt.value);
                            }}
                        >
                            {renderOption ? (
                                renderOption(opt, isSelected(opt.value))
                            ) : (
                                <>
                                    <span className="custom-select-item-label">{opt.label}</span>
                                    {isSelected(opt.value) && (
                                        <span className="custom-select-check">✓</span>
                                    )}
                                </>
                            )}
                        </div>
                    ))
                ) : (
                    emptyState || <div className="custom-select-empty">{search ? '검색 결과 없음' : '항목 없음'}</div>
                )}
            </div>

            {footer && footer}
        </div>
    ) : null;

    return (
        <div
            ref={wrapRef}
            className={`custom-select-wrap${alignRight ? ' align-right' : ''}${disabled ? ' disabled' : ''} ${className}`.trim()}
        >
            <button
                className={`custom-select-trigger${open ? ' open' : ''}${showClearButton ? ' has-clear' : ''}`}
                aria-label={ariaLabel}
                onClick={event => {
                    event.stopPropagation();
                    if (!disabled) setOpen(current => {
                        if (!current) onOpen?.();
                        return !current;
                    });
                }}
                style={triggerStyle}
                type="button"
            >
                {renderTrigger ? (
                    renderTrigger(selectedLabel || placeholder, open)
                ) : (
                    <>
                        <span className="custom-select-trigger-label">
                            {selectedLabel || placeholder}
                        </span>
                        <span className={`custom-select-arrow${open ? ' open' : ''}`}>▼</span>
                    </>
                )}
            </button>
            {showClearButton && (
                <button type="button" className="custom-select-clear" aria-label={clearLabel}
                        onClick={event => {
                            event.stopPropagation();
                            onClear?.();
                            setOpen(false);
                            setSearch('');
                        }}>
                    <X size={14} strokeWidth={2.25} aria-hidden="true"/>
                </button>
            )}

            {portal && dropdown ? createPortal(dropdown, document.body) : dropdown}
        </div>
    );
};

export default CustomSelect;
