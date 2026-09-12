import './ToggleSwitch.css';

export default function ToggleSwitch({checked, disabled, label, onChange}: {
    checked: boolean; disabled?: boolean; label: string; onChange: (checked: boolean) => void;
}) {
    return <label className="settings-switch">
        <input type="checkbox" role="switch" aria-label={label} checked={checked} disabled={disabled} onChange={event => onChange(event.target.checked)}/>
        <span className="settings-switch-slider"/>
    </label>;
}
