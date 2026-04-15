import type { Position, PositionDirection } from '../types';
import { formatTimeTW } from './time';

// PnL as a fraction (0.05 = +5%). Positive = profit for the position's direction.
export function pnlFraction(direction: PositionDirection, entry: number, current: number): number {
  if (entry <= 0) return 0;
  return direction === 'long' ? (current - entry) / entry : (entry - current) / entry;
}

// Risk/reward expressed as |TP move| / |SL move|. Returns null when SL = entry.
export function riskReward(direction: PositionDirection, entry: number, tp: number, sl: number): number | null {
  const reward = direction === 'long' ? tp - entry : entry - tp;
  const risk   = direction === 'long' ? entry - sl : sl - entry;
  if (risk <= 0) return null;
  return reward / risk;
}

export function isOpen(p: Position): boolean {
  return p.exit_ts == null;
}

const CSV_HEADERS = [
  'id', 'symbol', 'interval', 'direction',
  'entry_time', 'entry_price', 'tp_price', 'sl_price',
  'exit_time', 'exit_price', 'pnl_pct', 'rr',
  'entry_reason', 'exit_reason', 'created_at',
] as const;

function escapeCell(v: unknown): string {
  if (v == null) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function positionsToCSV(positions: Position[]): string {
  const rows = positions.map(p => {
    const pnl = p.exit_price != null
      ? pnlFraction(p.direction, p.entry_price, p.exit_price)
      : null;
    const rr = riskReward(p.direction, p.entry_price, p.tp_price, p.sl_price);
    const cells = [
      p.id,
      p.symbol,
      p.interval,
      p.direction,
      formatTimeTW(p.entry_ts / 1000),
      p.entry_price,
      p.tp_price,
      p.sl_price,
      p.exit_ts != null ? formatTimeTW(p.exit_ts / 1000) : '',
      p.exit_price ?? '',
      pnl != null ? (pnl * 100).toFixed(2) : '',
      rr != null ? rr.toFixed(2) : '',
      p.entry_reason,
      p.exit_reason,
      p.created_at,
    ];
    return cells.map(escapeCell).join(',');
  });
  return [CSV_HEADERS.join(','), ...rows].join('\n');
}

export function downloadCSV(filename: string, content: string): void {
  // Prepend BOM so Excel opens Chinese reasons correctly
  const blob = new Blob(['\ufeff' + content], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function newPositionId(): string {
  // Short random id good enough for a local practice log
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}
