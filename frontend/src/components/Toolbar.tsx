import React, { useState, useRef, useEffect } from 'react';
import type { SwingThresholds, SymbolInfo } from '../types';

const INTERVALS = ['15m', '1h', '4h', '1d'] as const;
const PIVOT_N_OPTIONS = [3, 5, 8, 10] as const;

const ivBtnStyle = (active: boolean): React.CSSProperties => ({
  padding: '3px 10px',
  borderRadius: 4,
  border: 'none',
  cursor: 'pointer',
  fontSize: 13,
  background: active ? '#2962FF' : '#2a2e39',
  color: active ? '#fff' : '#d1d4dc',
});

const S: Record<string, React.CSSProperties> = {
  bar: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '6px 12px',
    background: '#1e222d',
    borderBottom: '1px solid #2a2e39',
    flexShrink: 0,
    height: 44,
    flexWrap: 'nowrap',
    overflowX: 'auto',
  },
  symbolWrap: { position: 'relative', width: 160, flexShrink: 0 },
  symbolInput: {
    width: '100%',
    background: '#2a2e39',
    border: '1px solid #363a45',
    borderRadius: 4,
    color: '#d1d4dc',
    padding: '4px 8px',
    fontSize: 13,
    outline: 'none',
  },
  dropdown: {
    position: 'absolute',
    top: '100%',
    left: 0,
    right: 0,
    background: '#1e222d',
    border: '1px solid #2a2e39',
    borderRadius: 4,
    maxHeight: 220,
    overflowY: 'auto',
    zIndex: 100,
    marginTop: 2,
  },
  dropItem: {
    padding: '5px 10px',
    cursor: 'pointer',
    fontSize: 13,
    color: '#d1d4dc',
  },
  dateInput: {
    background: '#2a2e39',
    border: '1px solid #363a45',
    borderRadius: 4,
    color: '#d1d4dc',
    padding: '4px 8px',
    fontSize: 13,
    outline: 'none',
  },
  divider: {
    width: 1,
    height: 20,
    background: '#2a2e39',
    flexShrink: 0,
  },
  label: { color: '#787b86', fontSize: 12, flexShrink: 0 },
  select: {
    background: '#2a2e39',
    border: '1px solid #363a45',
    borderRadius: 4,
    color: '#d1d4dc',
    padding: '3px 6px',
    fontSize: 13,
    outline: 'none',
    cursor: 'pointer',
  },
};

interface ToolbarProps {
  symbol: string;
  interval: string;
  symbols: SymbolInfo[];
  showSwings: boolean;
  pivotN: number;
  swingThresholds: SwingThresholds;
  showForce: boolean;
  showRanges: boolean;
  showMA: boolean;
  maLengths: number[];
  maType: 'sma' | 'ema';
  tdShow: boolean;
  tdLookback: number;
  tdSetupLength: number;
  onSymbolChange: (s: string) => void;
  onIntervalChange: (i: string) => void;
  onDateJump: (ts: number) => void;
  onToggleSwings: () => void;
  onPivotNChange: (n: number) => void;
  onSwingThresholdsChange: (t: SwingThresholds) => void;
  onToggleForce: () => void;
  onToggleRanges: () => void;
  onToggleMA: () => void;
  onMALengthsChange: (lens: number[]) => void;
  onMATypeChange: (t: 'sma' | 'ema') => void;
  onToggleTD: () => void;
  onTDLookbackChange: (n: number) => void;
  onTDSetupLengthChange: (n: number) => void;
  showLastPrice: boolean;
  onToggleLastPrice: () => void;
  autoRefresh: boolean;
  onToggleAutoRefresh: () => void;
  onOpenLong: () => void;
  onOpenShort: () => void;
}

