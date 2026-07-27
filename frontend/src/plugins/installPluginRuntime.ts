import React from 'react';
import * as ReactJsxRuntime from 'react/jsx-runtime';
import {useTranslation} from 'react-i18next';
import CustomSelect from '../components/CustomSelect/CustomSelect';
import ModalOverlay from '../components/common/ModalOverlay/ModalOverlay';
import {toast} from '../components/common/ToastNotifications/ToastNotifications';
import {usePanelManager} from '../contexts/PanelManagerContext';
import i18n from '../i18n';
import {getReasoningEnabled} from '../utils/reasoning';
import {openPluginModal, openPluginPanel} from './registry';

export function installPluginRuntime(): void {
    window.__VYACT_PLUGIN_RUNTIME__ = {
        React,
        ReactJsxRuntime,
        useTranslation,
        CustomSelect,
        ModalOverlay,
        toast,
        usePanelManager,
        i18n,
        getReasoningEnabled,
        openPluginModal,
        openPluginPanel,
    };
}

declare global {
    interface Window {
        __VYACT_PLUGIN_RUNTIME__: {
            React: typeof React;
            ReactJsxRuntime: typeof ReactJsxRuntime;
            useTranslation: typeof useTranslation;
            CustomSelect: typeof CustomSelect;
            ModalOverlay: typeof ModalOverlay;
            toast: typeof toast;
            usePanelManager: typeof usePanelManager;
            i18n: typeof i18n;
            getReasoningEnabled: typeof getReasoningEnabled;
            openPluginModal: typeof openPluginModal;
            openPluginPanel: typeof openPluginPanel;
        };
    }
}
