import React, { useEffect, useRef, useState } from 'react';
import type { IntervalResult } from '../api/live';
import type { LiveSyncStatus } from '../hooks/useLiveSync';
import type { ReplaySpeed, ReplayState } from '../replay/types';
import type { PositionDirection, SwingThresholds, SymbolInfo } from '../types';
import { type AppTimeZone, formatDateTime, getTimeZoneLabel, parseDateTimeInput } from '../utils/time';

const INTERVALS = ['15m', '1h', '4h', '1d'] as const;
const LIVE_SYNC_OPTIONS = [15, 30, 60, 300] as const;
const PIVOT_N_OPTIONS = [3, 5, 8, 10] as const;
const REPLAY_SPEED_OPTIONS: ReplaySpeed[] = [1, 2, 4, 8];
const TIMEZONE_OPTIONS: AppTimeZone[] = ['local', 'UTC', 'Asia/Taipei'];

const ivBtnStyle = (active: boolean, disabled = false): React.CSSProperties => ({
  padding: '3px 10px',
  borderRadius: 4,
  border: 'none',
  cursor: disabled ? 'not-allowed' : 'pointer',
  fontSize: 13,
  background: active ? '#2962FF' : '#2a2e39',
  color: active ? '#fff' : '#d1d4dc',
  opacity: disabled ? 0.45 : 1,
});

const actionBtnStyle = (background: string, active = false): React.CSSProperties => ({
  padding: '3px 12px',
  borderRadius: 4,
  border: active ? '2px solid #ffffff' : 'none',
  cursor: 'pointer',
  fontSize: 13,
  background,
  color: '#fff',
  fontWeight: 600,
  flexShrink: 0,
});

const S: Record<string, React.CSSProperties> = {
  bar: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    rowGap: 6,
    padding: '6px 12px',
    background: '#1e222d',
    borderBottom: '1px solid #2a2e39',
    flexShrink: 0,
    minHeight: 44,
    flexWrap: 'wrap',
    whiteSpace: 'nowrap',
    position: 'relative',
    zIndex: 10,
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
  liveBox: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '4px 8px',
    borderRadius: 6,
    background: '#151821',
    border: '1px solid #2a2e39',
  },
  liveStatus: {
    display: 'flex',
    alignItems: 'center',
    gap: 5,
    fontSize: 12,
    color: '#d1d4dc',
  },
  liveMeta: {
    fontSize: 12,
    color: '#9aa0ac',
    minWidth: 108,
  },
  replayBox: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '4px 8px',
    borderRadius: 6,
    background: '#151821',
    border: '1px solid #2a2e39',
  },
  replayStatus: {
    color: '#d1d4dc',
    fontSize: 12,
    minWidth: 92,
    textAlign: 'center',
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
  onSymbolChange: (symbol: string) => void;
  onIntervalChange: (interval: string) => void;
  onDateJump: (ts: number) => void;
  onToggleSwings: () => void;
  onPivotNChange: (value: number) => void;
  onSwingThresholdsChange: (thresholds: SwingThresholds) => void;
  onToggleForce: () => void;
  onToggleRanges: () => void;
  onToggleMA: () => void;
  onMALengthsChange: (lengths: number[]) => void;
  onMATypeChange: (type: 'sma' | 'ema') => void;
  onToggleTD: () => void;
  onTDLookbackChange: (value: number) => void;
  onTDSetupLengthChange: (value: number) => void;
  showLastPrice: boolean;
  onToggleLastPrice: () => void;
  autoRefresh: boolean;
  autoRefreshLocked: boolean;
  onToggleAutoRefresh: () => void;
  liveSyncEnabled: boolean;
  liveSyncLocked: boolean;
  liveSyncPollSec: number;
  liveSyncStatus: LiveSyncStatus;
  liveSyncLastAt: number | null;
  liveSyncCurrentAdded: number | null;
  liveSyncError: string | null;
  liveSyncResults: IntervalResult[];
  onToggleLiveSync: () => void;
  onLiveSyncPollSecChange: (seconds: number) => void;
  timezone: AppTimeZone;
  onTimezoneChange: (timezone: AppTimeZone) => void;
  onOpenLong: () => void;
  onOpenShort: () => void;
  placingDirection: PositionDirection | null;
  onCancelPlacing: () => void;
  replayEnabled: boolean;
  replayStatus: ReplayState['status'];
  replaySpeed: ReplaySpeed;
  replayAnchorInput: string;
  replayAnchorInvalid: boolean;
  replayLoadingFuture: boolean;
  replayCursorIndex: number;
  replayLoadedBars: number;
  onReplayAnchorInputChange: (value: string) => void;
  onStartReplay: () => void;
  onStopReplay: () => void;
  onReplayPlayPause: () => void;
  onReplayStepBack: () => void;
  onReplayStepForward: () => void;
  onReplaySpeedChange: (speed: ReplaySpeed) => void;
  onReplayScrub: (index: number) => void;
}

