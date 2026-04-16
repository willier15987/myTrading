import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api/client';
import { type LiveSyncResponse } from './api/live';
import { type ReplaySpeed, type ReplayState } from './replay/types';
import { Chart } from './components/Chart';
import { MarkPanel } from './components/MarkPanel';
import { PositionFormModal } from './components/PositionFormModal';
import { PositionPanel } from './components/PositionPanel';
import { SubChart } from './components/SubChart';
import { Toolbar } from './components/Toolbar';
import { type LiveSyncStatus, useLiveSync } from './hooks/useLiveSync';
import type {
  Candle,
  DetectedRange,
  IndicatorPoint,
  LabelType,
  MAConfig,
  Mark,
  Position,
  PositionDirection,
  SwingPoint,
  SwingThresholds,
  SymbolInfo,
} from './types';
import { MA_COLOR_PALETTE } from './types';
import { newPositionId } from './utils/positions';
import { type AppTimeZone, parseDateTimeInput, toDateTimeInputValue } from './utils/time';
import { useLocalStorage } from './utils/useLocalStorage';

const INITIAL_LIMIT = 500;
const MORE_LIMIT = 300;
const AUTO_REFRESH_MS = 30_000;
const AUTO_REFRESH_TAIL = 5;

const REPLAY_WARMUP_BARS = 200;
const REPLAY_FORWARD_PRELOAD = 400;
const REPLAY_PRELOAD_THRESHOLD = 60;
const REPLAY_DEFAULT_START_OFFSET = 100;
const REPLAY_SPEED_MS: Record<ReplaySpeed, number> = {
  1: 1000,
  2: 500,
  4: 250,
  8: 125,
};

const DEFAULT_SWING_THRESHOLDS: SwingThresholds = { approach: 0.5, rejection: 0.55, departureAtr: 0.5 };
const DEFAULT_REPLAY_STATE: ReplayState = {
  enabled: false,
  status: 'idle',
  anchorTs: null,
  cursorIndex: 0,
  speed: 1,
  warmupBars: REPLAY_WARMUP_BARS,
  forwardPreloadBars: REPLAY_FORWARD_PRELOAD,
};

type EntryDraft = {
  direction: PositionDirection;
  entry_ts: number;
  entry_price: number;
  tp_price: number;
  sl_price: number;
  entry_reason: string;
};

type ExitDraft = {
  exit_ts: number;
  exit_price: number;
  exit_reason: string;
};

type ModalState =
  | { kind: 'entry'; draft: EntryDraft }
  | { kind: 'exit'; position: Position; draft: ExitDraft }
  | null;

type JumpRequest = {
  ts: number;
  token: number;
};

type Toast = {
  id: number;
  message: string;
};

function arePositionLevelsValid(position: Pick<Position, 'direction' | 'entry_price' | 'tp_price' | 'sl_price'>): boolean {
  if (position.direction === 'long') {
    return position.tp_price > position.entry_price && position.sl_price < position.entry_price;
  }
  return position.tp_price < position.entry_price && position.sl_price > position.entry_price;
}

function mergeUniqueCandles(candles: Candle[]): Candle[] {
  const map = new Map<number, Candle>();
  for (const candle of candles) map.set(candle.t, candle);
  return Array.from(map.values()).sort((a, b) => a.t - b.t);
}

function getReplayDefaultAnchorTs(candles: Candle[], selectedCandle: Candle | null): number | null {
  if (selectedCandle) return selectedCandle.t;
  if (candles.length === 0) return null;
  const index = Math.max(candles.length - 1 - REPLAY_DEFAULT_START_OFFSET, 0);
  return candles[index].t;
}

function resetReplayState(prev: ReplayState): ReplayState {
  return {
    ...prev,
    enabled: false,
    status: 'idle',
    anchorTs: null,
    cursorIndex: 0,
    warmupBars: REPLAY_WARMUP_BARS,
    forwardPreloadBars: REPLAY_FORWARD_PRELOAD,
  };
}

