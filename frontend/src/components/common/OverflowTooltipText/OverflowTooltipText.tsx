import {useLayoutEffect, useRef, useState} from 'react';
import {Tooltip} from '../Tooltip/Tooltip';

interface OverflowTooltipTextProps {
    text: string;
    className?: string;
    as?: 'strong' | 'span';
}

export default function OverflowTooltipText({text, className, as: Tag = 'strong'}: OverflowTooltipTextProps) {
    const textRef = useRef<HTMLElement>(null);
    const [isOverflowing, setIsOverflowing] = useState(false);

    useLayoutEffect(() => {
        const element = textRef.current;
        if (!element) return;
        const updateOverflow = () => setIsOverflowing(element.scrollWidth > element.clientWidth);
        updateOverflow();
        const observer = new ResizeObserver(updateOverflow);
        observer.observe(element);
        return () => observer.disconnect();
    }, [text]);

    return <Tooltip content={isOverflowing ? text : ''} multiline size="medium">
        <Tag className={className} ref={textRef} tabIndex={isOverflowing ? 0 : -1}>{text}</Tag>
    </Tooltip>;
}