const replayStatusLabel: Record<ReplayState['status'], string> = {
  idle: '未啟動',
  paused: '已暫停',
  playing: '播放中',
  ended: '已到尾端',
};

const liveSyncStatusLabel: Record<LiveSyncStatus, string> = {
  idle: '待命',
  syncing: '同步中',
  ok: '正常',
  error: '錯誤',
};

function getLiveSyncColor(status: LiveSyncStatus): string {
  switch (status) {
    case 'syncing':
      return '#42a5f5';
    case 'ok':
      return '#26a69a';
    case 'error':
      return '#ef5350';
    default:
      return '#787b86';
  }
}

function formatLiveSyncMeta(
  enabled: boolean,
  lastAt: number | null,
  currentAdded: number | null,
  timezone: AppTimeZone,
): string {
  if (!enabled) return '未啟用';
  if (lastAt == null) return '等待首次同步';

  const base = formatDateTime(lastAt, timezone).slice(11);
  if (currentAdded != null && currentAdded > 0) {
    return `上次 ${base} (+${currentAdded})`;
  }
  return `上次 ${base}`;
}

function formatLiveSyncTitle(
  locked: boolean,
  error: string | null,
  results: IntervalResult[],
): string {
  if (locked) return '回放中停用即時同步';
  if (error) return error;
  if (results.length === 0) return '同步當前 symbol 的 15m / 1h / 4h / 1d 到資料庫';
  return results.map(result => {
    if (result.skipped) {
      return `${result.interval}: ${result.reason ?? 'skipped'}`;
    }
    return `${result.interval}: +${result.added}`;
  }).join(' | ');
}

