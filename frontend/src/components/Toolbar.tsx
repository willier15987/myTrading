import React, { useState, useRef, useEffect } from 'react';
import type { SymbolInfo } from '../types';

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
  showForce: boolean;
  showRanges: boolean;
  onSymbolChange: (s: string) => void;
  onIntervalChange: (i: string) => void;
  onDateJump: (ts: number) => void;
  onToggleSwings: () => void;
  onPivotNChange: (n: number) => void;
  onToggleForce: () => void;
  onToggleRanges: () => void;
}

export function Toolbar({
  symbol, interval, symbols,
  showSwings, pivotN, showForce, showRanges,
  onSymbolChange, onIntervalChange, onDateJump,
  onToggleSwings, onPivotNChange, onToggleForce, onToggleRanges,
}: ToolbarProps) {
  const [query, setQuery] = useState(symbol);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

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

      {/* Pivot N selector — only when swings are on */}
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
    </div>
  );
}
