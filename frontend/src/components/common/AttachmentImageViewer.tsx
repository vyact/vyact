import {useEffect, useState, type ComponentProps} from 'react';
import ImageViewer from '../ImageViewer/ImageViewer';

type ViewerProps = ComponentProps<typeof ImageViewer>;
const NO_IMAGES: ViewerProps['images'] = [];

interface Props extends Omit<ViewerProps, 'images'> {
    files: File[];
    additionalImages?: ViewerProps['images'];
}

export default function AttachmentImageViewer({files, additionalImages = NO_IMAGES, ...props}: Props) {
    const [preview, setPreview] = useState<{files: File[]; images: ViewerProps['images']} | null>(null);
    useEffect(() => {
        const images = files.map(file => ({src: URL.createObjectURL(file), alt: file.name}));
        setPreview({files, images});
        return () => images.forEach(image => URL.revokeObjectURL(image.src));
    }, [files]);
    if (!preview || preview.files !== files) return null;
    const images = [...preview.images, ...additionalImages];
    return <ImageViewer {...props} images={images} currentIndex={Math.min(props.currentIndex, images.length - 1)}/>;
}
