interface Props {
    title: string;
    description: string;
    detail?: string;
}

export default function ModelSettingsHelp({title, description, detail}: Props) {
    return <div className="model-settings-help-card">
        <strong className="model-settings-help-title">{title}</strong>
        <p>{description}</p>
        {detail && <div className="model-settings-help-detail">{detail}</div>}
    </div>;
}
