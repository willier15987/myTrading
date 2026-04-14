import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api/client';
import { Chart } from './components/Chart';
import { MarkPanel } from './components/MarkPanel';
import { SubChart } from './components/SubChart';
import { Toolbar } from './components/Toolbar';
import type { Candle, DetectedRange, IndicatorPoint, LabelType, Mark, SwingPoint, SymbolInfo } from './types';

const INITIAL_LIMIT = 500;
const MORE_LIMIT    = 300;

export default function App() {
  const [symbol,    setSymbol]    = useState('BTCUSDT');
  const [interval,  setInterval]  = useState('1h');
  const [candles,   setCandles]   = useState<Candle[]>([]);
  const [marks,     setMarks]     = useState<Mark[]>([]);
  const [symbols,   setSymbols]   = useState<SymbolInfo[]>([]);
  const [swings,         setSwings]         = useState<SwingPoint[]>([]);
  const [showSwings,     setShowSwings]     = useState(false);
  const [pivotN,         setPivotN]         = useState(5);
  const [showForce,      setShowForce]      = useState(false);
  const [showRanges,     setShowRanges]     = useState(false);
  const [indicatorSeries, setIndicatorSeries] = useState<IndicatorPoint[]>([]);
  const [detectedRanges,  setDetectedRanges]  = useState<DetectedRange[]>([]);
  // Ref the SubChart's setVisibleRange so we can drive sync without React state
  const subChartSetRangeRef = useRef<((fromMs: number, toMs: number) => void) | null>(null);
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

  // Fetch swings whenever symbol/interval/pivotN changes (and swings are visible)
  useEffect(() => {
    if (!showSwings) { setSwings([]); return; }
    api.getSwings(symbol, interval, pivotN)
      .then(setSwings)
      .catch(console.error);
  }, [symbol, interval, pivotN, showSwings]);

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
      if (!selectedCandle) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
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
  }, [selectedCandle, handleAddMark, deleteMarksOnSelected]);

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
        showForce={showForce}
        showRanges={showRanges}
        onSymbolChange={sym => setSymbol(sym)}
        onIntervalChange={iv => setInterval(iv)}
        onDateJump={handleDateJump}
        onToggleSwings={() => setShowSwings(v => !v)}
        onPivotNChange={setPivotN}
        onToggleForce={() => setShowForce(v => !v)}
        onToggleRanges={() => setShowRanges(v => !v)}
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
            selectedCandleTs={selectedCandle?.t ?? null}
            rangeStartTs={rangeStart?.t ?? null}
            rangeEndTs={rangeEnd?.t ?? null}
            onCandleClick={handleCandleClick}
            onNeedMoreData={handleNeedMoreData}
            onVisibleRangeChange={(from, to) => subChartSetRangeRef.current?.(from, to)}
            jumpToTs={jumpToTs}
          />
          {showForce && (
            <div style={{ height: 160, flexShrink: 0, borderTop: '1px solid #2a2e39' }}>
              <SubChart
                series={indicatorSeries}
                setRangeRef={subChartSetRangeRef}
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
