export interface IntervalResult {
  interval: string;
  added: number;
  last_ts: number | null;
  skipped?: boolean;
  reason?: string;
}

export interface LiveSyncResponse {
  symbol: string;
  fetched_at: number;
  results: IntervalResult[];
}

interface SyncLiveOptions {
  intervals?: string[];
  signal?: AbortSignal;
}

const API_BASE = '/api';

export async function syncLive(symbol: string, opts: SyncLiveOptions = {}): Promise<LiveSyncResponse> {
  const params = new URLSearchParams({ symbol });
  if (opts.intervals && opts.intervals.length > 0) {
    params.set('intervals', opts.intervals.join(','));
  }

  const response = await fetch(`${API_BASE}/live/sync?${params.toString()}`, {
    method: 'POST',
    signal: opts.signal,
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message ? `HTTP ${response.status}: ${message}` : `HTTP ${response.status}`);
  }

  return (await response.json()) as LiveSyncResponse;
}
