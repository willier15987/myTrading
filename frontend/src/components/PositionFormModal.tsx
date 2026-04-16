import React, { useEffect, useState } from 'react';
import type { PositionDirection, Position } from '../types';
import { pnlFraction, riskReward } from '../utils/positions';
import { formatPrice } from '../utils/price';
import { type AppTimeZone, formatChartTime, parseDateTimeInput, toDateTimeInputValue } from '../utils/time';

interface EntryDraft {
  direction: PositionDirection;
  entry_ts: number;
  entry_price: number;
  tp_price: number;
  sl_price: number;
  entry_reason: string;
}

interface ExitDraft {
  exit_ts: number;
  exit_price: number;
  exit_reason: string;
}

type Props =
  | {
      mode: 'entry';
      draft: EntryDraft;
      timezone: AppTimeZone;
      onSubmit: (d: EntryDraft) => void;
      onCancel: () => void;
    }
  | {
      mode: 'exit';
      position: Position;
      draft: ExitDraft;
      timezone: AppTimeZone;
      onSubmit: (d: ExitDraft) => void;
      onCancel: () => void;
    };

const S: Record<string, React.CSSProperties> = {
  backdrop: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
  },
  card: {
    width: 380, maxWidth: '90vw',
    background: '#1e222d', color: '#d1d4dc',
    border: '1px solid #2a2e39', borderRadius: 6,
    padding: 18, boxShadow: '0 10px 30px rgba(0,0,0,0.5)',
  },
  title: { fontSize: 15, fontWeight: 600, marginBottom: 14 },
  row: { display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 },
  label: { width: 80, fontSize: 12, color: '#787b86' },
  input: {
    flex: 1, background: '#2a2e39', border: '1px solid #363a45', borderRadius: 4,
    color: '#d1d4dc', padding: '5px 8px', fontSize: 13, outline: 'none',
  },
  textarea: {
    width: '100%', minHeight: 60, resize: 'vertical' as const,
    background: '#2a2e39', border: '1px solid #363a45', borderRadius: 4,
    color: '#d1d4dc', padding: '6px 8px', fontSize: 13, outline: 'none',
    fontFamily: 'inherit', marginBottom: 10,
  },
  readonly: { flex: 1, fontSize: 13, color: '#d1d4dc' },
  btnRow: { display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 },
  btn: {
    padding: '6px 14px', borderRadius: 4, border: 'none', cursor: 'pointer',
    fontSize: 13,
  },
  info: {
    background: '#151821', border: '1px solid #2a2e39', borderRadius: 4,
    padding: '6px 10px', fontSize: 12, color: '#787b86', marginBottom: 10,
    lineHeight: 1.5,
  },
};

export function PositionFormModal(props: Props) {
  // Escape to cancel
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') props.onCancel(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [props.onCancel]);

  return (
    <div style={S.backdrop} onMouseDown={e => { if (e.target === e.currentTarget) props.onCancel(); }}>
      <div style={S.card}>
        {props.mode === 'entry' ? <EntryForm {...props} /> : <ExitForm {...props} />}
      </div>
    </div>
  );
}

