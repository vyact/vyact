import type { LucideIcon } from 'lucide-react';
import {ClipboardCheck, Eraser, FileText, Mic, Sparkles} from 'lucide-react';

export interface Command {
    name?: string;
    cmd: string;
    usage: string;
    desc: string;
    example: string;
    icon: LucideIcon;
}

export const COMMANDS: Command[] = [
    {
        cmd: '/presentation',
        usage: '/presentation',
        desc: '',
        example: '/presentation',
        icon: FileText,
    },
    {
        cmd: '/memo',
        usage: '/memo',
        desc: '',
        example: '/memo',
        icon: FileText,
    },
    {
        cmd: '/quickmemo',
        usage: '/quickmemo',
        desc: '',
        example: '/quickmemo',
        icon: ClipboardCheck,
    },
    {
        cmd: '/voicepractice',
        usage: '/voicepractice',
        desc: '',
        example: '/voicepractice',
        icon: Mic,
    },
    {
        cmd: '/clear',
        usage: '/clear',
        desc: '',
        example: '/clear',
        icon: Eraser,
    },
    {
        cmd: '/remember',
        usage: '/remember',
        desc: '',
        example: '/remember',
        icon: Sparkles,
    },
];
