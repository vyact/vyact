import React, { Fragment, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import {createPortal} from 'react-dom';
import {Search, X} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import './CustomSelect.css';

export interface SelectOption {
    value: string;
    label: string;
    description?: string;
    group?: string;
    disabled?: boolean;
}

interface CustomSelectProps {
    options: SelectOption[];
    optionsPageSize?: number;
    value: string;
    selectedValues?: string[];
    onChange: (value: string) => void;
    placeholder?: string;
    searchable?: boolean;
    allowCustomValue?: boolean;
    searchMaxLength?: number;
    searchPlaceholder?: string;
    disabled?: boolean;
    alignRight?: boolean;
    triggerStyle?: React.CSSProperties;
    className?: string;
    dropdownBackground?: string;  // 드롭다운 배경색 (기본: var(--surface2))
    dropdownClassName?: string;
    // 커스텀 렌더러
    renderTrigger?: (selectedLabel: string, open: boolean) => React.ReactNode;
    renderOption?: (opt: SelectOption, isSelected: boolean, closeDropdown: () => void) => React.ReactNode;
    searchAction?: React.ReactNode;
    clearable?: boolean;
    onClear?: () => void;
    clearLabel?: string;
    footer?: React.ReactNode | ((closeDropdown: () => void) => React.ReactNode);
    emptyState?: React.ReactNode;
    ariaLabel?: string;
    portal?: boolean;
    onOpen?: () => void;
    header?: React.ReactNode;
    afterSearch?: React.ReactNode;
    closeOnSelect?: boolean;
    showGroupLabels?: boolean;
}

function revealOption(dropdown: HTMLDivElement | null, index: number) {
    const list = dropdown?.querySelector<HTMLElement>('.custom-select-list');
    const option = list?.querySelector<HTMLElement>(`[data-option-index="${index}"]`);
    if (!list || !option) return;
    const listBounds = list.getBoundingClientRect();
    const optionBounds = option.getBoundingClientRect();
    if (optionBounds.top < listBounds.top) list.scrollTop -= listBounds.top - optionBounds.top;
    else if (optionBounds.bottom > listBounds.bottom) list.scrollTop += optionBounds.bottom - listBounds.bottom;
}

const CustomSelect: React.FC<CustomSelectProps> = ({
                                                       options,
                                                       optionsPageSize,
                                                       value,
                                                       selectedValues,
                                                       onChange,
                                                       placeholder,
                                                       searchable = false,
                                                       allowCustomValue = false,
                                                       searchMaxLength,
                                                       searchPlaceholder,
                                                       disabled = false,
                                                       alignRight = false,
                                                       triggerStyle,
                                                       className = '',
                                                       dropdownBackground,
                                                       dropdownClassName = '',
                                                       renderTrigger,
                                                       renderOption,
                                                       searchAction,
                                                       clearable = false,
                                                       onClear,
                                                       clearLabel,
                                                       footer,
                                                       emptyState,
                                                       ariaLabel,
                                                       portal = false,
                                                       onOpen,
                                                       header,
                                                       afterSearch,
                                                       closeOnSelect = true,
                                                       showGroupLabels = false,
                                                   }) => {
    const {t} = useTranslation('common');
    const resolvedPlaceholder = placeholder ?? t('select');
    const resolvedClearLabel = clearLabel ?? t('clearSelection');
    const [open, setOpen] = useState(false);
    const [search, setSearch] = useState('');
    const [renderedPage, setRenderedPage] = useState({key: '', count: 0});
    const [activeIndex, setActiveIndex] = useState(-1);
    const [keyboardNavigation, setKeyboardNavigation] = useState(false);
    const listId = useId();
    const triggerRef = useRef<HTMLButtonElement>(null);
    const [dropdownPlacement, setDropdownPlacement] = useState<'up' | 'down'>('down');
    const [portalPosition, setPortalPosition] = useState<React.CSSProperties>({});
    const wrapRef = useRef<HTMLDivElement>(null);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const searchRef = useRef<HTMLInputElement>(null);
    const selectedLabel = options.find(o => o.value === value)?.label ?? (allowCustomValue ? value : '');
    const isSelected = (optionValue: string) => selectedValues
        ? selectedValues.includes(optionValue)
        : optionValue === value;
    const showClearButton = clearable && Boolean(onClear) && Boolean(selectedValues?.length || value);
    const matchingOptions = searchable && search
        ? options.filter(o => `${o.label} ${o.description || ''}`.toLowerCase().includes(search.toLowerCase()))
        : options;
    const customValue = search.trim();
    const filtered = allowCustomValue && customValue && !options.some(option => option.value === customValue)
        ? [...matchingOptions, {value: customValue, label: customValue}]
        : matchingOptions;

    const optionKey = filtered.map(option => `${option.value}:${!!option.disabled}`).join('|');
    const pageKey = `${search}:${optionKey}`;
    const visibleCount = optionsPageSize ? Math.max(
        optionsPageSize, renderedPage.key === pageKey ? renderedPage.count : 0, activeIndex + 1,
    ) : filtered.length;
    useEffect(() => {
        if (!open) {setKeyboardNavigation(false); return;}
        const selectedIndex = search ? -1 : filtered.findIndex(option => option.value === value && !option.disabled);
        const nextIndex = selectedIndex >= 0 ? selectedIndex : filtered.findIndex(option => !option.disabled);
        setActiveIndex(nextIndex);
        const list = dropdownRef.current?.querySelector<HTMLElement>('.custom-select-list');
        if (list) list.scrollTop = 0;
        revealOption(dropdownRef.current, nextIndex);
    }, [open, search, optionKey, value]);

    useEffect(() => {
        if (open && keyboardNavigation && activeIndex >= 0) revealOption(dropdownRef.current, activeIndex);
    }, [open, activeIndex, keyboardNavigation]);

    useEffect(() => {
        const handler = (e: PointerEvent) => {
            const target = e.target as Node;
            const isActionMenuInteraction = target instanceof Element && Boolean(target.closest('.action-menu-content'));
            if (wrapRef.current && !wrapRef.current.contains(target) && !dropdownRef.current?.contains(target) && !isActionMenuInteraction) {
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
            triggerRef.current?.focus();
        }
    };
    const closeDropdown = () => {
        setOpen(false);
        setSearch('');
    };

    const handleKeyDown = (event: React.KeyboardEvent) => {
        if (event.nativeEvent.isComposing) return;
        if (!open) {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault(); event.stopPropagation();
                onOpen?.(); setKeyboardNavigation(true); setOpen(true);
            }
            return;
        }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault(); event.stopPropagation();
            setKeyboardNavigation(true);
            const direction = event.key === 'ArrowDown' ? 1 : -1;
            let next = activeIndex;
            for (let step = 0; step < filtered.length; step++) {
                next = (next + direction + filtered.length) % filtered.length;
                if (!filtered[next].disabled) {setActiveIndex(next); break;}
            }
        } else if (event.key === 'Enter' && (event.target === searchRef.current || event.target === triggerRef.current)) {
            event.preventDefault(); event.stopPropagation();
            const option = filtered[activeIndex];
            if (option && !option.disabled) handleSelect(option.value);
        } else if (event.key === 'Escape') {
            event.preventDefault(); event.stopPropagation(); closeDropdown(); triggerRef.current?.focus();
        } else if (event.key === 'Tab') closeDropdown();
    };

    const dropdown = open ? (
        <div
            ref={dropdownRef}
            onKeyDown={handleKeyDown}
            className={`custom-select-dropdown ${dropdownPlacement === 'up' ? 'drop-up' : 'drop-down'}${portal ? ' portal' : ''}${dropdownClassName ? ` ${dropdownClassName}` : ''}`}
            style={{
                ...portalPosition,
                ...(dropdownBackground ? {background: dropdownBackground} : {}),
            }}
        >
            {header}
            {searchable && (
                <div className="custom-select-search">
                    <div className="custom-select-search-field">
                        <Search className="custom-select-search-icon" size={15} aria-hidden="true"/>
                        <input
                            ref={searchRef}
                            type="text"
                            placeholder={t('search')}
                            aria-label={searchPlaceholder || t('search')}
                            role="combobox"
                            aria-expanded={open}
                            aria-controls={listId}
                            aria-activedescendant={activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
                            maxLength={searchMaxLength}
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                            onClick={e => e.stopPropagation()}
                        />
                    </div>
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
            {afterSearch}

            <div className="custom-select-list" id={listId} role="listbox" aria-multiselectable={selectedValues ? true : undefined}
                onScroll={event => {
                    if (!optionsPageSize) return;
                    const list = event.currentTarget;
                    if (list.scrollHeight - list.scrollTop - list.clientHeight < 100) {
                        setRenderedPage({key: pageKey, count: Math.min(filtered.length, visibleCount + optionsPageSize)});
                    }
                }}>
                {filtered.length > 0 ? (
                    filtered.slice(0, visibleCount).map((opt, index) => (
                        <Fragment key={opt.value}>
                        {showGroupLabels && opt.group && (index === 0 || opt.group !== filtered[index - 1].group) &&
                            <div className="custom-select-group-label" role="presentation">{opt.group}</div>}
                        <div
                            key={opt.value}
                            id={`${listId}-${index}`}
                            role="option"
                            aria-selected={isSelected(opt.value)}
                            data-option-index={index}
                            onMouseMove={() => {setKeyboardNavigation(false); if (!opt.disabled) setActiveIndex(index);}}
                            className={`custom-select-item${!showGroupLabels && index > 0 && opt.group !== filtered[index - 1].group ? ' group-start' : ''}${isSelected(opt.value) ? ' selected' : ''}${opt.disabled ? ' disabled' : ''}${keyboardNavigation && index === activeIndex && !opt.disabled ? ' keyboard-active' : ''}`}
                            aria-disabled={opt.disabled || undefined}
                            onClick={event => {
                                event.stopPropagation();
                                if (opt.disabled) return;
                                handleSelect(opt.value);
                            }}
                        >
                            {renderOption ? (
                                renderOption(opt, isSelected(opt.value), closeDropdown)
                            ) : (
                                <>
                                    <span className="custom-select-item-copy">
                                        <span className="custom-select-item-label">{opt.label}</span>
                                        {opt.description && <span className="custom-select-item-description">{opt.description}</span>}
                                    </span>
                                    {isSelected(opt.value) && (
                                        <span className="custom-select-check">✓</span>
                                    )}
                                </>
                            )}
                        </div>
                        </Fragment>
                    ))
                ) : (
                    emptyState || <div className="custom-select-empty">{t(search ? 'noSearchResults' : 'noItems')}</div>
                )}
            </div>

            {typeof footer === 'function' ? footer(closeDropdown) : footer}
        </div>
    ) : null;

    return (
        <div
            ref={wrapRef}
            className={`custom-select-wrap${alignRight ? ' align-right' : ''}${disabled ? ' disabled' : ''} ${className}`.trim()}
        >
            <button
                ref={triggerRef}
                onKeyDown={handleKeyDown}
                aria-expanded={open}
                aria-haspopup="listbox"
                aria-controls={open ? listId : undefined}
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
                    renderTrigger(selectedLabel || resolvedPlaceholder, open)
                ) : (
                    <>
                        <span className="custom-select-trigger-label">
                            {selectedLabel || resolvedPlaceholder}
                        </span>
                        <span className={`custom-select-arrow${open ? ' open' : ''}`}>▼</span>
                    </>
                )}
            </button>
            {showClearButton && (
                <button type="button" className="custom-select-clear" aria-label={resolvedClearLabel}
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
