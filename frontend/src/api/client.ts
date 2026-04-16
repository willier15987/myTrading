import type {
  Candle,
  CandleIndicators,
  DetectedRange,
  IndicatorPoint,
  LabelType,
  Mark,
  RangeIndicators,
  SwingPoint,
  SymbolInfo,
} from '../types';

const BASE = '/api';

async function _get<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  return (await res.json()) as T;
}

async function _post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  return (await res.json()) as T;
}

async function _delete<T>(url: string): Promise<T> {
  const res = await fetch(url, { method: 'DELETE' });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  return (await res.json()) as T;
}

async function _patch<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  return (await res.json()) as T;
}

export const api = {
  getSymbols: (): Promise<SymbolInfo[]> =>
    _get(`${BASE}/symbols`),

  getKlines: (
    symbol: string,
    interval: string,
    opts?: { start?: number; end?: number; limit?: number }
  ): Promise<{ symbol: string; interval: string; candles: Candle[] }> => {
    const p = new URLSearchParams({ symbol, interval });
    if (opts?.start != null) p.set('start', String(opts.start));
    if (opts?.end   != null) p.set('end',   String(opts.end));
    if (opts?.limit != null) p.set('limit', String(opts.limit));
    return _get(`${BASE}/klines?${p}`);
  },

  getCandleIndicators: (
    symbol: string,
    interval: string,
    timestamp: number
  ): Promise<CandleIndicators> =>
    _post(`${BASE}/indicators/candle`, { symbol, interval, timestamp }),

  getRangeIndicators: (
    symbol: string,
    interval: string,
    startTs: number,
    endTs: number
  ): Promise<RangeIndicators> =>
    _post(`${BASE}/indicators/range`, { symbol, interval, start_ts: startTs, end_ts: endTs }),

  getMarks: (symbol: string, interval: string): Promise<Mark[]> =>
    _get(`${BASE}/marks?symbol=${symbol}&interval=${interval}`),

  createMark: (data: {
    symbol: string;
    interval: string;
    timestamp: number;
    label_type: LabelType;
    price?: number;
    note?: string;
  }): Promise<Mark> =>
    _post(`${BASE}/marks`, data),

  deleteMark: (id: number): Promise<{ deleted: boolean; id: number }> =>
    _delete(`${BASE}/marks/${id}`),

  patchMark: (id: number, note: string): Promise<Mark> =>
    _patch(`${BASE}/marks/${id}`, { note }),

  getSwings: (
    symbol: string,
    interval: string,
    pivotN: number = 5,
    limit: number = 500,
    thresholds?: { approach?: number; rejection?: number; departureAtr?: number },
    opts?: { end?: number },
  ): Promise<SwingPoint[]> => {
    const p = new URLSearchParams({
      symbol, interval,
      pivot_n: String(pivotN),
      limit: String(limit),
    });
    if (thresholds?.approach     != null) p.set('approach',      String(thresholds.approach));
    if (thresholds?.rejection    != null) p.set('rejection',     String(thresholds.rejection));
    if (thresholds?.departureAtr != null) p.set('departure_atr', String(thresholds.departureAtr));
    if (opts?.end != null) p.set('end', String(opts.end));
    return _get(`${BASE}/swings?${p}`);
  },

  getIndicatorSeries: (
    symbol: string,
    interval: string,
    lookback: number = 20,
    limit: number = 500,
    opts?: { end?: number },
  ): Promise<{ series: IndicatorPoint[] }> => {
    const p = new URLSearchParams({ symbol, interval, lookback: String(lookback), limit: String(limit) });
    if (opts?.end != null) p.set('end', String(opts.end));
    return _get(`${BASE}/indicators/series?${p}`);
  },

  getRanges: (
    symbol: string,
    interval: string,
    opts?: { min_bars?: number; eff_threshold?: number; lookback?: number; end?: number },
  ): Promise<DetectedRange[]> => {
    const p = new URLSearchParams({ symbol, interval });
    if (opts?.min_bars      != null) p.set('min_bars',      String(opts.min_bars));
    if (opts?.eff_threshold != null) p.set('eff_threshold', String(opts.eff_threshold));
    if (opts?.lookback      != null) p.set('lookback',      String(opts.lookback));
    if (opts?.end           != null) p.set('end',           String(opts.end));
    return _get(`${BASE}/ranges?${p}`);
  },
};
