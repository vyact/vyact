import type {PriceFormatCustom} from 'lightweight-charts';

export function chartPriceFormat(locale: string | undefined, precision = 2): PriceFormatCustom {
    const number = new Intl.NumberFormat(locale, {
        useGrouping: true, minimumFractionDigits: precision, maximumFractionDigits: precision,
    });
    return {type: 'custom', minMove: 10 ** -precision, formatter: value => number.format(value)};
}