function EntryForm({ draft, timezone, onSubmit, onCancel }: Extract<Props, { mode: 'entry' }>) {
  const [d, setD] = useState<EntryDraft>(draft);
  const color = d.direction === 'long' ? '#26a69a' : '#ef5350';
  const rr = riskReward(d.direction, d.entry_price, d.tp_price, d.sl_price);

  const valid =
    Number.isFinite(d.entry_price) && d.entry_price > 0 &&
    Number.isFinite(d.tp_price) && d.tp_price > 0 &&
    Number.isFinite(d.sl_price) && d.sl_price > 0 &&
    // TP must be on the profit side of entry, SL on the loss side
    (d.direction === 'long'
      ? d.tp_price > d.entry_price && d.sl_price < d.entry_price
      : d.tp_price < d.entry_price && d.sl_price > d.entry_price);

  return (
    <>
      <div style={{ ...S.title, color }}>
        開 {d.direction === 'long' ? '多頭' : '空頭'} 倉位
      </div>
      <div style={S.info}>進場時間：{formatChartTime(d.entry_ts / 1000, timezone)}</div>

      <div style={S.row}>
        <span style={S.label}>進場價</span>
        <input type="number" step="any" style={S.input}
          value={d.entry_price}
          onChange={e => setD({ ...d, entry_price: parseFloat(e.target.value) })} />
      </div>
      <div style={S.row}>
        <span style={S.label}>止盈 (TP)</span>
        <input type="number" step="any" style={S.input}
          value={d.tp_price}
          onChange={e => setD({ ...d, tp_price: parseFloat(e.target.value) })} />
      </div>
      <div style={S.row}>
        <span style={S.label}>止損 (SL)</span>
        <input type="number" step="any" style={S.input}
          value={d.sl_price}
          onChange={e => setD({ ...d, sl_price: parseFloat(e.target.value) })} />
      </div>

      {rr != null && (
        <div style={S.info}>
          R/R ≈ {rr.toFixed(2)}
          {' · '}
          預期獲利 {((Math.abs(d.tp_price - d.entry_price) / d.entry_price) * 100).toFixed(2)}%
          {' · '}
          預期虧損 {((Math.abs(d.sl_price - d.entry_price) / d.entry_price) * 100).toFixed(2)}%
        </div>
      )}

      <div style={S.label}>進場理由</div>
      <textarea style={S.textarea}
        value={d.entry_reason}
        onChange={e => setD({ ...d, entry_reason: e.target.value })}
        placeholder="為什麼在這裡進場？" />

      <div style={S.btnRow}>
        <button style={{ ...S.btn, background: '#2a2e39', color: '#d1d4dc' }} onClick={onCancel}>取消</button>
        <button
          style={{ ...S.btn, background: valid ? color : '#363a45', color: '#fff', opacity: valid ? 1 : 0.6 }}
          disabled={!valid}
          onClick={() => valid && onSubmit(d)}
        >開倉</button>
      </div>
    </>
  );
}

function ExitForm({ position, draft, timezone, onSubmit, onCancel }: Extract<Props, { mode: 'exit' }>) {
  const [d, setD] = useState<ExitDraft>(draft);
  const dirColor = position.direction === 'long' ? '#26a69a' : '#ef5350';
  const pnl = pnlFraction(position.direction, position.entry_price, d.exit_price);
  const pnlColor = pnl >= 0 ? '#26a69a' : '#ef5350';
  const timeValid = Number.isFinite(d.exit_ts) && d.exit_ts >= position.entry_ts;

  const valid = timeValid && Number.isFinite(d.exit_price) && d.exit_price > 0;

  return (
    <>
      <div style={{ ...S.title, color: dirColor }}>
        平倉 — {position.direction === 'long' ? '多頭' : '空頭'}
      </div>
      <div style={S.info}>
        進場：{formatChartTime(position.entry_ts / 1000, timezone)} @ {formatPrice(position.entry_price)}
        <br />
        TP {formatPrice(position.tp_price)} · SL {formatPrice(position.sl_price)}
      </div>

      <div style={S.row}>
        <span style={S.label}>出場時間</span>
        <input
          type="datetime-local"
          style={S.input}
          value={toDateTimeInputValue(d.exit_ts, timezone)}
          onChange={e => {
            const ts = parseDateTimeInput(e.target.value, timezone);
            if (ts != null) setD({ ...d, exit_ts: ts });
          }}
        />
      </div>
      <div style={S.row}>
        <span style={S.label}>出場價</span>
        <input type="number" step="any" style={S.input}
          value={d.exit_price}
          onChange={e => setD({ ...d, exit_price: parseFloat(e.target.value) })} />
      </div>

      {!timeValid && (
        <div style={{ ...S.info, borderColor: '#ef5350', color: '#ef5350' }}>
          出場時間不能早於進場時間。
        </div>
      )}

      <div style={S.info}>
        PnL：<span style={{ color: pnlColor, fontWeight: 600 }}>
          {(pnl * 100).toFixed(2)}%
        </span>
      </div>

      <div style={S.label}>出場理由</div>
      <textarea style={S.textarea}
        value={d.exit_reason}
        onChange={e => setD({ ...d, exit_reason: e.target.value })}
        placeholder="為什麼在這裡出場？" />

      <div style={S.btnRow}>
        <button style={{ ...S.btn, background: '#2a2e39', color: '#d1d4dc' }} onClick={onCancel}>取消</button>
        <button
          style={{ ...S.btn, background: valid ? dirColor : '#363a45', color: '#fff', opacity: valid ? 1 : 0.6 }}
          disabled={!valid}
          onClick={() => valid && onSubmit(d)}
        >平倉</button>
      </div>
    </>
  );
}
