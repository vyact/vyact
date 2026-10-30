import {Fragment, useLayoutEffect, useRef, useState} from 'react';

const LOCAL_IMAGE_TAG = /<img\b[^>]*src="(\/api\/novel-studio\/images\/[a-f0-9]{32}\.(?:png|jpg|gif|webp))"[^>]*\/?>/g;

function ManuscriptImage({src, width}: {src: string; width?: number}) {
    const imageRef = useRef<HTMLImageElement>(null);
    useLayoutEffect(() => {
        const image = imageRef.current;
        if (!image) return;
        let active = true;
        void image.decode().then(() => {if (active) setSize({width: image.naturalWidth, height: image.naturalHeight});}).catch(() => {});
        return () => {active = false;};
    }, [src]);
    const [size, setSize] = useState<{width: number; height: number} | null>(null);
    return <img ref={imageRef} src={src} alt="" loading="eager" decoding="async" width={width ?? size?.width} height={size ? (width ?? size.width) * size.height / size.width : undefined} onLoad={event => {
        const image = event.currentTarget;
        setSize({width: image.naturalWidth, height: image.naturalHeight});
    }}/>;
}

export default function ManuscriptReadingContent({html}: {html: string}) {
    const parts = [];
    let position = 0;
    for (const match of html.matchAll(LOCAL_IMAGE_TAG)) {
        const before = html.slice(position, match.index);
        const width = match[0].match(/\bwidth="(\d+)"/);
        parts.push(<Fragment key={match.index}><span dangerouslySetInnerHTML={{__html: before}}/><ManuscriptImage src={match[1]} width={width ? Number(width[1]) : undefined}/></Fragment>);
        position = match.index! + match[0].length;
    }
    parts.push(<span key="remaining" dangerouslySetInnerHTML={{__html: html.slice(position)}}/>);
    return <>{parts}</>;
}