export function Toolbar({
  symbol, interval, symbols,
  showSwings, pivotN, swingThresholds, showForce, showRanges,
  showMA, maLengths, maType, tdShow, tdLookback, tdSetupLength,
  onSymbolChange, onIntervalChange, onDateJump,
  onToggleSwings, onPivotNChange, onSwingThresholdsChange, onToggleForce, onToggleRanges,
  onToggleMA, onMALengthsChange, onMATypeChange, onToggleTD, onTDLookbackChange, onTDSetupLengthChange,
  showLastPrice, onToggleLastPrice, autoRefresh, onToggleAutoRefresh, onOpenLong, onOpenShort,
}: ToolbarProps) {
  const [query, setQuery] = useState(symbol);
  const [open, setOpen] = useState(false);
  const [maText, setMaText] = useState(maLengths.join(','));
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setMaText(maLengths.join(',')); }, [maLengths]);

  const commitMaText = () => {
    const parsed = maText
      .split(/[,\s]+/)
      .map(s => parseInt(s, 10))
      .filter(n => Number.isFinite(n) && n > 0 && n <= 1000);
    if (parsed.length > 0) onMALengthsChange(parsed);
    else setMaText(maLengths.join(','));
  };

  useEffect(() => { setQuery(symbol); }, [symbol]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery(symbol);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [symbol]);

  const filtered = query
    ? symbols.filter(s => s.symbol.toUpperCase().includes(query.toUpperCase()))
    : symbols;

  const handleSelect = (sym: string) => {
    onSymbolChange(sym);
    setQuery(sym);
    setOpen(false);
  };

  const handleDateJump = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.value) return;
    const ts = new Date(e.target.value).getTime();
    if (!isNaN(ts)) onDateJump(ts);
  };

  return (
    <div style={S.bar}>
      {/* Symbol search */}
      <div ref={wrapRef} style={S.symbolWrap}>
        <input
          style={S.symbolInput}
          value={query}
          onChange={e => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder="搜尋交易對…"
        />
        {open && filtered.length > 0 && (
          <div style={S.dropdown}>
            {filtered.slice(0, 60).map(s => (
              <div
                key={s.symbol}
                style={{ ...S.dropItem, background: s.symbol === symbol ? '#2a2e39' : undefined }}
                onMouseDown={() => handleSelect(s.symbol)}
              >
                {s.symbol}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Interval buttons */}
      <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
        {INTERVALS.map(iv => (
          <button key={iv} style={ivBtnStyle(iv === interval)} onClick={() => onIntervalChange(iv)}>
            {iv}
          </button>
        ))}
      </div>

      {/* Date jump */}
      <span style={S.label}>跳轉</span>
      <input type="datetime-local" style={S.dateInput} onChange={handleDateJump} />

      <div style={S.divider} />

      {/* Swing toggle */}
      <button
        style={ivBtnStyle(showSwings)}
        onClick={onToggleSwings}
        title="顯示/隱藏自動波段偵測"
      >
        波段
      </button>

      {/* Pivot N + swing validity thresholds — only when swings are on */}
      {showSwings && (
        <>
          <span style={S.label}>N=</span>
          <select
            style={S.select}
            value={pivotN}
            onChange={e => onPivotNChange(Number(e.target.value))}
            title="左右各看幾根 K 線確認高低點"
          >
            {PIVOT_N_OPTIONS.map(n => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
          <span style={S.label} title="推進段 force_ratio 門檻（愈大愈嚴）">推</span>
          <input
            type="number" step={0.05} min={0} max={1}
            style={{ ...S.dateInput, width: 56 }}
            value={swingThresholds.approach}
            onChange={e => {
              const v = parseFloat(e.target.value);
              if (Number.isFinite(v) && v >= 0 && v <= 1) onSwingThresholdsChange({ ...swingThresholds, approach: v });
            }}
          />
          <span style={S.label} title="反轉段 force_ratio 門檻（愈大愈嚴）">反</span>
          <input
            type="number" step={0.05} min={0} max={1}
            style={{ ...S.dateInput, width: 56 }}
            value={swingThresholds.rejection}
            onChange={e => {
              const v = parseFloat(e.target.value);
              if (Number.isFinite(v) && v >= 0 && v <= 1) onSwingThresholdsChange({ ...swingThresholds, rejection: v });
            }}
          />
          <span style={S.label} title="離場距離需超過 N × ATR">ATR×</span>
          <input
            type="number" step={0.1} min={0} max={5}
            style={{ ...S.dateInput, width: 56 }}
            value={swingThresholds.departureAtr}
            onChange={e => {
              const v = parseFloat(e.target.value);
              if (Number.isFinite(v) && v >= 0 && v <= 5) onSwingThresholdsChange({ ...swingThresholds, departureAtr: v });
            }}
          />
        </>
      )}

      <div style={S.divider} />

      {/* Force sub-chart toggle */}
      <button
        style={ivBtnStyle(showForce)}
        onClick={onToggleForce}
        title="顯示/隱藏力道分析子圖（force_ratio + 位移效率）"
      >
        力道
      </button>

      {/* Range overlay toggle */}
      <button
        style={ivBtnStyle(showRanges)}
        onClick={onToggleRanges}
        title="顯示/隱藏橫盤整理偵測"
      >
        橫盤
      </button>

      <div style={S.divider} />

      {/* MA toggle */}
      <button
        style={ivBtnStyle(showMA)}
        onClick={onToggleMA}
        title="顯示/隱藏移動平均線"
      >
        均線
      </button>

      {showMA && (
        <>
          <select
            style={S.select}
            value={maType}
            onChange={e => onMATypeChange(e.target.value as 'sma' | 'ema')}
            title="簡單移動平均 vs 指數移動平均"
          >
            <option value="sma">SMA</option>
            <option value="ema">EMA</option>
          </select>
          <span style={S.label}>長度</span>
          <input
            style={{ ...S.dateInput, width: 120 }}
            value={maText}
            onChange={e => setMaText(e.target.value)}
            onBlur={commitMaText}
            onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
            placeholder="20,60,200"
            title="逗號分隔；例：20,60,200"
          />
        </>
      )}

      <div style={S.divider} />

      {/* TD toggle */}
      <button
        style={ivBtnStyle(tdShow)}
        onClick={onToggleTD}
        title="顯示/隱藏 TD Sequential Setup"
      >
        TD
      </button>

      {tdShow && (
        <>
          <span style={S.label}>比對</span>
          <input
            type="number"
            min={1}
            max={20}
            style={{ ...S.dateInput, width: 52 }}
            value={tdLookback}
            onChange={e => {
              const n = parseInt(e.target.value, 10);
              if (Number.isFinite(n) && n >= 1 && n <= 20) onTDLookbackChange(n);
            }}
            title="與前 N 根比較（標準 4）"
          />
          <span style={S.label}>長度</span>
          <input
            type="number"
            min={3}
            max={30}
            style={{ ...S.dateInput, width: 52 }}
            value={tdSetupLength}
            onChange={e => {
              const n = parseInt(e.target.value, 10);
              if (Number.isFinite(n) && n >= 3 && n <= 30) onTDSetupLengthChange(n);
            }}
            title="Setup 完成所需連續根數（標準 9）"
          />
        </>
      )}

      <div style={S.divider} />

      {/* Last-price line toggle */}
      <button
        style={ivBtnStyle(showLastPrice)}
        onClick={onToggleLastPrice}
        title="顯示/隱藏最新價格水平線"
      >
        現價線
      </button>

      {/* Auto-refresh toggle */}
      <button
        style={ivBtnStyle(autoRefresh)}
        onClick={onToggleAutoRefresh}
        title="開啟/關閉自動更新最新 K 線 (30 秒)"
      >
        自動更新
      </button>

      <div style={S.divider} />

      {/* Open long / short buttons */}
      <button
        style={{
          padding: '3px 12px', borderRadius: 4, border: 'none', cursor: 'pointer',
          fontSize: 13, background: '#26a69a', color: '#fff', fontWeight: 600, flexShrink: 0,
        }}
        onClick={onOpenLong}
        title="開多頭倉位 (快捷鍵 P)"
      >
        開多 P
      </button>
      <button
        style={{
          padding: '3px 12px', borderRadius: 4, border: 'none', cursor: 'pointer',
          fontSize: 13, background: '#ef5350', color: '#fff', fontWeight: 600, flexShrink: 0,
        }}
        onClick={onOpenShort}
        title="開空頭倉位 (快捷鍵 O)"
      >
        開空 O
      </button>
    </div>
  );
}