export default function App() {
  const [symbol, setSymbol] = useLocalStorage<string>('symbol', 'BTCUSDT');
  const [interval, setInterval] = useLocalStorage<string>('interval', '1h');
  const [showSwings, setShowSwings] = useLocalStorage<boolean>('showSwings', false);
  const [pivotN, setPivotN] = useLocalStorage<number>('pivotN', 5);
  const [swingThresholds, setSwingThresholds] = useLocalStorage<SwingThresholds>('swingThresholds', DEFAULT_SWING_THRESHOLDS);
  const [showForce, setShowForce] = useLocalStorage<boolean>('showForce', false);
  const [showRanges, setShowRanges] = useLocalStorage<boolean>('showRanges', false);
  const [showMA, setShowMA] = useLocalStorage<boolean>('showMA', false);
  const [maLengths, setMaLengths] = useLocalStorage<number[]>('maLengths', [20, 60]);
  const [maType, setMaType] = useLocalStorage<'sma' | 'ema'>('maType', 'sma');
  const [tdShow, setTdShow] = useLocalStorage<boolean>('tdShow', false);
  const [tdLookback, setTdLookback] = useLocalStorage<number>('tdLookback', 4);
  const [tdSetupLength, setTdSetupLength] = useLocalStorage<number>('tdSetupLength', 9);
  const [storedPositions, setStoredPositions] = useLocalStorage<Position[]>('positions', []);
  const [showLastPrice, setShowLastPrice] = useLocalStorage<boolean>('showLastPrice', true);
  const [autoRefresh, setAutoRefresh] = useLocalStorage<boolean>('autoRefresh', true);
  const [liveSyncEnabled, setLiveSyncEnabled] = useLocalStorage<boolean>('liveSyncEnabled', false);
  const [liveSyncIntervalSec, setLiveSyncIntervalSec] = useLocalStorage<number>('liveSyncIntervalSec', 60);
  const [timezone, setTimezone] = useLocalStorage<AppTimeZone>('timezone', 'Asia/Taipei');

  const [liveCandles, setLiveCandles] = useState<Candle[]>([]);
  const [liveMarks, setLiveMarks] = useState<Mark[]>([]);
  const [symbols, setSymbols] = useState<SymbolInfo[]>([]);
  const [swings, setSwings] = useState<SwingPoint[]>([]);
  const [indicatorSeries, setIndicatorSeries] = useState<IndicatorPoint[]>([]);
  const [detectedRanges, setDetectedRanges] = useState<DetectedRange[]>([]);

  const [replayState, setReplayState] = useState<ReplayState>(DEFAULT_REPLAY_STATE);
  const [replaySourceCandles, setReplaySourceCandles] = useState<Candle[]>([]);
  const [replayMarks, setReplayMarks] = useState<Mark[]>([]);
  const [replayPositions, setReplayPositions] = useState<Position[]>([]);
  const [replayAnchorTs, setReplayAnchorTs] = useState<number | null>(null);

  const maConfigs = useMemo<MAConfig[]>(
    () => maLengths.map((length, i) => ({ length, color: MA_COLOR_PALETTE[i % MA_COLOR_PALETTE.length] })),
    [maLengths],
  );
  const tdConfig = useMemo(
    () => ({ show: tdShow, lookback: tdLookback, setupLength: tdSetupLength }),
    [tdShow, tdLookback, tdSetupLength],
  );

  const subChartSetLogicalRef = useRef<((from: number, to: number) => void) | null>(null);

  const [selectedCandle, setSelectedCandle] = useState<Candle | null>(null);
  const [rangeStart, setRangeStart] = useState<Candle | null>(null);
  const [rangeEnd, setRangeEnd] = useState<Candle | null>(null);
  const [jumpRequest, setJumpRequest] = useState<JumpRequest | null>(null);
  const [loadingMsg, setLoadingMsg] = useState('');
  const [modal, setModal] = useState<ModalState>(null);
  const [placingDirection, setPlacingDirection] = useState<PositionDirection | null>(null);
  const [replayAnchorInvalid, setReplayAnchorInvalid] = useState(false);
  const [liveSyncStatus, setLiveSyncStatus] = useState<LiveSyncStatus>('idle');
  const [liveSyncLastAt, setLiveSyncLastAt] = useState<number | null>(null);
  const [liveSyncError, setLiveSyncError] = useState<string | null>(null);
  const [liveSyncResults, setLiveSyncResults] = useState<LiveSyncResponse['results']>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [replayLoadingFuture, setReplayLoadingFuture] = useState(false);

  const hasMoreLiveRef = useRef(true);
  const replaySourceCandlesRef = useRef<Candle[]>([]);
  const replayHasMorePastRef = useRef(true);
  const replayHasMoreFutureRef = useRef(true);
  const replayLoadingPastRef = useRef(false);
  const replayLoadingFutureRef = useRef(false);
  const replayMarkIdRef = useRef(-1);
  const jumpTokenRef = useRef(0);
  const replayAnchorTsRef = useRef<number | null>(null);
  const toastIdRef = useRef(0);
  const liveViewKeyRef = useRef(`${symbol}:${interval}`);

  const candles = useMemo(() => {
    if (!replayState.enabled) return liveCandles;
    const lastIndex = Math.min(replayState.cursorIndex + 1, replaySourceCandles.length);
    return replaySourceCandles.slice(0, Math.max(lastIndex, 0));
  }, [liveCandles, replaySourceCandles, replayState.cursorIndex, replayState.enabled]);
  const activeMarks = replayState.enabled ? replayMarks : liveMarks;
  const activePositions = replayState.enabled ? replayPositions : storedPositions;
  const currentPositions = useMemo(
    () => activePositions.filter(position => position.symbol === symbol && position.interval === interval),
    [activePositions, symbol, interval],
  );
  const latestTs = candles.length > 0 ? candles[candles.length - 1].t : 0;
  const replayAnchorInputValue = replayAnchorTs != null ? toDateTimeInputValue(replayAnchorTs, timezone) : '';
  const chartDatasetKey = replayState.enabled
    ? `replay:${symbol}:${interval}:${replayState.anchorTs ?? 'pending'}`
    : `live:${symbol}:${interval}`;
  const replaySummary = useMemo(() => {
    if (!replayState.enabled || replayState.status !== 'ended') return null;
    const longCount = replayPositions.filter(position => position.direction === 'long').length;
    const shortCount = replayPositions.length - longCount;
    return {
      bars: replayState.cursorIndex + 1,
      positions: replayPositions.length,
      longCount,
      shortCount,
      marks: replayMarks.length,
    };
  }, [replayMarks.length, replayPositions, replayState.cursorIndex, replayState.enabled, replayState.status]);
  const indicatorLogicalOffset = useMemo(() => {
    if (candles.length === 0 || indicatorSeries.length === 0) return null;
    const firstIndicatorTs = indicatorSeries[0].t;
    const startIndex = candles.findIndex(candle => candle.t === firstIndicatorTs);
    return startIndex >= 0 ? startIndex : null;
  }, [candles, indicatorSeries]);
  const liveSyncCurrentResult = useMemo(
    () => liveSyncResults.find(result => result.interval === interval) ?? null,
    [interval, liveSyncResults],
  );

  useEffect(() => {
    replaySourceCandlesRef.current = replaySourceCandles;
  }, [replaySourceCandles]);

  useEffect(() => {
    replayAnchorTsRef.current = replayAnchorTs;
  }, [replayAnchorTs]);

  useEffect(() => {
    liveViewKeyRef.current = `${symbol}:${interval}`;
  }, [interval, symbol]);

  const queueJump = useCallback((ts: number) => {
    jumpTokenRef.current += 1;
    setJumpRequest({ ts, token: jumpTokenRef.current });
  }, []);

  const showToast = useCallback((message: string) => {
    toastIdRef.current += 1;
    const id = toastIdRef.current;
    setToasts(prev => (
      prev.some(toast => toast.message === message)
        ? prev
        : [...prev, { id, message }]
    ));
    window.setTimeout(() => {
      setToasts(prev => prev.filter(toast => toast.id !== id));
    }, 3000);
  }, []);

  const reportError = useCallback((message: string, error: unknown) => {
    console.error(error);
    showToast(message);
  }, [showToast]);

  useEffect(() => {
    api.getSymbols().then(setSymbols).catch(error => reportError('交易對清單載入失敗。', error));
  }, [reportError]);

  const refreshLiveMarks = useCallback(() => {
    api.getMarks(symbol, interval).then(setLiveMarks).catch(error => reportError('標記資料載入失敗。', error));
  }, [interval, reportError, symbol]);

  const refreshLiveTail = useCallback(async (targetSymbol: string, targetInterval: string) => {
    try {
      const response = await api.getKlines(targetSymbol, targetInterval, { limit: INITIAL_LIMIT });
      if (liveViewKeyRef.current !== `${targetSymbol}:${targetInterval}`) return;
      setLiveCandles(prev => mergeUniqueCandles([...prev, ...response.candles]));
    } catch (error) {
      reportError('即時同步後刷新 K 線失敗。', error);
    }
  }, [reportError]);

  const handleLiveSyncStatus = useCallback((status: LiveSyncStatus, error?: string) => {
    setLiveSyncStatus(status);
    setLiveSyncError(status === 'error' ? (error ?? '即時同步失敗。') : null);
  }, []);

  const handleLiveSyncSynced = useCallback((response: LiveSyncResponse) => {
    setLiveSyncLastAt(response.fetched_at);
    setLiveSyncResults(response.results);

    const currentIntervalResult = response.results.find(result => result.interval === interval);
    if (!currentIntervalResult || currentIntervalResult.added <= 0) return;
    void refreshLiveTail(response.symbol, interval);
  }, [interval, refreshLiveTail]);

  const loadLiveData = useCallback(async () => {
    setLoadingMsg('載入 K 線中...');
    try {
      const [klinesRes, marksRes] = await Promise.all([
        api.getKlines(symbol, interval, { limit: INITIAL_LIMIT }),
        api.getMarks(symbol, interval),
      ]);
      hasMoreLiveRef.current = true;
      setLiveCandles(klinesRes.candles);
      setLiveMarks(marksRes);
    } catch (error) {
      reportError('載入 K 線資料失敗，請稍後再試。', error);
    } finally {
      setLoadingMsg('');
    }
  }, [interval, reportError, symbol]);

  useEffect(() => {
    setLiveCandles([]);
    setLiveMarks([]);
    setSwings([]);
    setIndicatorSeries([]);
    setDetectedRanges([]);
    setSelectedCandle(null);
    setRangeStart(null);
    setRangeEnd(null);
    setPlacingDirection(null);
    setModal(null);
    setReplayAnchorTs(null);
    setReplayAnchorInvalid(false);
    setReplayLoadingFuture(false);
    setReplaySourceCandles([]);
    setReplayMarks([]);
    setReplayPositions([]);
    setReplayState(resetReplayState);
    replayHasMorePastRef.current = true;
    replayHasMoreFutureRef.current = true;
    replayLoadingPastRef.current = false;
    replayLoadingFutureRef.current = false;
    replayMarkIdRef.current = -1;
    hasMoreLiveRef.current = true;

    void loadLiveData();
  }, [interval, symbol, loadLiveData]);

  useEffect(() => {
    setLiveSyncLastAt(null);
    setLiveSyncError(null);
    setLiveSyncResults([]);
    setLiveSyncStatus('idle');
  }, [symbol]);

  useEffect(() => {
    if (replayState.enabled || replayAnchorInvalid || liveCandles.length === 0) return;
    const defaultAnchorTs = getReplayDefaultAnchorTs(liveCandles, selectedCandle);
    if (defaultAnchorTs == null) return;
    setReplayAnchorTs(prev => (prev ?? defaultAnchorTs));
  }, [liveCandles, replayAnchorInvalid, replayState.enabled, selectedCandle]);

  useEffect(() => {
    const visibleTs = new Set(candles.map(candle => candle.t));
    if (selectedCandle && !visibleTs.has(selectedCandle.t)) setSelectedCandle(null);
    if (rangeStart && !visibleTs.has(rangeStart.t)) setRangeStart(null);
    if (rangeEnd && !visibleTs.has(rangeEnd.t)) setRangeEnd(null);
  }, [candles, rangeEnd, rangeStart, selectedCandle]);

  useEffect(() => {
    if (!showSwings || latestTs === 0) {
      setSwings([]);
      return;
    }
    api.getSwings(
      symbol,
      interval,
      pivotN,
      500,
      swingThresholds,
      replayState.enabled ? { end: latestTs } : undefined,
    )
      .then(setSwings)
      .catch(error => reportError('波段資料載入失敗。', error));
  }, [interval, latestTs, pivotN, replayState.enabled, reportError, showSwings, swingThresholds, symbol]);

  useEffect(() => {
    if (!showForce || latestTs === 0) {
      setIndicatorSeries([]);
      return;
    }
    api.getIndicatorSeries(
      symbol,
      interval,
      20,
      500,
      replayState.enabled ? { end: latestTs } : undefined,
    )
      .then(res => setIndicatorSeries(res.series))
      .catch(error => reportError('力道資料載入失敗。', error));
  }, [interval, latestTs, replayState.enabled, reportError, showForce, symbol]);

  useEffect(() => {
    if (!showRanges || latestTs === 0) {
      setDetectedRanges([]);
      return;
    }
    api.getRanges(
      symbol,
      interval,
      replayState.enabled ? { end: latestTs } : undefined,
    )
      .then(setDetectedRanges)
      .catch(error => reportError('橫盤資料載入失敗。', error));
  }, [interval, latestTs, replayState.enabled, reportError, showRanges, symbol]);

  const handleNeedMoreData = useCallback((beforeTs: number) => {
    if (replayState.enabled) {
      if (!replayHasMorePastRef.current || replayLoadingPastRef.current) return;
      replayLoadingPastRef.current = true;
      api.getKlines(symbol, interval, { end: beforeTs - 1, limit: MORE_LIMIT })
        .then(res => {
          if (res.candles.length < MORE_LIMIT) replayHasMorePastRef.current = false;
          if (res.candles.length === 0) return;
          const prev = replaySourceCandlesRef.current;
          const existing = new Set(prev.map(candle => candle.t));
          const newOnes = res.candles.filter(candle => !existing.has(candle.t));
          if (newOnes.length === 0) return;
          setReplaySourceCandles([...newOnes, ...prev]);
          setReplayState(current => (
            current.enabled
              ? { ...current, cursorIndex: current.cursorIndex + newOnes.length }
              : current
          ));
        })
        .catch(error => reportError('回放歷史資料載入失敗。', error))
        .finally(() => {
          replayLoadingPastRef.current = false;
        });
      return;
    }

    if (!hasMoreLiveRef.current) return;
    api.getKlines(symbol, interval, { end: beforeTs - 1, limit: MORE_LIMIT })
      .then(res => {
        if (res.candles.length < MORE_LIMIT) hasMoreLiveRef.current = false;
        if (res.candles.length === 0) return;
        setLiveCandles(prev => {
          const existing = new Set(prev.map(candle => candle.t));
          const newOnes = res.candles.filter(candle => !existing.has(candle.t));
          return [...newOnes, ...prev];
        });
      })
      .catch(error => reportError('歷史資料載入失敗。', error));
  }, [interval, replayState.enabled, reportError, symbol]);

  const handleCandleClick = useCallback((candle: Candle, isShift: boolean, clickedPrice: number | null) => {
    if (placingDirection) {
      const entry = clickedPrice != null ? clickedPrice : candle.c;
      const offset = entry * 0.01;
      const tp = placingDirection === 'long' ? entry + offset : entry - offset;
      const sl = placingDirection === 'long' ? entry - offset : entry + offset;
      setModal({
        kind: 'entry',
        draft: {
          direction: placingDirection,
          entry_ts: candle.t,
          entry_price: +entry.toFixed(8),
          tp_price: +tp.toFixed(8),
          sl_price: +sl.toFixed(8),
          entry_reason: '',
        },
      });
      setPlacingDirection(null);
      return;
    }

    if (isShift) {
      if (!rangeStart || rangeEnd) {
        setRangeStart(candle);
        setRangeEnd(null);
        setSelectedCandle(candle);
      } else {
        const [start, end] = candle.t < rangeStart.t ? [candle, rangeStart] : [rangeStart, candle];
        setRangeStart(start);
        setRangeEnd(end);
        setSelectedCandle(end);
      }
      return;
    }

    setSelectedCandle(candle);
    setRangeStart(null);
    setRangeEnd(null);
  }, [placingDirection, rangeEnd, rangeStart]);

  const handleAddMark = useCallback(async (labelType: LabelType, price?: number) => {
    if (!selectedCandle) return;

    if (replayState.enabled) {
      const mark: Mark = {
        id: replayMarkIdRef.current--,
        symbol,
        interval,
        timestamp: selectedCandle.t,
        label_type: labelType,
        price: price ?? selectedCandle.c,
        note: null,
        indicators: null,
        created_at: new Date().toISOString(),
      };
      setReplayMarks(prev => [...prev, mark]);
      return;
    }

    try {
      await api.createMark({
        symbol,
        interval,
        timestamp: selectedCandle.t,
        label_type: labelType,
        price: price ?? selectedCandle.c,
      });
      refreshLiveMarks();
    } catch (error) {
      reportError('新增標記失敗。', error);
    }
  }, [interval, refreshLiveMarks, replayState.enabled, reportError, selectedCandle, symbol]);

  const handleDeleteMark = useCallback(async (id: number) => {
    if (replayState.enabled) {
      setReplayMarks(prev => prev.filter(mark => mark.id !== id));
      return;
    }

    try {
      await api.deleteMark(id);
      refreshLiveMarks();
    } catch (error) {
      reportError('刪除標記失敗。', error);
    }
  }, [refreshLiveMarks, replayState.enabled, reportError]);

  const deleteMarksOnSelected = useCallback(() => {
    if (!selectedCandle) return;

    if (replayState.enabled) {
      setReplayMarks(prev => prev.filter(mark => mark.timestamp !== selectedCandle.t));
      return;
    }

    const toDelete = liveMarks.filter(mark => mark.timestamp === selectedCandle.t);
    Promise.all(toDelete.map(mark => api.deleteMark(mark.id)))
      .then(refreshLiveMarks)
      .catch(error => reportError('刪除標記失敗。', error));
  }, [liveMarks, refreshLiveMarks, replayState.enabled, reportError, selectedCandle]);

  const handleEntrySubmit = useCallback((draft: EntryDraft) => {
    const position: Position = {
      id: newPositionId(),
      symbol,
      interval,
      direction: draft.direction,
      entry_ts: draft.entry_ts,
      entry_price: draft.entry_price,
      tp_price: draft.tp_price,
      sl_price: draft.sl_price,
      exit_ts: null,
      exit_price: null,
      entry_reason: draft.entry_reason,
      exit_reason: '',
      created_at: new Date().toISOString(),
    };

    if (replayState.enabled) setReplayPositions(prev => [...prev, position]);
    else setStoredPositions(prev => [...prev, position]);
    setModal(null);
  }, [interval, replayState.enabled, setStoredPositions, symbol]);

  const handleRequestClose = useCallback((position: Position) => {
    const latest = candles.length > 0 ? candles[candles.length - 1] : null;
    const selectedBase = selectedCandle && selectedCandle.t >= position.entry_ts ? selectedCandle : null;
    const base = selectedBase ?? latest;
    const exitTs = base?.t ?? Date.now();
    const exitPrice = base?.c ?? position.entry_price;

    setModal({
      kind: 'exit',
      position,
      draft: { exit_ts: exitTs, exit_price: exitPrice, exit_reason: '' },
    });
  }, [candles, selectedCandle]);

  const handleExitSubmit = useCallback((draft: ExitDraft) => {
    if (modal?.kind !== 'exit') return;
    if (!Number.isFinite(draft.exit_price) || draft.exit_price <= 0) return;
    if (!Number.isFinite(draft.exit_ts) || draft.exit_ts < modal.position.entry_ts) return;

    const update = (position: Position) => (
      position.id === modal.position.id
        ? { ...position, exit_ts: draft.exit_ts, exit_price: draft.exit_price, exit_reason: draft.exit_reason }
        : position
    );

    if (replayState.enabled) setReplayPositions(prev => prev.map(update));
    else setStoredPositions(prev => prev.map(update));
    setModal(null);
  }, [modal, replayState.enabled, setStoredPositions]);

  const handleDeletePosition = useCallback((id: string) => {
    if (replayState.enabled) setReplayPositions(prev => prev.filter(position => position.id !== id));
    else setStoredPositions(prev => prev.filter(position => position.id !== id));
  }, [replayState.enabled, setStoredPositions]);

  const handlePositionUpdate = useCallback((id: string, updates: Partial<Position>) => {
    let rejected = false;
    const updater = (position: Position) => {
      if (position.id !== id) return position;
      const next = { ...position, ...updates };
      const touchedLevels = updates.entry_price != null || updates.tp_price != null || updates.sl_price != null;
      if (touchedLevels && !arePositionLevelsValid(next)) {
        rejected = true;
        return position;
      }
      return next;
    };
    if (replayState.enabled) setReplayPositions(prev => prev.map(updater));
    else setStoredPositions(prev => prev.map(updater));
    if (rejected) showToast('TP/SL 與進場價方向不合法，已保留原設定。');
  }, [replayState.enabled, setStoredPositions, showToast]);

  const enterReplay = useCallback(async () => {
    const fallbackTs = getReplayDefaultAnchorTs(liveCandles, selectedCandle);
    const anchorTs = replayAnchorInvalid ? null : (replayAnchorTsRef.current ?? fallbackTs);
    if (!anchorTs || Number.isNaN(anchorTs)) {
      setReplayAnchorInvalid(true);
      showToast('請先選擇有效的回放時間。');
      return;
    }

    setLoadingMsg('準備回放中...');
    setReplayLoadingFuture(false);
    try {
      const [historyRes, futureRes] = await Promise.all([
        api.getKlines(symbol, interval, { end: anchorTs, limit: replayState.warmupBars }),
        api.getKlines(symbol, interval, { start: anchorTs, limit: replayState.forwardPreloadBars + 1 }),
      ]);
      const merged = mergeUniqueCandles([...historyRes.candles, ...futureRes.candles]);
      if (merged.length === 0) return;

      let cursorIndex = merged.findIndex(candle => candle.t >= anchorTs);
      if (cursorIndex < 0) cursorIndex = merged.length - 1;

      replayHasMorePastRef.current = historyRes.candles.length >= replayState.warmupBars;
      replayHasMoreFutureRef.current = futureRes.candles.length >= replayState.forwardPreloadBars + 1;
      replayLoadingPastRef.current = false;
      replayLoadingFutureRef.current = false;
      replayMarkIdRef.current = -1;

      const anchorCandle = merged[cursorIndex];
      setReplaySourceCandles(merged);
      setReplayMarks([]);
      setReplayPositions([]);
      setReplayState(current => ({
        ...current,
        enabled: true,
        status: 'paused',
        anchorTs: anchorCandle.t,
        cursorIndex,
      }));
      setReplayAnchorTs(anchorCandle.t);
      setReplayAnchorInvalid(false);
      setSelectedCandle(anchorCandle);
      setRangeStart(null);
      setRangeEnd(null);
      setPlacingDirection(null);
      setModal(null);
      queueJump(anchorCandle.t);
    } catch (error) {
      reportError('回放資料載入失敗，請稍後再試。', error);
    } finally {
      setLoadingMsg('');
    }
  }, [interval, liveCandles, queueJump, replayAnchorInvalid, replayState.forwardPreloadBars, replayState.warmupBars, reportError, selectedCandle, showToast, symbol]);

  const exitReplay = useCallback(() => {
    if (replayPositions.length > 0) {
      const confirmed = window.confirm(`您有 ${replayPositions.length} 個回放倉位，退出後將全部清除。確定要離開回放嗎？`);
      if (!confirmed) return;
    }
    setReplayState(resetReplayState);
    setReplaySourceCandles([]);
    setReplayMarks([]);
    setReplayPositions([]);
    setReplayLoadingFuture(false);
    setSelectedCandle(null);
    setRangeStart(null);
    setRangeEnd(null);
    setPlacingDirection(null);
    setModal(null);
    replayHasMorePastRef.current = true;
    replayHasMoreFutureRef.current = true;
    replayLoadingPastRef.current = false;
    replayLoadingFutureRef.current = false;
    replayMarkIdRef.current = -1;
    void loadLiveData();
  }, [loadLiveData, replayPositions.length]);

  const handleReplayPlayPause = useCallback(() => {
    setReplayState(current => {
      if (!current.enabled) return current;
      if (current.status === 'playing') return { ...current, status: 'paused' };
      return { ...current, status: 'playing' };
    });
  }, []);

  const handleReplayStepBack = useCallback(() => {
    setReplayState(current => {
      if (!current.enabled) return current;
      return {
        ...current,
        status: 'paused',
        cursorIndex: Math.max(0, current.cursorIndex - 1),
      };
    });
  }, []);

  const handleReplayStepForward = useCallback(() => {
    setReplayState(current => {
      if (!current.enabled) return current;
      const maxIndex = Math.max(replaySourceCandlesRef.current.length - 1, 0);
      return {
        ...current,
        status: 'paused',
        cursorIndex: Math.min(maxIndex, current.cursorIndex + 1),
      };
    });
  }, []);

  const handleReplayScrub = useCallback((index: number) => {
    setReplayState(current => {
      if (!current.enabled) return current;
      const maxIndex = Math.max(replaySourceCandlesRef.current.length - 1, 0);
      const nextIndex = Math.max(0, Math.min(maxIndex, index));
      return {
        ...current,
        status: 'paused',
        cursorIndex: nextIndex,
      };
    });
  }, []);

  useEffect(() => {
    if (!replayState.enabled || replayState.status !== 'playing') return;

    const timerId = window.setInterval(() => {
      setReplayState(current => {
        if (!current.enabled || current.status !== 'playing') return current;
        const maxIndex = replaySourceCandlesRef.current.length - 1;
        if (current.cursorIndex < maxIndex) {
          return { ...current, cursorIndex: current.cursorIndex + 1 };
        }
        if (replayHasMoreFutureRef.current) return current;
        return { ...current, status: 'ended' };
      });
    }, REPLAY_SPEED_MS[replayState.speed]);

    return () => window.clearInterval(timerId);
  }, [replayState.enabled, replayState.speed, replayState.status]);

  useEffect(() => {
    if (!replayState.enabled) return;

    const handleVisibilityChange = () => {
      if (!document.hidden) return;
      setReplayState(current => (
        current.enabled && current.status === 'playing'
          ? { ...current, status: 'paused' }
          : current
      ));
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [replayState.enabled]);

  useEffect(() => {
    if (!replayState.enabled) return;
    if (replayLoadingFutureRef.current || !replayHasMoreFutureRef.current || replaySourceCandles.length === 0) return;

    const remaining = replaySourceCandles.length - 1 - replayState.cursorIndex;
    if (remaining > REPLAY_PRELOAD_THRESHOLD) return;

    replayLoadingFutureRef.current = true;
    setReplayLoadingFuture(true);
    const lastTs = replaySourceCandles[replaySourceCandles.length - 1].t;
    api.getKlines(symbol, interval, { start: lastTs + 1, limit: replayState.forwardPreloadBars })
      .then(res => {
        if (res.candles.length < replayState.forwardPreloadBars) replayHasMoreFutureRef.current = false;
        if (res.candles.length === 0) return;
        setReplaySourceCandles(prev => mergeUniqueCandles([...prev, ...res.candles]));
      })
      .catch(error => reportError('回放前向預載失敗。', error))
      .finally(() => {
        replayLoadingFutureRef.current = false;
        setReplayLoadingFuture(false);
      });
  }, [interval, replaySourceCandles, replayState.cursorIndex, replayState.enabled, replayState.forwardPreloadBars, reportError, symbol]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      if (modal) return;

      if (event.key === 'Escape' && placingDirection) {
        setPlacingDirection(null);
        event.preventDefault();
        return;
      }
      if (event.key === 'p' || event.key === 'P') {
        setPlacingDirection(prev => (prev === 'long' ? null : 'long'));
        event.preventDefault();
        return;
      }
      if (event.key === 'o' || event.key === 'O') {
        setPlacingDirection(prev => (prev === 'short' ? null : 'short'));
        event.preventDefault();
        return;
      }
      if (replayState.enabled) {
        if (event.code === 'Space') {
          handleReplayPlayPause();
          event.preventDefault();
          return;
        }
        if (event.key === ']' || event.key === 'ArrowRight') {
          handleReplayStepForward();
          event.preventDefault();
          return;
        }
        if (event.key === '[') {
          handleReplayStepBack();
          event.preventDefault();
          return;
        }
        if (event.key === 'ArrowLeft') {
          event.preventDefault();
          return;
        }
      }
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        if (candles.length === 0) return;
        const direction = event.key === 'ArrowLeft' ? -1 : 1;
        let nextIndex: number;
        if (selectedCandle == null) {
          nextIndex = candles.length - 1;
        } else {
          const currentIndex = candles.findIndex(candle => candle.t === selectedCandle.t);
          if (currentIndex < 0) return;
          nextIndex = Math.max(0, Math.min(candles.length - 1, currentIndex + direction));
        }
        const next = candles[nextIndex];
        setSelectedCandle(next);
        setRangeStart(null);
        setRangeEnd(null);
        event.preventDefault();
        return;
      }
      if (!selectedCandle) return;

      switch (event.key) {
        case '1':
          void handleAddMark('bull_dominance');
          break;
        case '2':
          void handleAddMark('bear_dominance');
          break;
        case '3':
          void handleAddMark('force_shift');
          break;
        case 'h':
        case 'H':
          void handleAddMark('valid_swing_high', selectedCandle.h);
          break;
        case 'l':
        case 'L':
          void handleAddMark('valid_swing_low', selectedCandle.l);
          break;
        case 'Delete':
          deleteMarksOnSelected();
          break;
        case 'Escape':
          setSelectedCandle(null);
          setRangeStart(null);
          setRangeEnd(null);
          break;
        default:
          break;
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [candles, deleteMarksOnSelected, handleAddMark, handleReplayPlayPause, handleReplayStepBack, handleReplayStepForward, modal, placingDirection, replayState.enabled, selectedCandle]);

  useEffect(() => {
    if (!autoRefresh || replayState.enabled) return;

    const pollOnce = () => {
      if (document.hidden) return;
      api.getKlines(symbol, interval, { limit: AUTO_REFRESH_TAIL })
        .then(res => {
          if (res.candles.length === 0) return;
          setLiveCandles(prev => {
            if (prev.length === 0) return prev;
            const map = new Map<number, Candle>();
            for (const candle of prev) map.set(candle.t, candle);
            for (const candle of res.candles) map.set(candle.t, candle);
            return Array.from(map.values()).sort((a, b) => a.t - b.t);
          });
        })
        .catch(error => reportError('自動更新最新 K 線失敗。', error));
    };

    const timerId = window.setInterval(pollOnce, AUTO_REFRESH_MS);
    return () => window.clearInterval(timerId);
  }, [autoRefresh, interval, replayState.enabled, reportError, symbol]);

  useLiveSync({
    enabled: liveSyncEnabled,
    symbol,
    pollSec: liveSyncIntervalSec,
    replayEnabled: replayState.enabled,
    onSynced: handleLiveSyncSynced,
    onStatus: handleLiveSyncStatus,
  });

  const handleDateJump = useCallback((ts: number) => {
    queueJump(ts);
  }, [queueJump]);

  const handleReplayAnchorInputChange = useCallback((value: string) => {
    if (!value) {
      replayAnchorTsRef.current = null;
      setReplayAnchorTs(null);
      setReplayAnchorInvalid(false);
      return;
    }
    const ts = parseDateTimeInput(value, timezone);
    if (ts != null) {
      replayAnchorTsRef.current = ts;
      setReplayAnchorTs(ts);
      setReplayAnchorInvalid(false);
      return;
    }
    replayAnchorTsRef.current = null;
    setReplayAnchorTs(null);
    setReplayAnchorInvalid(true);
    showToast('回放時間無法解析，請重新選擇。');
  }, [showToast, timezone]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%' }}>
      <Toolbar
        symbol={symbol}
        interval={interval}
        symbols={symbols}
        showSwings={showSwings}
        pivotN={pivotN}
        swingThresholds={swingThresholds}
        showForce={showForce}
        showRanges={showRanges}
        showMA={showMA}
        maLengths={maLengths}
        maType={maType}
        tdShow={tdShow}
        tdLookback={tdLookback}
        tdSetupLength={tdSetupLength}
        onSymbolChange={setSymbol}
        onIntervalChange={setInterval}
        onDateJump={handleDateJump}
        onToggleSwings={() => setShowSwings(value => !value)}
        onPivotNChange={setPivotN}
        onSwingThresholdsChange={setSwingThresholds}
        onToggleForce={() => setShowForce(value => !value)}
        onToggleRanges={() => setShowRanges(value => !value)}
        onToggleMA={() => setShowMA(value => !value)}
        onMALengthsChange={setMaLengths}
        onMATypeChange={setMaType}
        onToggleTD={() => setTdShow(value => !value)}
        onTDLookbackChange={setTdLookback}
        onTDSetupLengthChange={setTdSetupLength}
        showLastPrice={showLastPrice}
        onToggleLastPrice={() => setShowLastPrice(value => !value)}
        autoRefresh={autoRefresh}
        autoRefreshLocked={replayState.enabled}
        onToggleAutoRefresh={() => setAutoRefresh(value => !value)}
        liveSyncEnabled={liveSyncEnabled}
        liveSyncLocked={replayState.enabled}
        liveSyncPollSec={liveSyncIntervalSec}
        liveSyncStatus={liveSyncStatus}
        liveSyncLastAt={liveSyncLastAt}
        liveSyncCurrentAdded={liveSyncCurrentResult?.added ?? null}
        liveSyncError={liveSyncError}
        liveSyncResults={liveSyncResults}
        onToggleLiveSync={() => setLiveSyncEnabled(value => !value)}
        onLiveSyncPollSecChange={setLiveSyncIntervalSec}
        timezone={timezone}
        onTimezoneChange={setTimezone}
        onOpenLong={() => setPlacingDirection('long')}
        onOpenShort={() => setPlacingDirection('short')}
        placingDirection={placingDirection}
        onCancelPlacing={() => setPlacingDirection(null)}
        replayEnabled={replayState.enabled}
        replayStatus={replayState.status}
        replaySpeed={replayState.speed}
        replayAnchorInput={replayAnchorInputValue}
        replayAnchorInvalid={replayAnchorInvalid}
        replayLoadingFuture={replayLoadingFuture}
        replayCursorIndex={replayState.cursorIndex}
        replayLoadedBars={replaySourceCandles.length}
        onReplayAnchorInputChange={handleReplayAnchorInputChange}
        onStartReplay={enterReplay}
        onStopReplay={exitReplay}
        onReplayPlayPause={handleReplayPlayPause}
        onReplayStepBack={handleReplayStepBack}
        onReplayStepForward={handleReplayStepForward}
        onReplaySpeedChange={speed => setReplayState(current => ({ ...current, speed }))}
        onReplayScrub={handleReplayScrub}
      />

      {loadingMsg && (
        <div style={{
          position: 'absolute',
          top: 50,
          left: '50%',
          transform: 'translateX(-50%)',
          background: 'rgba(30,34,45,0.9)',
          color: '#d1d4dc',
          padding: '6px 16px',
          borderRadius: 4,
          zIndex: 50,
          fontSize: 13,
        }}>
          {loadingMsg}
        </div>
      )}

      {replaySummary && (
        <div style={{
          position: 'fixed',
          left: 16,
          bottom: 16,
          background: 'rgba(30,34,45,0.96)',
          border: '1px solid rgba(255,255,255,0.12)',
          borderRadius: 8,
          padding: '12px 14px',
          zIndex: 110,
          color: '#d1d4dc',
          minWidth: 220,
          boxShadow: '0 8px 24px rgba(0,0,0,0.32)',
        }}>
          <div style={{ fontSize: 12, color: '#787b86', marginBottom: 8, letterSpacing: 0.5 }}>
            回放摘要
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13, marginBottom: 4 }}>
            <span>走過 K 線</span>
            <strong>{replaySummary.bars}</strong>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13, marginBottom: 4 }}>
            <span>倉位數</span>
            <strong>{replaySummary.positions}</strong>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13, marginBottom: 4 }}>
            <span>多 / 空</span>
            <strong>{replaySummary.longCount} / {replaySummary.shortCount}</strong>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13 }}>
            <span>標記數</span>
            <strong>{replaySummary.marks}</strong>
          </div>
        </div>
      )}

      <div style={{
        position: 'fixed',
        right: 16,
        bottom: 16,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        zIndex: 120,
        pointerEvents: 'none',
      }}>
        {toasts.map(toast => (
          <div
            key={toast.id}
            style={{
              background: 'rgba(30,34,45,0.96)',
              color: '#f3f4f8',
              border: '1px solid rgba(255,255,255,0.12)',
              borderLeft: '3px solid #ef5350',
              borderRadius: 6,
              padding: '10px 12px',
              fontSize: 13,
              boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
              maxWidth: 320,
            }}
          >
            {toast.message}
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0, minHeight: 0 }}>
          <Chart
            candles={candles}
            marks={activeMarks}
            swings={swings}
            showSwings={showSwings}
            ranges={detectedRanges}
            showRanges={showRanges}
            maConfigs={maConfigs}
            showMA={showMA}
            maType={maType}
            tdConfig={tdConfig}
            positions={currentPositions}
            timezone={timezone}
            onPositionUpdate={handlePositionUpdate}
            placingDirection={placingDirection}
            showLastPrice={showLastPrice}
            selectedCandleTs={selectedCandle?.t ?? null}
            rangeStartTs={rangeStart?.t ?? null}
            rangeEndTs={rangeEnd?.t ?? null}
            onCandleClick={handleCandleClick}
            onNeedMoreData={handleNeedMoreData}
            onVisibleLogicalRangeChange={(from, to) => {
              if (indicatorLogicalOffset == null) return;
              subChartSetLogicalRef.current?.(from - indicatorLogicalOffset, to - indicatorLogicalOffset);
            }}
            datasetSessionKey={chartDatasetKey}
            jumpRequest={jumpRequest}
          />
          {showForce && (
            <div style={{ height: 160, flexShrink: 0, borderTop: '1px solid #2a2e39' }}>
              <SubChart
                series={indicatorSeries}
                timezone={timezone}
                setLogicalRangeRef={subChartSetLogicalRef}
              />
            </div>
          )}
        </div>

        <MarkPanel
          symbol={symbol}
          interval={interval}
          timezone={timezone}
          selectedCandle={selectedCandle}
          rangeStart={rangeStart}
          rangeEnd={rangeEnd}
          marks={activeMarks}
          onAddMark={handleAddMark}
          onDeleteMark={handleDeleteMark}
        />

        <PositionPanel
          symbol={symbol}
          interval={interval}
          timezone={timezone}
          positions={activePositions}
          currentPrice={latestTs > 0 ? candles[candles.length - 1].c : null}
          onRequestClose={handleRequestClose}
          onDelete={handleDeletePosition}
        />
      </div>

      {modal?.kind === 'entry' && (
        <PositionFormModal
          mode="entry"
          draft={modal.draft}
          timezone={timezone}
          onSubmit={handleEntrySubmit}
          onCancel={() => setModal(null)}
        />
      )}
      {modal?.kind === 'exit' && (
        <PositionFormModal
          mode="exit"
          position={modal.position}
          draft={modal.draft}
          timezone={timezone}
          onSubmit={handleExitSubmit}
          onCancel={() => setModal(null)}
        />
      )}
    </div>
  );
}
