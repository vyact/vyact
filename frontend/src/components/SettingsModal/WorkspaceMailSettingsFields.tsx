import {useId} from 'react';
import {useTranslation} from 'react-i18next';
import CustomSelect from '../CustomSelect/CustomSelect';
import {Tooltip} from '../common/Tooltip/Tooltip';
import type {McpField as Field} from './McpFieldInput';

export default function WorkspaceMailSettingsFields({disabled = false, notificationHelp, mailModeField, notificationField, mailMode, notificationsEnabled, onMailModeChange, onNotificationsChange}: {
    disabled?: boolean;
    notificationHelp?: string;
    mailModeField: Field;
    notificationField: Field;
    mailMode: string;
    notificationsEnabled: boolean;
    onMailModeChange: (value: string) => void;
    onNotificationsChange: (value: boolean) => void;
}) {
    const {t} = useTranslation('settings');
    const fieldIdPrefix = useId();
    const label = (field: Field) => t(`mcpCatalog.fields.${field.key}`, {defaultValue: field.label});
    const notificationInputId = `${fieldIdPrefix}-${notificationField.key}`;

    return <div className="mcp-mail-settings">
        <span className="mcp-field-label">{label(mailModeField)}</span>
        <label className="mcp-field-label mcp-notification-label" htmlFor={notificationInputId}>
            <Tooltip content={notificationHelp ?? t('mcpCatalog.fields.mail_notifications_help')} multiline size="medium">
                <span className="mcp-notification-help" tabIndex={0} role="img"
                      aria-label={notificationHelp ?? t('mcpCatalog.fields.mail_notifications_help')}
                      onClick={event => event.preventDefault()}>?</span>
            </Tooltip>
            <span>{label(notificationField)}</span>
        </label>
        <CustomSelect disabled={disabled}
            options={(mailModeField.options || []).map(option => ({value: option.value, label: t(`mcpCatalog.options.${option.value}`, {defaultValue: option.label})}))}
            value={mailMode || mailModeField.options?.[0]?.value || ''}
            onChange={onMailModeChange}
        />
        <div className="mcp-mail-toggle-control">
            <label className="mcp-switch">
                <input disabled={disabled} id={notificationInputId} type="checkbox" checked={notificationsEnabled}
                       onChange={event => onNotificationsChange(event.target.checked)}/>
                <span className="mcp-slider"/>
            </label>
        </div>
    </div>;
}

