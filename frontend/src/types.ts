export interface Candle {
  t: number; // timestamp ms
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export type LabelType =
  | 'bull_dominance'
  | 'bear_dominance'
  | 'force_shift'
  | 'valid_swing_high'
  | 'valid_swing_low';

export interface Mark {
  id: number;
  symbol: string;
  interval: string;
  timestamp: number; // ms
  label_type: LabelType;
  price: number | null;
  note: string | null;
  indicators: IndicatorSnapshot | null;
  created_at: string;
}

export interface IndicatorSnapshot {
  atr_14?: number;
  candle_quality?: CandleQuality;
  force_analysis_lookback_20?: ForceAnalysis;
  displacement_efficiency_lookback_20?: number;
}

export interface CandleQuality {
  body_ratio: number;
  displacement: number;
  direction: number;
  body: number;
  range: number;
}

export interface ForceAnalysis {
  bull_avg_force: number;
  bear_avg_force: number;
  force_ratio: number;
  count_ratio: number;
  quality_ratio: number;
  bull_count?: number;
  bear_count?: number;
}

export interface CandleIndicators extends CandleQuality {
  atr: number;
}

export interface RangeIndicators {
  candle_count: number;
  force_analysis: ForceAnalysis;
  displacement_efficiency: number;
  atr: number;
}

export interface SymbolInfo {
  symbol: string;
  intervals: IntervalInfo[];
}

export interface IntervalInfo {
  interval: string;
  start_ts: number;
  end_ts: number;
  count: number;
}

export interface SwingPoint {
  timestamp: number; // ms
  type: 'high' | 'low';
  price: number;
  is_valid: boolean;
  details: {
    approach_force_ratio: number;
    rejection_force_ratio: number;
    departure_atr_multiple: number;
    conditions: boolean[];
  };
}

export interface IndicatorPoint {
  t: number; // ms
  force_ratio: number;
  count_ratio: number;
  quality_ratio: number;
  displacement_efficiency: number;
}

export interface DetectedRange {
  start_ts: number; // ms
  end_ts: number;   // ms
  upper: number;
  lower: number;
  bar_count: number;
  avg_efficiency: number;
  is_active: boolean;
}

export interface MAConfig {
  length: number;
  color: string;
}

export interface TDConfig {
  show: boolean;
  lookback: number;
  setupLength: number;
}

export interface SwingThresholds {
  approach: number;
  rejection: number;
  departureAtr: number;
}

export type PositionDirection = 'long' | 'short';

export interface Position {
  id: string;
  symbol: string;
  interval: string;
  direction: PositionDirection;
  entry_ts: number;            // ms
  entry_price: number;
  tp_price: number;
  sl_price: number;
  exit_ts: number | null;
  exit_price: number | null;
  entry_reason: string;
  exit_reason: string;
  created_at: string;          // ISO
}

export const MA_COLOR_PALETTE = [
  '#2962FF', '#FF9800', '#E91E63', '#00BCD4', '#8BC34A', '#FFEB3B', '#9C27B0', '#F44336',
];

export const LABEL_META: Record<LabelType, { label: string; color: string; shortcut: string }> = {
  bull_dominance:  { label: '多方主導', color: '#26a69a', shortcut: '1' },
  bear_dominance:  { label: '空方主導', color: '#ef5350', shortcut: '2' },
  force_shift:     { label: '力道轉換', color: '#FFC107', shortcut: '3' },
  valid_swing_high:{ label: '有效前高', color: '#ef5350', shortcut: 'H' },
  valid_swing_low: { label: '有效前低', color: '#26a69a', shortcut: 'L' },
};
