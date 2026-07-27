import React from 'react';
import './LoadingIndicator.css';

interface LoadingIndicatorProps {
    progress?: number;   // 0~100, 0이면 일반 채팅 로딩
    message?: string;
    isImageMode?: boolean;
}

const LoadingIndicator: React.FC<LoadingIndicatorProps> = ({progress = 0, message = '', isImageMode = false}) => {
    const isImageGen = isImageMode || progress > 0;
    const displayProgress = isImageGen && progress === 0 ? 3 : progress;
    const hasMessage = !isImageGen && message;

    return (
        <div className="msg bot">
            <div className="msg-bubble">
                {isImageGen ? (
                    <div className="image-gen-progress">
                        <div className="progress-label">{message || '이미지 생성 중...'}</div>
                        <div className="progress-bar-wrap">
                            <div className="progress-bar-fill" style={{width: `${displayProgress}%`}}/>
                        </div>
                        <div className="progress-pct">{displayProgress}%</div>
                    </div>
                ) : hasMessage ? (
                    <div className="analyze-progress">
                        <span className="analyze-spinner"/>
                        <span className="analyze-text">{message}</span>
                    </div>
                ) : (
                    <div className="typing">
                        <span></span><span></span><span></span>
                    </div>
                )}
            </div>
        </div>
    );
};

export default LoadingIndicator;