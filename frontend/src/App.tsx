import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api/client';
import { Chart } from './components/Chart';
import { MarkPanel } from './components/MarkPanel';
import { SubChart } from './components/SubChart';
import { Toolbar } from './components/Toolbar';
import type { Candle, DetectedRange, IndicatorPoint, LabelType, Mark, MAConfig, SwingPoint, SwingThresholds, SymbolInfo } from './types';
import { MA_COLOR_PALETTE } from './types';
import { useLocalStorage } from './utils/useLocalStorage';

const INITIAL_LIMIT = 500;
const MORE_LIMIT    = 300;
const AUTO_REFRESH_MS = 30_000;   // poll latest candle every 30s
const AUTO_REFRESH_TAIL = 5;      // fetch last N candles per poll for merge

const DEFAULT_SWING_THRESHOLDS: SwingThresholds = { approach: 0.5, rejection: 0.55, departureAtr: 0.5 };

export default function App() {
  // Persisted UI state — restored from localStorage on mount
  const [symbol,    setSymbol]    = useLocalStorage<string>('symbol', 'BTCUSDT');
  const [interval,  setInterval]  = useLocalStorage<string>('interval', '1h');
  const [showSwings,     setShowSwings]     = useLocalStorage<boolean>('showSwings', false);
  const [pivotN,         setPivotN]         = useLocalStorage<number>('pivotN', 5);
  const [swingThresholds, setSwingThresholds] = useLocalStorage<SwingThresholds>('swingThresholds', DEFAULT_SWING_THRESHOLDS);
  const [showForce,      setShowForce]      = useLocalStorage<boolean>('showForce', false);
  const [showRanges,     setShowRanges]     = useLocalStorage<boolean>('showRanges', false);
  const [showMA,          setShowMA]        = useLocalStorage<boolean>('showMA', false);
  const [maLengths,       setMaLengths]     = useLocalStorage<number[]>('maLengths', [20, 60]);
  const [maType,          setMaType]        = useLocalStorage<'sma' | 'ema'>('maType', 'sma');
  const [tdShow,          setTdShow]        = useLocalStorage<boolean>('tdShow', false);
  const [tdLookback,      setTdLookback]    = useLocalStorage<number>('tdLookback', 4);
  const [tdSetupLength,   setTdSetupLength] = useLocalStorage<number>('tdSetupLength', 9);

  // Non-persisted runtime state
  const [candles,   setCandles]   = useState<Candle[]>([]);
  const [marks,     setMarks]     = useState<Mark[]>([]);
  const [symbols,   setSymbols]   = useState<SymbolInfo[]>([]);
  const [swings,         setSwings]         = useState<SwingPoint[]>([]);
  const [indicatorSeries, setIndicatorSeries] = useState<IndicatorPoint[]>([]);
  const [detectedRanges,  setDetectedRanges]  = useState<DetectedRange[]>([]);

  const maConfigs = useMemo<MAConfig[]>(
    () => maLengths.map((length, i) => ({ length, color: MA_COLOR_PALETTE[i % MA_COLOR_PALETTE.length] })),
    [maLengths],
  );
  const tdConfig = useMemo(
    () => ({ show: tdShow, lookback: tdLookback, setupLength: tdSetupLength }),
    [tdShow, tdLookback, tdSetupLength],
  );
  // Ref the SubChart's setVisibleLogicalRange so we can drive sync without React state
  const subChartSetLogicalRef = useRef<((from: number, to: number) => void) | null>(null);
  // Track series lengths in refs so the range-sync lambda always reads current values
  const candlesLenRef    = useRef(0);
  const indicatorLenRef  = useRef(0);
  candlesLenRef.current   = candles.length;
  indicatorLenRef.current = indicatorSeries.length;
  const [selectedCandle, setSelectedCandle] = useState<Candle | null>(null);
  const [rangeStart, setRangeStart] = useState<Candle | null>(null);
  const [rangeEnd,   setRangeEnd]   = useState<Candle | null>(null);
  const [jumpToTs,   setJumpToTs]   = useState<number | null>(null);
  const [loadingMsg, setLoadingMsg] = useState('');
  const hasMoreRef = useRef(true);

  // Load symbol list once
  useEffect(() => {
    api.getSymbols().then(setSymbols).catch(console.error);
  }, []);

  // Reload candles + marks when symbol/interval changes
  useEffect(() => {
    setCandles([]);
    setSelectedCandle(null);
    setRangeStart(null);
    setRangeEnd(null);
    hasMoreRef.current = true;

    setLoadingMsg('載入 K 線中…');
    api.getKlines(symbol, interval, { limit: INITIAL_LIMIT })
      .then(res => setCandles(res.candles))
      .catch(console.error)
      .finally(() => setLoadingMsg(''));

    api.getMarks(symbol, interval).then(setMarks).catch(console.error);
  }, [symbol, interval]);

  // Fetch swings whenever symbol/interval/pivotN/thresholds change (and swings are visible)
  useEffect(() => {
    if (!showSwings) { setSwings([]); return; }
    api.getSwings(symbol, interval, pivotN, 500, swingThresholds)
      .then(setSwings)
      .catch(console.error);
  }, [symbol, interval, pivotN, showSwings, swingThresholds]);

  // Fetch indicator series for force_ratio sub-chart
  useEffect(() => {
    if (!showForce) { setIndicatorSeries([]); return; }
    api.getIndicatorSeries(symbol, interval)
      .then(res => setIndicatorSeries(res.series))
      .catch(console.error);
  }, [symbol, interval, showForce]);

  // Fetch consolidation ranges
  useEffect(() => {
    if (!showRanges) { setDetectedRanges([]); return; }
    api.getRanges(symbol, interval)
      .then(setDetectedRanges)
      .catch(console.error);
  }, [symbol, interval, showRanges]);

  const refreshMarks = useCallback(() => {
    api.getMarks(symbol, interval).then(setMarks).catch(console.error);
  }, [symbol, interval]);

  // Infinite scroll: load older candles
  const handleNeedMoreData = useCallback((beforeTs: number) => {
    if (!hasMoreRef.current) return;
    api.getKlines(symbol, interval, { end: beforeTs - 1, limit: MORE_LIMIT })
      .then(res => {
        if (res.candles.length < MORE_LIMIT) hasMoreRef.current = false;
        if (res.candles.length === 0) return;
        setCandles(prev => {
          const existing = new Set(prev.map(c => c.t));
          const newOnes  = res.candles.filter(c => !existing.has(c.t));
          return [...newOnes, ...prev];
        });
      })
      .catch(console.error);
  }, [symbol, interval]);

  // Candle click handler
  const handleCandleClick = useCallback((candle: Candle, isShift: boolean) => {
    if (isShift) {
      if (!rangeStart || (rangeStart && rangeEnd)) {
        setRangeStart(candle);
        setRangeEnd(null);
        setSelectedCandle(candle);
      } else {
        const [a, b] = candle.t < rangeStart.t ? [candle, rangeStart] : [rangeStart, candle];
        setRangeStart(a);
        setRangeEnd(b);
        setSelectedCandle(b);
      }
    } else {
      setSelectedCandle(candle);
      setRangeStart(null);
      setRangeEnd(null);
    }
  }, [rangeStart, rangeEnd]);

  // Add mark
  const handleAddMark = useCallback(async (labelType: LabelType, price?: number) => {
    if (!selectedCandle) return;
    try {
      await api.createMark({
        symbol, interval,
        timestamp: selectedCandle.t,
        label_type: labelType,
        price: price ?? selectedCandle.c,
      });
      refreshMarks();
    } catch (e) {
      console.error('Failed to add mark', e);
    }
  }, [selectedCandle, symbol, interval, refreshMarks]);

  // Delete mark
  const handleDeleteMark = useCallback(async (id: number) => {
    try {
      await api.deleteMark(id);
      refreshMarks();
    } catch (e) {
      console.error('Failed to delete mark', e);
    }
  }, [refreshMarks]);

  // Delete ALL marks on selected candle
  const deleteMarksOnSelected = useCallback(() => {
    if (!selectedCandle) return;
    const toDelete = marks.filter(m => m.timestamp === selectedCandle.t);
    Promise.all(toDelete.map(m => api.deleteMark(m.id)))
      .then(refreshMarks)
      .catch(console.error);
  }, [selectedCandle, marks, refreshMarks]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      // Arrow keys move selection one candle — work even without a prior selection
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        if (candles.length === 0) return;
        const dir = e.key === 'ArrowLeft' ? -1 : 1;
        let idx: number;
        if (selectedCandle == null) {
          idx = candles.length - 1; // no selection yet → start at the latest bar
        } else {
          const cur = candles.findIndex(c => c.t === selectedCandle.t);
          if (cur < 0) return;
          idx = Math.max(0, Math.min(candles.length - 1, cur + dir));
        }
        const next = candles[idx];
        setSelectedCandle(next);
        setRangeStart(null);
        setRangeEnd(null);
        e.preventDefault();
        return;
      }
      if (!selectedCandle) return;
      switch (e.key) {
        case '1': handleAddMark('bull_dominance'); break;
        case '2': handleAddMark('bear_dominance'); break;
        case '3': handleAddMark('force_shift'); break;
        case 'h': case 'H': handleAddMark('valid_swing_high', selectedCandle.h); break;
        case 'l': case 'L': handleAddMark('valid_swing_low',  selectedCandle.l); break;
        case 'Delete': deleteMarksOnSelected(); break;
        case 'Escape':
          setSelectedCandle(null);
          setRangeStart(null);
          setRangeEnd(null);
          break;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selectedCandle, candles, handleAddMark, deleteMarksOnSelected]);

  // Auto-refresh: poll the last few candles periodically and merge into state.
  // Pauses when tab is hidden so background tabs don't hammer the API.
  useEffect(() => {
    const pollOnce = () => {
      if (document.hidden) return;
      api.getKlines(symbol, interval, { limit: AUTO_REFRESH_TAIL })
        .then(res => {
          if (res.candles.length === 0) return;
          setCandles(prev => {
            if (prev.length === 0) return prev; // initial load handles first fill
            const map = new Map<number, Candle>();
            for (const c of prev) map.set(c.t, c);
            for (const c of res.candles) map.set(c.t, c); // upsert: replace in-progress bar, append new
            return Array.from(map.values()).sort((a, b) => a.t - b.t);
          });
        })
        .catch(console.error);
    };
    const id = window.setInterval(pollOnce, AUTO_REFRESH_MS);
    return () => window.clearInterval(id);
  }, [symbol, interval]);

  // Date jump
  const handleDateJump = useCallback((ts: number) => {
    setJumpToTs(ts);
    setTimeout(() => setJumpToTs(null), 100);
  }, []);

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
        onSymbolChange={sym => setSymbol(sym)}
        onIntervalChange={iv => setInterval(iv)}
        onDateJump={handleDateJump}
        onToggleSwings={() => setShowSwings(v => !v)}
        onPivotNChange={setPivotN}
        onSwingThresholdsChange={setSwingThresholds}
        onToggleForce={() => setShowForce(v => !v)}
        onToggleRanges={() => setShowRanges(v => !v)}
        onToggleMA={() => setShowMA(v => !v)}
        onMALengthsChange={setMaLengths}
        onMATypeChange={setMaType}
        onToggleTD={() => setTdShow(v => !v)}
        onTDLookbackChange={setTdLookback}
        onTDSetupLengthChange={setTdSetupLength}
      />

      {loadingMsg && (
        <div style={{
          position: 'absolute', top: 50, left: '50%', transform: 'translateX(-50%)',
          background: 'rgba(30,34,45,0.9)', color: '#d1d4dc',
          padding: '6px 16px', borderRadius: 4, zIndex: 50, fontSize: 13,
        }}>
          {loadingMsg}
        </div>
      )}

      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {/* Left: main chart stack + optional sub-chart */}
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0, minHeight: 0 }}>
          <Chart
            candles={candles}
            marks={marks}
            swings={swings}
            showSwings={showSwings}
            ranges={detectedRanges}
            showRanges={showRanges}
            maConfigs={maConfigs}
            showMA={showMA}
            maType={maType}
            tdConfig={tdConfig}
            selectedCandleTs={selectedCandle?.t ?? null}
            rangeStartTs={rangeStart?.t ?? null}
            rangeEndTs={rangeEnd?.t ?? null}
            onCandleClick={handleCandleClick}
            onNeedMoreData={handleNeedMoreData}
            onVisibleLogicalRangeChange={(from, to) => {
              if (indicatorLenRef.current === 0) return;
              // Both charts end at the same timestamp; sub's bar 0 = main's bar (offset).
              // Subtracting offset translates main's logical indices into sub's frame,
              // so main scrolling past its last bar pans sub past its last bar too.
              const offset = candlesLenRef.current - indicatorLenRef.current;
              subChartSetLogicalRef.current?.(from - offset, to - offset);
            }}
            jumpToTs={jumpToTs}
          />
          {showForce && (
            <div style={{ height: 160, flexShrink: 0, borderTop: '1px solid #2a2e39' }}>
              <SubChart
                series={indicatorSeries}
                setLogicalRangeRef={subChartSetLogicalRef}
              />
            </div>
          )}
        </div>
        <MarkPanel
          symbol={symbol}
          interval={interval}
          selectedCandle={selectedCandle}
          rangeStart={rangeStart}
          rangeEnd={rangeEnd}
          marks={marks}
          onAddMark={handleAddMark}
          onDeleteMark={handleDeleteMark}
        />
      </div>
    </div>
  );
}
