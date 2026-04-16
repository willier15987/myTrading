import React from 'react';
import type { Position } from '../types';
import { isOpen, pnlFraction, riskReward, positionsToCSV, downloadCSV } from '../utils/positions';
import { formatPrice } from '../utils/price';
import { type AppTimeZone, formatChartTime } from '../utils/time';
import { useLocalStorage } from '../utils/useLocalStorage';

const C = {
  bg: '#1e222d',
  border: '#2a2e39',
  text: '#d1d4dc',
  dim: '#787b86',
  green: '#26a69a',
  red: '#ef5350',
};

const S: Record<string, React.CSSProperties> = {
  panel: {
    width: 260,
    minWidth: 260,
    background: C.bg,
    borderLeft: `1px solid ${C.border}`,
    display: 'flex',
    flexDirection: 'column',
    flexShrink: 0,
    overflow: 'hidden',
  },
  header: {
    padding: '10px 12px',
    borderBottom: `1px solid ${C.border}`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: { fontSize: 12, color: C.dim, textTransform: 'uppercase' as const, letterSpacing: 1, fontWeight: 600 },
  btnSmall: {
    padding: '3px 8px', borderRadius: 3, border: `1px solid ${C.border}`,
    background: 'transparent', color: C.text, fontSize: 11, cursor: 'pointer',
  },
  list: { flex: 1, overflowY: 'auto' as const },
  item: { padding: '10px 12px', borderBottom: `1px solid ${C.border}`, fontSize: 12 },
  rowBetween: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  kv: { display: 'flex', justifyContent: 'space-between', color: C.dim, fontSize: 11, lineHeight: 1.55 },
  kvVal: { color: C.text, fontFamily: 'monospace' as const },
  tag: { padding: '1px 6px', borderRadius: 3, fontSize: 10, fontWeight: 600 },
  placeholder: { padding: '32px 16px', color: C.dim, textAlign: 'center' as const, lineHeight: 1.8, fontSize: 12 },
  actions: { display: 'flex', gap: 6, marginTop: 6 },
  actionBtn: {
    padding: '3px 8px', borderRadius: 3, border: 'none',
    fontSize: 11, cursor: 'pointer',
  },
  shortcut: { color: C.dim, fontSize: 10, marginTop: 6 },
};

interface Props {
  symbol: string;
  interval: string;
  timezone: AppTimeZone;
  positions: Position[];
  currentPrice: number | null;
  onRequestClose: (position: Position) => void;
  onDelete: (id: string) => void;
}

export function PositionPanel({ symbol, interval, timezone, positions, currentPrice, onRequestClose, onDelete }: Props) {
  const [collapsed, setCollapsed] = useLocalStorage<boolean>('positionPanelCollapsed', false);
  const visible = positions
    .filter(p => p.symbol === symbol && p.interval === interval)
    .sort((a, b) => b.entry_ts - a.entry_ts);

  if (collapsed) {
    return (
      <div style={{
        width: 24, minWidth: 24, background: C.bg, borderLeft: `1px solid ${C.border}`,
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        cursor: 'pointer', flexShrink: 0, paddingTop: 10,
      }} onClick={() => setCollapsed(false)} title="展開倉位側欄">
        <span style={{ color: C.dim, fontSize: 14, writingMode: 'vertical-rl' as const }}>◀ 倉位 ({visible.length})</span>
      </div>
    );
  }

  const handleExport = () => {
    if (positions.length === 0) return;
    const csv = positionsToCSV(positions, timezone);
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    downloadCSV(`positions-${stamp}.csv`, csv);
  };

  return (
    <div style={S.panel}>
      <div style={S.header}>
        <span style={S.title}>倉位 ({visible.length})</span>
        <div style={{ display: 'flex', gap: 6 }}>
          <button style={S.btnSmall} onClick={handleExport} disabled={positions.length === 0}
            title="匯出所有倉位 (包含其他商品/週期)">
            匯出 CSV
          </button>
          <button style={S.btnSmall} onClick={() => setCollapsed(true)} title="收起">▶</button>
        </div>
      </div>

      {visible.length === 0 ? (
        <div style={S.placeholder}>
          尚無倉位<br />
          <small>P 開多 &nbsp; O 開空</small>
        </div>
      ) : (
        <div style={S.list}>
          {visible.map(p => {
            const open = isOpen(p);
            const dirColor = p.direction === 'long' ? C.green : C.red;
            const refPrice = open ? currentPrice : p.exit_price;
            const pnl = refPrice != null ? pnlFraction(p.direction, p.entry_price, refPrice) : null;
            const pnlColor = pnl == null ? C.dim : pnl >= 0 ? C.green : C.red;
            const rr = riskReward(p.direction, p.entry_price, p.tp_price, p.sl_price);

            return (
              <div key={p.id} style={S.item}>
                <div style={S.rowBetween}>
                  <span style={{ ...S.tag, background: dirColor, color: '#fff' }}>
                    {p.direction === 'long' ? '多頭' : '空頭'}
                  </span>
                  <span style={{ ...S.tag, background: open ? '#2a2e39' : '#151821', color: open ? '#FFC107' : C.dim }}>
                    {open ? '持倉中' : '已平倉'}
                  </span>
                </div>

                <div style={S.kv}><span>進場</span><span style={S.kvVal}>{formatChartTime(p.entry_ts / 1000, timezone)}</span></div>
                <div style={S.kv}><span>進場價</span><span style={S.kvVal}>{formatPrice(p.entry_price)}</span></div>
                <div style={S.kv}><span>TP / SL</span><span style={S.kvVal}>{formatPrice(p.tp_price)} / {formatPrice(p.sl_price)}</span></div>
                {rr != null && (
                  <div style={S.kv}><span>R/R</span><span style={S.kvVal}>{rr.toFixed(2)}</span></div>
                )}
                {!open && (
                  <>
                    <div style={S.kv}><span>出場</span><span style={S.kvVal}>{p.exit_ts != null ? formatChartTime(p.exit_ts / 1000, timezone) : '-'}</span></div>
                    <div style={S.kv}><span>出場價</span><span style={S.kvVal}>{formatPrice(p.exit_price)}</span></div>
                  </>
                )}
                <div style={S.kv}>
                  <span>{open ? '浮動 PnL' : 'PnL'}</span>
                  <span style={{ ...S.kvVal, color: pnlColor, fontWeight: 600 }}>
                    {pnl != null ? `${(pnl * 100).toFixed(2)}%` : '-'}
                  </span>
                </div>

                <div style={S.actions}>
                  {open && (
                    <button
                      style={{ ...S.actionBtn, background: dirColor, color: '#fff' }}
                      onClick={() => onRequestClose(p)}
                    >
                      平倉
                    </button>
                  )}
                  <button
                    style={{ ...S.actionBtn, background: 'transparent', color: C.dim, border: `1px solid ${C.border}` }}
                    onClick={() => { if (confirm('刪除此倉位紀錄？')) onDelete(p.id); }}
                  >
                    刪除
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
