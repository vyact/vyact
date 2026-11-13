import {useEffect, useState} from 'react';

export default function useObjectUrl(file?: Blob | null): string | undefined {
    const [url, setUrl] = useState<string>();
    useEffect(() => {
        if (!file) {setUrl(undefined); return;}
        const objectUrl = URL.createObjectURL(file);
        setUrl(objectUrl);
        return () => URL.revokeObjectURL(objectUrl);
    }, [file]);
    return url;
}
