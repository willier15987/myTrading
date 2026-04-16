export function getPriceDecimals(value: number): number {
  return Math.abs(value) >= 1 ? 2 : 6;
}

export function formatPrice(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '-';

  const formatted = value.toFixed(getPriceDecimals(value));
  return formatted
    .replace(/(\.\d*?[1-9])0+$/u, '$1')
    .replace(/\.0+$/u, '');
}

export function getPriceFormat(value: number): { minMove: number; precision: number } {
  const precision = getPriceDecimals(value);
  return {
    precision,
    minMove: precision === 2 ? 0.01 : 0.000001,
  };
}
