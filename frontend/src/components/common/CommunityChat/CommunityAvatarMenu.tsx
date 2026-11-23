import {useEffect, useRef, useState} from 'react';
import {Camera, ChevronDown, PencilLine, UserRound, UserRoundMinus} from 'lucide-react';
import WorkspaceExitButton from '../WorkspaceLayout/WorkspaceExitButton';

export default function CommunityAvatarMenu({nickname, nicknameEditLabel, avatarSrc, avatarEditLabel, logoutLabel, withdrawLabel, onEditNickname, onEditAvatar, onWithdraw, onLogout}: {
    nickname: string;
    nicknameEditLabel?: string;
    avatarSrc?: string;
    avatarEditLabel?: string;
    logoutLabel: string;
    withdrawLabel?: string;
    onWithdraw: () => void;
    onEditAvatar: () => void;
    onEditNickname: () => void;
    onLogout: () => void;
}) {
    const [failedAvatar, setFailedAvatar] = useState<string>();
    const [open, setOpen] = useState(false);
    const menu = useRef<HTMLDivElement>(null);
    const trigger = useRef<HTMLButtonElement>(null);
    useEffect(() => {
        if (!open) return;
        const closeOutside = (event: PointerEvent) => {
            if (!menu.current?.contains(event.target as Node)) setOpen(false);
        };
        document.addEventListener('pointerdown', closeOutside, true);
        return () => document.removeEventListener('pointerdown', closeOutside, true);
    }, [open]);
    const avatar = avatarSrc && failedAvatar !== avatarSrc
        ? <img src={avatarSrc} alt="" onError={() => setFailedAvatar(avatarSrc)}/>
        : <UserRound size={16} aria-hidden="true"/>;
    return <div ref={menu} className="community-avatar-menu" data-tooltip-disabled onKeyDown={event => {
        if (event.key !== 'Escape' || !open) return;
        event.stopPropagation();
        setOpen(false);
        trigger.current?.focus();
    }}>
        <button ref={trigger} type="button" className="community-avatar-trigger"
            aria-label={nickname} aria-expanded={open} onClick={() => setOpen(current => !current)}>
            {avatar}
        </button>
        {open && <div className="community-avatar-popover">
            <button type="button" className="community-avatar-action community-avatar-nickname" aria-label={nicknameEditLabel}
                onClick={() => {setOpen(false); onEditNickname();}}>
                <span className="community-avatar-action-icon community-avatar-thumbnail" aria-hidden="true">{avatar}</span>
                <span className="community-avatar-action-label">{nickname}</span>
                <PencilLine className="community-avatar-action-end" size={13} aria-hidden="true"/>
            </button>
            {avatarEditLabel && <button type="button" className="community-avatar-action"
                onClick={() => {setOpen(false); onEditAvatar();}}>
                <span className="community-avatar-action-icon" aria-hidden="true"><Camera size={14} strokeWidth={1.8}/></span>
                <span className="community-avatar-action-label">{avatarEditLabel}</span>
            </button>}
            <WorkspaceExitButton className="community-avatar-logout" label={logoutLabel}
                onClick={() => {setOpen(false); onLogout();}}/>
            {withdrawLabel && <details className="community-avatar-withdraw-details">
                <summary className="community-avatar-action community-avatar-withdraw-toggle" aria-label={withdrawLabel}>
                    <ChevronDown size={15} aria-hidden="true"/>
                </summary>
                <button type="button" className="community-avatar-action community-avatar-withdraw"
                    onClick={() => {setOpen(false); onWithdraw();}}>
                    <span className="community-avatar-action-icon" aria-hidden="true"><UserRoundMinus size={14} strokeWidth={1.8}/></span>
                    <span className="community-avatar-action-label">{withdrawLabel}</span>
                </button>
            </details>}
        </div>}
    </div>;
}
