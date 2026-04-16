import React, { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { Candle, CandleIndicators, LabelType, Mark, RangeIndicators } from '../types';
import { LABEL_META } from '../types';
import { type AppTimeZone, formatDateTime } from '../utils/time';
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
    width: 300,
    minWidth: 300,
    background: C.bg,
    borderLeft: `1px solid ${C.border}`,
    display: 'flex',
    flexDirection: 'column',
    overflowY: 'auto',
    flexShrink: 0,
  },
  section: { borderBottom: `1px solid ${C.border}`, padding: '10px 12px' },
  sectionTitle: {
    fontSize: 11,
    color: C.dim,
    textTransform: 'uppercase' as const,
    letterSpacing: 1,
    marginBottom: 8,
    fontWeight: 600,
  },
  row: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  label: { color: C.dim, fontSize: 12 },
  value: { color: C.text, fontSize: 12, fontFamily: 'monospace' },
  placeholder: { padding: '32px 16px', color: C.dim, textAlign: 'center' as const, lineHeight: '1.8' },
};

const INTERVAL_MS: Record<string, number> = {
  '15m': 15 * 60 * 1000,
  '1h': 60 * 60 * 1000,
  '4h': 4 * 60 * 60 * 1000,
  '1d': 24 * 60 * 60 * 1000,
};
const LOOKBACK = 20;

function nc(v: number, lo: number, hi: number, invert = false): string {
  const bull = invert ? v <= lo : v >= hi;
  const bear = invert ? v >= hi : v <= lo;
  if (bull) return C.green;
  if (bear) return C.red;
  return C.text;
}

function KV({ k, v, color }: { k: string; v: string | number; color?: string }) {
  const display = typeof v === 'number' ? (Number.isInteger(v) ? v.toString() : v.toFixed(4)) : v;
  return (
    <div style={S.row}>
      <span style={S.label}>{k}</span>
      <span style={{ ...S.value, color: color ?? C.text }}>{display}</span>
    </div>
  );
}

interface MarkPanelProps {
  symbol: string;
  interval: string;
  timezone: AppTimeZone;
  selectedCandle: Candle | null;
  rangeStart: Candle | null;
  rangeEnd: Candle | null;
  marks: Mark[];
  onAddMark: (labelType: LabelType, price?: number) => void;
  onDeleteMark: (id: number) => void;
}

