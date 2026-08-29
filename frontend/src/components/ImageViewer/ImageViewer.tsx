import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, Download, X } from 'lucide-react';
import {useTranslation} from 'react-i18next';
import './ImageViewer.css';

interface ImageItem {
    src: string;       // URL or blob URL
    alt?: string;
}

interface ImageViewerProps {
    images: ImageItem[];
    currentIndex: number;
    onClose: () => void;
    onIndexChange: (index: number) => void;
}

const ImageViewer: React.FC<ImageViewerProps> = ({ images, currentIndex, onClose, onIndexChange }) => {
    const {t} = useTranslation('main');
    const total = images.length;

    useEffect(() => {
        window.dispatchEvent(new CustomEvent('vyact:native-overlay-open'));
        const handleKey = (e: globalThis.KeyboardEvent) => {
            if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
            if (e.key === 'ArrowLeft' && total > 1) onIndexChange((currentIndex - 1 + total) % total);
            if (e.key === 'ArrowRight' && total > 1) onIndexChange((currentIndex + 1) % total);
        };
        window.addEventListener('keydown', handleKey, true); // capture: true → 전역 핸들러보다 먼저 실행
        return () => {
            window.removeEventListener('keydown', handleKey, true);
            window.dispatchEvent(new CustomEvent('vyact:native-overlay-close'));
        };
    }, [currentIndex, total, onClose, onIndexChange]);

    const current = images[currentIndex];
    if (!current) return null;

    const downloadCurrentImage = async () => {
        const fallbackName = `image-${currentIndex + 1}.png`;
        const fileName = current.alt?.trim() || fallbackName;
        try {
            const sourceUrl = new URL(current.src, window.location.href);
            const downloadUrl = sourceUrl.hostname === 'localhost'
                && sourceUrl.port === '8000'
                && sourceUrl.pathname.startsWith('/api/')
                ? `${sourceUrl.pathname}${sourceUrl.search}`
                : current.src;
            const response = await fetch(downloadUrl);
            if (!response.ok) throw new Error(response.statusText);
            const blobUrl = URL.createObjectURL(await response.blob());
            const link = document.createElement('a');
            link.href = blobUrl;
            link.download = fileName;
            link.style.display = 'none';
            document.body.appendChild(link);
            link.click();
            window.setTimeout(() => {
                link.remove();
                URL.revokeObjectURL(blobUrl);
            }, 100);
        } catch (error) {
            console.error('이미지 다운로드 실패:', error);
        }
    };

    return createPortal(
        <div className="image-viewer">
            <div className="image-viewer__actions">
                <button
                    className="image-viewer__action"
                    onClick={(event) => {
                        event.stopPropagation();
                        void downloadCurrentImage();
                    }}
                    aria-label={t('documentModal.download')}
                >
                    <Download size={16}/>
                </button>
                <button
                    className="image-viewer__action image-viewer__action--close"
                    onClick={(event) => {
                        event.stopPropagation();
                        onClose();
                    }}
                    aria-label={t('documentModal.close')}
                >
                    <X size={17}/>
                </button>
            </div>

            {/* 이전 */}
            {total > 1 && (
                <button
                    className="image-viewer__navigation image-viewer__navigation--previous"
                    onClick={(e) => { e.stopPropagation(); onIndexChange((currentIndex - 1 + total) % total); }}
                    aria-label="Previous image"
                ><ChevronLeft size={18}/></button>
            )}

            {/* 이미지 */}
            <div
                className="image-viewer__stage"
                onClick={(e) => e.stopPropagation()}
            >
                <img
                    className="image-viewer__image"
                    src={current.src}
                    alt={current.alt ?? '이미지'}
                />
            </div>

            {/* 다음 */}
            {total > 1 && (
                <button
                    className="image-viewer__navigation image-viewer__navigation--next"
                    onClick={(e) => { e.stopPropagation(); onIndexChange((currentIndex + 1) % total); }}
                    aria-label="Next image"
                ><ChevronRight size={18}/></button>
            )}

            {/* 이미지 썸네일 */}
            {total > 1 && (
                <div className="image-viewer__thumbnails" onClick={(event) => event.stopPropagation()}>
                    {images.map((image, i) => (
                        <button
                            key={i}
                            onClick={(e) => { e.stopPropagation(); onIndexChange(i); }}
                            className={`image-viewer__thumbnail${i === currentIndex ? ' image-viewer__thumbnail--active' : ''}`}
                            aria-label={image.alt || `image-${i + 1}`}
                            aria-current={i === currentIndex}
                        ><img src={image.src} alt={image.alt ?? ''}/></button>
                    ))}
                </div>
            )}
        </div>,
        document.body,
    );
};

export default ImageViewer;
