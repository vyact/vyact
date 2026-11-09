import type {IChartApi, ISeriesApi, ISeriesPrimitive, IPrimitivePaneView} from 'lightweight-charts';

type BandPoint = {time: string; upper: number | null; lower: number | null};

/** Draw between two series in the bottom layer so candles and grid remain legible. */
export function attachBandFill(chart: IChartApi, series: ISeriesApi<'Candlestick'>, points: BandPoint[], colors: {positive: string; negative: string}) {
    const view: IPrimitivePaneView = {
        zOrder: () => 'bottom',
        renderer: () => ({
            draw(target) {
                target.useMediaCoordinateSpace(({context, mediaSize}) => {
                    context.save();
                    for (let i = 1; i < points.length; i++) {
                        const previous = points[i - 1], current = points[i];
                        if (previous.upper === null || previous.lower === null || current.upper === null || current.lower === null) continue;
                        const x1 = chart.timeScale().timeToCoordinate(previous.time), x2 = chart.timeScale().timeToCoordinate(current.time);
                        const a1 = series.priceToCoordinate(previous.upper), b1 = series.priceToCoordinate(previous.lower);
                        const a2 = series.priceToCoordinate(current.upper), b2 = series.priceToCoordinate(current.lower);
                        if (x1 === null || x2 === null || a1 === null || b1 === null || a2 === null || b2 === null) continue;
                        if (x2 < 0 || x1 > mediaSize.width) continue;
                        const fill = (vertices: number[][], positive: boolean) => {
                            context.fillStyle = positive ? colors.positive : colors.negative;
                            context.beginPath();
                            vertices.forEach(([x, y], index) => index ? context.lineTo(x, y) : context.moveTo(x, y));
                            context.closePath(); context.fill();
                        };
                        const d1 = previous.upper - previous.lower, d2 = current.upper - current.lower;
                        if (d1 * d2 < 0) {
                            const fraction = d1 / (d1 - d2);
                            const x = x1 + (x2 - x1) * fraction, y = a1 + (a2 - a1) * fraction;
                            fill([[x1, a1], [x, y], [x1, b1]], d1 >= 0);
                            fill([[x, y], [x2, a2], [x2, b2]], d2 >= 0);
                        } else fill([[x1, a1], [x2, a2], [x2, b2], [x1, b1]], d1 + d2 >= 0);
                    }
                    context.restore();
                });
            },
        }),
    };
    const primitive: ISeriesPrimitive = {paneViews: () => [view]};
    series.attachPrimitive(primitive);
    return (nextPoints: BandPoint[]) => {points = nextPoints;};
}