export function MarkPanel({ symbol, interval, timezone, selectedCandle, rangeStart, rangeEnd, marks, onAddMark, onDeleteMark }: MarkPanelProps) {
  const [candleInd, setCandleInd] = useState<CandleIndicators | null>(null);
  const [rangeInd, setRangeInd] = useState<RangeIndicators | null>(null);
  const [loadingC, setLoadingC] = useState(false);
  const [loadingR, setLoadingR] = useState(false);
  const [collapsed, setCollapsed] = useLocalStorage<boolean>('markPanelCollapsed', false);

  // Single-candle indicators
  useEffect(() => {
    if (!selectedCandle) { setCandleInd(null); return; }
    let alive = true;
    setLoadingC(true);
    api.getCandleIndicators(symbol, interval, selectedCandle.t)
      .then(d => { if (alive) setCandleInd(d); })
      .catch(() => { if (alive) setCandleInd(null); })
      .finally(() => { if (alive) setLoadingC(false); });
    return () => { alive = false; };
  }, [selectedCandle?.t, symbol, interval]);

  // Range/lookback indicators
  useEffect(() => {
    let alive = true;
    setLoadingR(true);

    if (rangeStart && rangeEnd) {
      // Explicit range selection
      api.getRangeIndicators(symbol, interval, rangeStart.t, rangeEnd.t)
        .then(d => { if (alive) setRangeInd(d); })
        .catch(() => { if (alive) setRangeInd(null); })
        .finally(() => { if (alive) setLoadingR(false); });
    } else if (selectedCandle) {
      // Lookback-20 from selected candle
      const step = INTERVAL_MS[interval] ?? INTERVAL_MS['1h'];
      const startTs = selectedCandle.t - (LOOKBACK - 1) * step;
      api.getRangeIndicators(symbol, interval, startTs, selectedCandle.t)
        .then(d => { if (alive) setRangeInd(d); })
        .catch(() => { if (alive) setRangeInd(null); })
        .finally(() => { if (alive) setLoadingR(false); });
    } else {
      setRangeInd(null);
      setLoadingR(false);
    }
    return () => { alive = false; };
  }, [selectedCandle?.t, rangeStart?.t, rangeEnd?.t, symbol, interval]);

  if (collapsed) {
    return (
      <div style={{
        width: 24, minWidth: 24, background: C.bg, borderLeft: `1px solid ${C.border}`,
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        cursor: 'pointer', flexShrink: 0, paddingTop: 10,
      }} onClick={() => setCollapsed(false)} title="展開標記側欄">
        <span style={{ color: C.dim, fontSize: 14, writingMode: 'vertical-rl' as const }}>◀ 標記</span>
      </div>
    );
  }

  const collapseBtn = (
    <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '4px 8px', borderBottom: `1px solid ${C.border}` }}>
      <button
        onClick={() => setCollapsed(true)}
        style={{ background: 'transparent', border: 'none', color: C.dim, cursor: 'pointer', fontSize: 12, padding: '2px 6px' }}
        title="收起"
      >▶</button>
    </div>
  );

  if (!selectedCandle && !rangeStart) {
    return (
      <div style={S.panel}>
        {collapseBtn}
        <div style={S.placeholder}>
          點擊 K 線查看指標<br />
          <small>Shift + 點擊 設定區間起點</small><br />
          <small style={{ fontSize: 10 }}>
            1 多方主導 &nbsp;2 空方主導 &nbsp;3 力道轉換<br />
            H 有效前高 &nbsp;L 有效前低 &nbsp;Delete 刪除
          </small>
        </div>
      </div>
    );
  }

  const candleMarks = selectedCandle ? marks.filter(m => m.timestamp === selectedCandle.t) : [];

  return (
    <div style={S.panel}>
      {collapseBtn}

      {/* ── Candle Info ── */}
      {selectedCandle && (
        <div style={S.section}>
          <div style={S.sectionTitle}>K 線資訊</div>
          <div style={{ color: C.dim, fontSize: 11, marginBottom: 6 }}>
            {formatDateTime(selectedCandle.t, timezone)}
          </div>
          <KV k="開 Open"  v={selectedCandle.o} />
          <KV k="高 High"  v={selectedCandle.h} color={C.green} />
          <KV k="低 Low"   v={selectedCandle.l} color={C.red} />
          <KV k="收 Close" v={selectedCandle.c} color={selectedCandle.c >= selectedCandle.o ? C.green : C.red} />
          <KV k="量 Volume" v={selectedCandle.v.toFixed(2)} />
        </div>
      )}

      {/* ── Range Selection ── */}
      {rangeStart && (
        <div style={{ ...S.section, background: 'rgba(41,98,255,0.08)' }}>
          <div style={S.sectionTitle}>區間框選</div>
          <KV k="起點" v={formatDateTime(rangeStart.t, timezone)} />
          <KV k="終點" v={rangeEnd ? formatDateTime(rangeEnd.t, timezone) : '再次 Shift+點擊'} />
        </div>
      )}

      {/* ── Single-candle quality ── */}
      {selectedCandle && (
        <div style={S.section}>
          <div style={S.sectionTitle}>單根 K 線品質</div>
          {loadingC ? (
            <div style={{ color: C.dim, fontSize: 12 }}>計算中…</div>
          ) : candleInd ? (
            <>
              <KV k="body_ratio"   v={candleInd.body_ratio}   color={nc(candleInd.body_ratio, 0.35, 0.65)} />
              <KV k="displacement" v={candleInd.displacement} color={nc(candleInd.displacement, 0.3, 0.8)} />
              <KV k="direction"
                v={candleInd.direction === 1 ? '▲ 陽線' : candleInd.direction === -1 ? '▼ 陰線' : '— 十字'}
                color={candleInd.direction === 1 ? C.green : candleInd.direction === -1 ? C.red : C.dim}
              />
              <KV k="body"  v={candleInd.body} />
              <KV k="range" v={candleInd.range} />
              <KV k="ATR-14" v={candleInd.atr} />
            </>
          ) : (
            <div style={{ color: C.dim, fontSize: 12 }}>無法取得</div>
          )}
        </div>
      )}

      {/* ── Force analysis ── */}
      <div style={S.section}>
        <div style={S.sectionTitle}>
          {rangeStart && rangeEnd ? '區間力道分析' : `回看 ${LOOKBACK} 根力道分析`}
        </div>
        {loadingR ? (
          <div style={{ color: C.dim, fontSize: 12 }}>計算中…</div>
        ) : rangeInd ? (
          <>
            <KV k="K 線數"        v={rangeInd.candle_count} />
            <KV k="force_ratio"   v={rangeInd.force_analysis.force_ratio}  color={nc(rangeInd.force_analysis.force_ratio, 0.4, 0.6)} />
            <KV k="count_ratio"   v={rangeInd.force_analysis.count_ratio}  color={nc(rangeInd.force_analysis.count_ratio, 0.4, 0.6)} />
            <KV k="quality_ratio" v={rangeInd.force_analysis.quality_ratio} color={rangeInd.force_analysis.quality_ratio >= 1 ? C.green : C.red} />
            <KV k="bull_avg"      v={rangeInd.force_analysis.bull_avg_force} color={C.green} />
            <KV k="bear_avg"      v={rangeInd.force_analysis.bear_avg_force} color={C.red} />
            {rangeInd.force_analysis.bull_count != null && (
              <KV k="bull/bear count"
                v={`${rangeInd.force_analysis.bull_count} / ${rangeInd.force_analysis.bear_count}`}
              />
            )}
            <div style={{ height: 6 }} />
            <KV k="位移效率 disp_eff" v={rangeInd.displacement_efficiency} color={nc(rangeInd.displacement_efficiency, 0.2, 0.4)} />
            <KV k="ATR-14"           v={rangeInd.atr} />
          </>
        ) : (
          <div style={{ color: C.dim, fontSize: 12 }}>無法取得</div>
        )}
      </div>

      {/* ── Add mark buttons ── */}
      {selectedCandle && (
        <div style={S.section}>
          <div style={S.sectionTitle}>新增標記</div>
          <div style={{ display: 'flex', flexWrap: 'wrap' as const, gap: 5 }}>
            {(Object.entries(LABEL_META) as [LabelType, (typeof LABEL_META)[LabelType]][]).map(([type, meta]) => (
              <button
                key={type}
                onClick={() => {
                  const price =
                    type === 'valid_swing_high' ? selectedCandle.h :
                    type === 'valid_swing_low'  ? selectedCandle.l :
                    undefined;
                  onAddMark(type, price);
                }}
                style={{
                  padding: '4px 9px',
                  borderRadius: 4,
                  border: `1px solid ${meta.color}`,
                  background: 'transparent',
                  color: meta.color,
                  fontSize: 12,
                  cursor: 'pointer',
                }}
                title={`快捷鍵: ${meta.shortcut}`}
              >
                [{meta.shortcut}] {meta.label}
              </button>
            ))}
          </div>
          <div style={{ color: C.dim, fontSize: 11, marginTop: 8 }}>Delete 刪除此點標記 &nbsp;|&nbsp; ESC 取消選擇</div>
        </div>
      )}

      {/* ── Existing marks on this candle ── */}
      {candleMarks.length > 0 && (
        <div style={S.section}>
          <div style={S.sectionTitle}>此點標記 ({candleMarks.length})</div>
          {candleMarks.map(m => (
            <div key={m.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
              <div>
                <div style={{ color: LABEL_META[m.label_type]?.color ?? C.text, fontSize: 12, fontWeight: 600 }}>
                  {LABEL_META[m.label_type]?.label ?? m.label_type}
                </div>
                {m.note && <div style={{ color: C.dim, fontSize: 11, marginTop: 2 }}>{m.note}</div>}
              </div>
              <button
                onClick={() => onDeleteMark(m.id)}
                style={{ background: 'transparent', border: 'none', color: C.red, cursor: 'pointer', fontSize: 16, padding: 0, lineHeight: 1 }}
                title="刪除"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

    </div>
  );
}
