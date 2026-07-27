import type { LucideIcon } from 'lucide-react';
import {ClipboardCheck, Eraser, FileText, Sparkles} from 'lucide-react';

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
        cmd: '/pdf',
        usage: '/pdf',
        desc: '프롬프트·기사·이미지를 선택해 AI가 고품질 PDF 문서를 자동 생성합니다.',
        example: '/pdf',
        icon: FileText,
    },
    {
        cmd: '/memo',
        usage: '/memo',
        desc: '메모를 작성하고 관리합니다. RAG 검색에 포함됩니다.',
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
        cmd: '/clear',
        usage: '/clear',
        desc: '현재 대화방의 메시지를 모두 삭제합니다. (방과 제목은 유지)',
        example: '/clear',
        icon: Eraser,
    },
    {
        cmd: '/remember',
        usage: '/remember',
        desc: '지금까지의 대화를 분석하여 사용자 프로필을 업데이트합니다. 이후 대화에 자동으로 반영됩니다.',
        example: '/remember',
        icon: Sparkles,
    },
];
