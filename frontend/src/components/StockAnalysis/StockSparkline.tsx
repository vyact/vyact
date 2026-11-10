export default function StockSparkline({closes, change}: {closes?: number[]; change?: number | null}) {
    if (!closes || closes.length < 2) return <span className="stock-sparkline" aria-hidden="true"/>;
    const low = Math.min(...closes);
    const range = Math.max(...closes) - low;
    const points = closes.map((close, index) => `${2 + index / (closes.length - 1) * 76},${range ? 26 - (close - low) / range * 24 : 14}`).join(' ');
    return <svg className="stock-sparkline" data-direction={change == null || change === 0 ? 'flat' : change > 0 ? 'up' : 'down'} viewBox="0 0 80 28" preserveAspectRatio="none" aria-hidden="true">
        <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>;
}
