import CopyIconButton from '../common/CopyIconButton/CopyIconButton';

export default function LogCopyButton({text}: {text: string}) {
    return <CopyIconButton text={text} className="icon-btn log-copy-button"/>;
}
