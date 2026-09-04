import {useTranslation} from 'react-i18next';
import {useEffect, useState} from 'react';
import ApiKeyField from '../common/ApiKeyField/ApiKeyField';
import {assertOk} from '../../utils/apiError';

export interface PluginSettingsDefinition {
    endpoint: string;
    fields: Array<{
        id: string;
        type: 'secret';
        label: string;
        description?: string;
        help_url?: string;
    }>;
}

interface PluginSettingsFieldsProps {
    definition: PluginSettingsDefinition;
}

const PluginSettingsFields = ({definition}: PluginSettingsFieldsProps) => {
    const {t} = useTranslation('settings');
    const [status, setStatus] = useState<Record<string, {has_key: boolean; key_preview: string}>>({});

    useEffect(() => {
        let active = true;
        fetch(definition.endpoint)
            .then(async response => {
                await assertOk(response, t('pluginSettings.loadFailed'));
                return response.json();
            })
            .then(result => {
                if (!active) return;
                const firstField = definition.fields[0];
                if (firstField) {
                    setStatus({
                        [firstField.id]: {
                            has_key: Boolean(result.has_key),
                            key_preview: String(result.key_preview || ''),
                        },
                    });
                }
            })
            .catch(() => {
                if (active) setStatus({});
            });
        return () => {
            active = false;
        };
    }, [definition, t]);

    return (
        <div className="plugin-settings-fields">
            {definition.fields.map(field => (
                <div className="plugin-settings-field" key={field.id}>
                    <div className="plugin-settings-field-header">
                        <strong>{field.label}</strong>
                        {field.help_url && (
                            <a href={field.help_url} target="_blank" rel="noreferrer">
                                {t('pluginSettings.help')} ↗
                            </a>
                        )}
                    </div>
                    {field.description && <p>{field.description}</p>}
                    <ApiKeyField
                        hasKey={Boolean(status[field.id]?.has_key)}
                        keyPreview={status[field.id]?.key_preview || ''}
                        onSave={async key => {
                            const response = await fetch(definition.endpoint, {
                                method: 'PUT',
                                headers: {'Content-Type': 'application/json'},
                                body: JSON.stringify({[field.id]: key}),
                            });
                            await assertOk(response, t('pluginSettings.saveFailed'));
                            const result = await response.json();
                            setStatus(previous => ({
                                ...previous,
                                [field.id]: {
                                    has_key: Boolean(result.has_key),
                                    key_preview: String(result.key_preview || ''),
                                },
                            }));
                        }}
                    />
                </div>
            ))}
        </div>
    );
};

export default PluginSettingsFields;