export function Toolbar({
  symbol,
  interval,
  symbols,
  showSwings,
  pivotN,
  swingThresholds,
  showForce,
  showRanges,
  showMA,
  maLengths,
  maType,
  tdShow,
  tdLookback,
  tdSetupLength,
  onSymbolChange,
  onIntervalChange,
  onDateJump,
  onToggleSwings,
  onPivotNChange,
  onSwingThresholdsChange,
  onToggleForce,
  onToggleRanges,
  onToggleMA,
  onMALengthsChange,
  onMATypeChange,
  onToggleTD,
  onTDLookbackChange,
  onTDSetupLengthChange,
  showLastPrice,
  onToggleLastPrice,
  autoRefresh,
  autoRefreshLocked,
  onToggleAutoRefresh,
  liveSyncEnabled,
  liveSyncLocked,
  liveSyncPollSec,
  liveSyncStatus,
  liveSyncLastAt,
  liveSyncCurrentAdded,
  liveSyncError,
  liveSyncResults,
  onToggleLiveSync,
  onLiveSyncPollSecChange,
  timezone,
  onTimezoneChange,
  onOpenLong,
  onOpenShort,
  placingDirection,
  onCancelPlacing,
  replayEnabled,
  replayStatus,
  replaySpeed,
  replayAnchorInput,
  replayAnchorInvalid,
  replayLoadingFuture,
  replayCursorIndex,
  replayLoadedBars,
  onReplayAnchorInputChange,
  onStartReplay,
  onStopReplay,
  onReplayPlayPause,
  onReplayStepBack,
  onReplayStepForward,
  onReplaySpeedChange,
  onReplayScrub,
}: ToolbarProps) {
  const [query, setQuery] = useState(symbol);
  const [open, setOpen] = useState(false);
  const [maText, setMaText] = useState(maLengths.join(','));
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMaText(maLengths.join(','));
  }, [maLengths]);

  useEffect(() => {
    setQuery(symbol);
  }, [symbol]);

  useEffect(() => {
    const handler = (event: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) {
        setOpen(false);
        setQuery(symbol);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [symbol]);

  const commitMaText = () => {
    const parsed = maText
      .split(/[,\s]+/)
      .map(value => parseInt(value, 10))
      .filter(value => Number.isFinite(value) && value > 0 && value <= 1000);
    if (parsed.length > 0) onMALengthsChange(parsed);
    else setMaText(maLengths.join(','));
  };

  const filtered = query
    ? symbols.filter(info => info.symbol.toUpperCase().includes(query.toUpperCase()))
    : symbols;

  const handleSelect = (nextSymbol: string) => {
    onSymbolChange(nextSymbol);
    setQuery(nextSymbol);
    setOpen(false);
  };

  const handleDateJump = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (!event.target.value) return;
    const ts = parseDateTimeInput(event.target.value, timezone);
    if (ts != null) onDateJump(ts);
  };

  const replayProgress = replayLoadedBars > 0
    ? `${Math.min(replayCursorIndex + 1, replayLoadedBars)}/${replayLoadedBars}`
    : '0/0';

  const liveSyncTitle = formatLiveSyncTitle(liveSyncLocked, liveSyncError, liveSyncResults);
  const liveSyncMeta = formatLiveSyncMeta(liveSyncEnabled, liveSyncLastAt, liveSyncCurrentAdded, timezone);
  const liveSyncColor = getLiveSyncColor(liveSyncStatus);

  return (
    <div style={S.bar}>
      <div ref={wrapRef} style={S.symbolWrap}>
        <input
          style={S.symbolInput}
          value={query}
          onChange={event => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder="搜尋交易對"
        />
        {open && filtered.length > 0 && (
          <div style={S.dropdown}>
            {filtered.slice(0, 60).map(info => (
              <div
                key={info.symbol}
                style={{ ...S.dropItem, background: info.symbol === symbol ? '#2a2e39' : undefined }}
                onMouseDown={() => handleSelect(info.symbol)}
              >
                {info.symbol}
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
        {INTERVALS.map(value => (
          <button key={value} style={ivBtnStyle(value === interval)} onClick={() => onIntervalChange(value)}>
            {value}
          </button>
        ))}
      </div>

      <span style={S.label}>跳轉</span>
      <input type="datetime-local" style={S.dateInput} onChange={handleDateJump} />

      <div style={S.divider} />

      <button style={ivBtnStyle(showSwings)} onClick={onToggleSwings} title="顯示或隱藏波段標記">
        波段
      </button>
      {showSwings && (
        <>
          <span style={S.label}>N</span>
          <select style={S.select} value={pivotN} onChange={event => onPivotNChange(Number(event.target.value))}>
            {PIVOT_N_OPTIONS.map(value => (
              <option key={value} value={value}>{value}</option>
            ))}
          </select>
          <span style={S.label}>Approach</span>
          <input
            type="number"
            step={0.05}
            min={0}
            max={1}
            style={{ ...S.dateInput, width: 60 }}
            value={swingThresholds.approach}
            onChange={event => {
              const value = parseFloat(event.target.value);
              if (Number.isFinite(value) && value >= 0 && value <= 1) {
                onSwingThresholdsChange({ ...swingThresholds, approach: value });
              }
            }}
          />
          <span style={S.label}>Reject</span>
          <input
            type="number"
            step={0.05}
            min={0}
            max={1}
            style={{ ...S.dateInput, width: 60 }}
            value={swingThresholds.rejection}
            onChange={event => {
              const value = parseFloat(event.target.value);
              if (Number.isFinite(value) && value >= 0 && value <= 1) {
                onSwingThresholdsChange({ ...swingThresholds, rejection: value });
              }
            }}
          />
          <span style={S.label}>ATR</span>
          <input
            type="number"
            step={0.1}
            min={0}
            max={5}
            style={{ ...S.dateInput, width: 60 }}
            value={swingThresholds.departureAtr}
            onChange={event => {
              const value = parseFloat(event.target.value);
              if (Number.isFinite(value) && value >= 0 && value <= 5) {
                onSwingThresholdsChange({ ...swingThresholds, departureAtr: value });
              }
            }}
          />
        </>
      )}

      <div style={S.divider} />

      <button style={ivBtnStyle(showForce)} onClick={onToggleForce} title="顯示或隱藏力道子圖">
        力道
      </button>
      <button style={ivBtnStyle(showRanges)} onClick={onToggleRanges} title="顯示或隱藏橫盤區間">
        橫盤
      </button>

      <div style={S.divider} />

      <button style={ivBtnStyle(showMA)} onClick={onToggleMA} title="顯示或隱藏均線">
        均線
      </button>
      {showMA && (
        <>
          <select style={S.select} value={maType} onChange={event => onMATypeChange(event.target.value as 'sma' | 'ema')}>
            <option value="sma">SMA</option>
            <option value="ema">EMA</option>
          </select>
          <span style={S.label}>Lengths</span>
          <input
            style={{ ...S.dateInput, width: 120 }}
            value={maText}
            onChange={event => setMaText(event.target.value)}
            onBlur={commitMaText}
            onKeyDown={event => {
              if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
            }}
            placeholder="20,60,200"
          />
        </>
      )}

      <div style={S.divider} />

      <button style={ivBtnStyle(tdShow)} onClick={onToggleTD} title="顯示或隱藏 TD Setup">
        TD
      </button>
      {tdShow && (
        <>
          <span style={S.label}>Lookback</span>
          <input
            type="number"
            min={1}
            max={20}
            style={{ ...S.dateInput, width: 58 }}
            value={tdLookback}
            onChange={event => {
              const value = parseInt(event.target.value, 10);
              if (Number.isFinite(value) && value >= 1 && value <= 20) onTDLookbackChange(value);
            }}
          />
          <span style={S.label}>Setup</span>
          <input
            type="number"
            min={3}
            max={30}
            style={{ ...S.dateInput, width: 58 }}
            value={tdSetupLength}
            onChange={event => {
              const value = parseInt(event.target.value, 10);
              if (Number.isFinite(value) && value >= 3 && value <= 30) onTDSetupLengthChange(value);
            }}
          />
        </>
      )}

      <div style={S.divider} />

      <button style={ivBtnStyle(showLastPrice)} onClick={onToggleLastPrice} title="顯示或隱藏現價線">
        現價線
      </button>
      <button
        style={ivBtnStyle(autoRefresh, autoRefreshLocked)}
        onClick={() => {
          if (!autoRefreshLocked) onToggleAutoRefresh();
        }}
        title={autoRefreshLocked ? '回放中已停用自動更新' : '每 30 秒更新最新 K 線'}
      >
        自動更新
      </button>

      <div style={S.liveBox} title={liveSyncTitle}>
        <button
          style={ivBtnStyle(liveSyncEnabled, liveSyncLocked)}
          onClick={() => {
            if (!liveSyncLocked) onToggleLiveSync();
          }}
          title={liveSyncLocked ? '回放中停用即時同步' : '同步當前 symbol 的所有時框到資料庫'}
        >
          即時同步
        </button>
        <select
          style={{ ...S.select, opacity: liveSyncLocked ? 0.45 : 1 }}
          value={liveSyncPollSec}
          disabled={liveSyncLocked}
          onChange={event => onLiveSyncPollSecChange(Number(event.target.value))}
          title="設定即時同步輪詢週期"
        >
          {LIVE_SYNC_OPTIONS.map(value => (
            <option key={value} value={value}>{value}s</option>
          ))}
        </select>
        <span style={S.liveStatus}>
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: liveSyncColor,
              boxShadow: liveSyncStatus === 'syncing' ? `0 0 0 4px ${liveSyncColor}22` : 'none',
              flexShrink: 0,
            }}
          />
          {liveSyncStatusLabel[liveSyncStatus]}
        </span>
        <span style={S.liveMeta}>{liveSyncMeta}</span>
      </div>

      <select
        style={S.select}
        value={timezone}
        onChange={event => onTimezoneChange(event.target.value as AppTimeZone)}
        title="切換時間顯示與輸入的時區"
      >
        {TIMEZONE_OPTIONS.map(value => (
          <option key={value} value={value}>{getTimeZoneLabel(value)}</option>
        ))}
      </select>

      <div style={S.divider} />

      <button
        style={actionBtnStyle('#26a69a', placingDirection === 'long')}
        onClick={() => (placingDirection === 'long' ? onCancelPlacing() : onOpenLong())}
        title="進入多單放置模式"
      >
        {placingDirection === 'long' ? '取消多單' : '開多'}
      </button>
      <button
        style={actionBtnStyle('#ef5350', placingDirection === 'short')}
        onClick={() => (placingDirection === 'short' ? onCancelPlacing() : onOpenShort())}
        title="進入空單放置模式"
      >
        {placingDirection === 'short' ? '取消空單' : '開空'}
      </button>

      <div style={S.divider} />

      <div style={S.replayBox}>
        <span style={S.label}>回放</span>
        <input
          type="datetime-local"
          style={{
            ...S.dateInput,
            borderColor: replayAnchorInvalid ? '#ef5350' : '#363a45',
            boxShadow: replayAnchorInvalid ? '0 0 0 1px rgba(239,83,80,0.35)' : undefined,
          }}
          value={replayAnchorInput}
          onChange={event => onReplayAnchorInputChange(event.target.value)}
          title="設定回放起點"
        />
        {!replayEnabled ? (
          <button style={ivBtnStyle(true)} onClick={onStartReplay} title="載入並進入回放">
            開始
          </button>
        ) : (
          <>
            <button style={ivBtnStyle(false)} onClick={onStopReplay} title="離開回放並回到即時模式">
              結束
            </button>
            <button style={ivBtnStyle(false)} onClick={onReplayStepBack} title="往前回退一根 K 線">
              ◀
            </button>
            <button style={ivBtnStyle(replayStatus === 'playing')} onClick={onReplayPlayPause} title="播放或暫停回放">
              {replayStatus === 'playing' ? '暫停' : '播放'}
            </button>
            <button style={ivBtnStyle(false)} onClick={onReplayStepForward} title="往前推進一根 K 線">
              ▶
            </button>
            <select
              style={S.select}
              value={replaySpeed}
              onChange={event => onReplaySpeedChange(Number(event.target.value) as ReplaySpeed)}
              title="設定回放速度"
            >
              {REPLAY_SPEED_OPTIONS.map(value => (
                <option key={value} value={value}>{value}x</option>
              ))}
            </select>
            <span style={S.replayStatus}>
              {replayLoadingFuture ? '載入中…' : replayStatusLabel[replayStatus]} · {replayProgress}
            </span>
            <input
              type="range"
              min={0}
              max={Math.max(replayLoadedBars - 1, 0)}
              value={Math.min(replayCursorIndex, Math.max(replayLoadedBars - 1, 0))}
              disabled={replayLoadedBars <= 1}
              onChange={event => onReplayScrub(Number(event.target.value))}
              style={{ width: 120 }}
              title="拖曳快速跳到指定回放進度"
            />
          </>
        )}
      </div>
    </div>
  );
}
