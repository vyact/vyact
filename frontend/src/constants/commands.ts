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
        desc: '프롬프트·기사·이미지를 선택해 AI 프레젠테이션을 생성합니다.',
        example: '/presentation',
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
        cmd: '/voicepractice',
        usage: '/voicepractice',
        desc: '말하기 연습과 스크립트 연습을 시작합니다.',
        example: '/voicepractice',
        icon: Mic,
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
