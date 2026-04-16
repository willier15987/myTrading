import React, { useEffect, useLayoutEffect, useRef } from 'react';
import {
  createChart,
  createSeriesMarkers,
  CandlestickSeries,
  LineSeries,
  ColorType,
  CrosshairMode,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type CandlestickData,
  type UTCTimestamp,
  type SeriesMarker,
} from 'lightweight-charts';

import type { Candle, DetectedRange, LabelType, Mark, MAConfig, Position, PositionDirection, SwingPoint, TDConfig } from '../types';
import { LABEL_META } from '../types';
import { formatPrice, getPriceFormat } from '../utils/price';
import { type AppTimeZone, formatChartTime } from '../utils/time';
import { PositionPrimitive } from './position-primitive';
import { SelectedCandlePrimitive } from './selected-candle-primitive';

// Price line handle returned by series.createPriceLine()
type PriceLineHandle = ReturnType<ISeriesApi<'Candlestick'>['createPriceLine']>;
type MarkerTime = CandlestickData['time'];

interface MarkerConfig {
  position: 'aboveBar' | 'belowBar';
  shape: 'arrowUp' | 'arrowDown' | 'circle' | 'square';
  color: string;
  text: string;
}

const MARK_MARKER: Record<LabelType, MarkerConfig> = {
  bull_dominance:   { position: 'belowBar', shape: 'arrowUp',   color: '#26a69a', text: 'B' },
  bear_dominance:   { position: 'aboveBar', shape: 'arrowDown', color: '#ef5350', text: 'S' },
  force_shift:      { position: 'belowBar', shape: 'circle',    color: '#FFC107', text: 'F' },
  valid_swing_high: { position: 'aboveBar', shape: 'square',    color: '#ef5350', text: 'H' },
  valid_swing_low:  { position: 'belowBar', shape: 'square',    color: '#26a69a', text: 'L' },
};
const JUMP_VISIBLE_BARS = 100;

function computeSMA(candles: Candle[], length: number): { time: UTCTimestamp; value: number }[] {
  if (length <= 0 || candles.length < length) return [];
  const out: { time: UTCTimestamp; value: number }[] = [];
  let sum = 0;
  for (let i = 0; i < candles.length; i++) {
    sum += candles[i].c;
    if (i >= length) sum -= candles[i - length].c;
    if (i >= length - 1) {
      out.push({ time: (candles[i].t / 1000) as UTCTimestamp, value: sum / length });
    }
  }
  return out;
}

function computeEMA(candles: Candle[], length: number): { time: UTCTimestamp; value: number }[] {
  if (length <= 0 || candles.length < length) return [];
  const out: { time: UTCTimestamp; value: number }[] = [];
  const k = 2 / (length + 1);
  let sum = 0;
  for (let i = 0; i < length; i++) sum += candles[i].c;
  let ema = sum / length;
  out.push({ time: (candles[length - 1].t / 1000) as UTCTimestamp, value: ema });
  for (let i = length; i < candles.length; i++) {
    ema = (candles[i].c - ema) * k + ema;
    out.push({ time: (candles[i].t / 1000) as UTCTimestamp, value: ema });
  }
  return out;
}

function computeTDSetup(candles: Candle[], lookback: number, setupLength: number) {
  const n = candles.length;
  const buy = new Array<number>(n).fill(0);
  const sell = new Array<number>(n).fill(0);
  for (let i = lookback; i < n; i++) {
    const prev = candles[i - lookback].c;
    const cur = candles[i].c;
    if (cur < prev) buy[i] = (buy[i - 1] || 0) + 1;
    if (cur > prev) sell[i] = (sell[i - 1] || 0) + 1;
    // cap display range: past setupLength keep incrementing only if same direction continues,
    // but only numbers 1..setupLength are rendered (we wrap back to 1 after completion)
    if (buy[i] > setupLength) buy[i] = ((buy[i] - 1) % setupLength) + 1;
    if (sell[i] > setupLength) sell[i] = ((sell[i] - 1) % setupLength) + 1;
  }
  return { buy, sell };
}

interface ChartProps {
  candles: Candle[];
  marks: Mark[];
  swings: SwingPoint[];
  showSwings: boolean;
  ranges: DetectedRange[];
  showRanges: boolean;
  maConfigs: MAConfig[];
  showMA: boolean;
  maType: 'sma' | 'ema';
  tdConfig: TDConfig;
  positions: Position[];
  timezone: AppTimeZone;
  placingDirection?: PositionDirection | null;
  showLastPrice: boolean;
  selectedCandleTs: number | null;
  rangeStartTs: number | null;
  rangeEndTs: number | null;
  onCandleClick: (candle: Candle, isShift: boolean, clickedPrice: number | null) => void;
  onNeedMoreData: (beforeTs: number) => void;
  onVisibleLogicalRangeChange?: (from: number, to: number) => void;
  onPositionUpdate?: (id: string, updates: Partial<Position>) => void;
  datasetSessionKey: string;
  jumpRequest: { ts: number; token: number } | null;
}

type PosField = 'entry_price' | 'tp_price' | 'sl_price';

export function Chart({ candles, marks, swings, showSwings, ranges, showRanges, maConfigs, showMA, maType, tdConfig, positions, timezone, placingDirection, showLastPrice, selectedCandleTs, rangeStartTs, rangeEndTs, onCandleClick, onNeedMoreData, onVisibleLogicalRangeChange, onPositionUpdate, datasetSessionKey, jumpRequest }: ChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef     = useRef<IChartApi | null>(null);
  const seriesRef    = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const markerPrimitiveRef = useRef<ISeriesMarkersPluginApi<MarkerTime> | null>(null);
  const selectedPrimitiveRef = useRef<SelectedCandlePrimitive | null>(null);
  const priceLines      = useRef<Map<number, PriceLineHandle>>(new Map());
  const selLineRef      = useRef<PriceLineHandle | null>(null);
  const rangeLines      = useRef<PriceLineHandle[]>([]);
  const isShiftRef   = useRef(false);
  const isLoadingMore = useRef(false);
  const candlesRef   = useRef<Candle[]>([]);
  const rangeBandsRef = useRef<ISeriesApi<'Line'>[]>([]);
  const maSeriesRef   = useRef<ISeriesApi<'Line'>[]>([]);
  const positionPrimitivesRef = useRef<Map<string, PositionPrimitive>>(new Map());
  const dragOverlayRef   = useRef<HTMLDivElement>(null);
  const handlesRef       = useRef<Map<string, HTMLDivElement>>(new Map());
  const draggingRef      = useRef<{ key: string; positionId: string; field: PosField; price: number } | null>(null);
  const pendingDatasetResetRef = useRef(false);
  const pendingDatasetJumpRef = useRef(false);
  const latestJumpRequestRef = useRef<{ ts: number; token: number } | null>(null);
  const lastAppliedJumpTokenRef = useRef<number | null>(null);

  // Keep latest callbacks accessible inside stable chart event handlers
  const onClickRef       = useRef(onCandleClick);
  const onMoreRef        = useRef(onNeedMoreData);
  const onLogicalRangeRef = useRef(onVisibleLogicalRangeChange);
  const onPositionUpdateRef = useRef(onPositionUpdate);
  useLayoutEffect(() => { onClickRef.current        = onCandleClick; });
  useLayoutEffect(() => { onMoreRef.current         = onNeedMoreData; });
  useLayoutEffect(() => { onLogicalRangeRef.current = onVisibleLogicalRangeChange; });
  useLayoutEffect(() => { onPositionUpdateRef.current = onPositionUpdate; });

  // Track shift key
  useEffect(() => {
    const dn = (e: KeyboardEvent) => { if (e.key === 'Shift') isShiftRef.current = true; };
    const up = (e: KeyboardEvent) => { if (e.key === 'Shift') isShiftRef.current = false; };
    window.addEventListener('keydown', dn);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', dn); window.removeEventListener('keyup', up); };
  }, []);

  // ── Initialize chart once ──
  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height: containerRef.current.clientHeight,
      layout: {
        background: { type: ColorType.Solid, color: '#131722' },
        textColor: '#d1d4dc',
      },
      grid: {
        vertLines: { color: 'rgba(42,46,57,0.5)' },
        horzLines: { color: 'rgba(42,46,57,0.5)' },
      },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: 'rgba(197,203,206,0.4)' },
      timeScale: {
        borderColor: 'rgba(197,203,206,0.4)',
        timeVisible: true,
        secondsVisible: false,
        tickMarkFormatter: (time: number) => formatChartTime(time, timezone),
      },
      localization: {
        timeFormatter: (time: number) => formatChartTime(time, timezone),
      },
    });

    const series = chart.addSeries(CandlestickSeries, {
      upColor: '#26a69a',
      downColor: '#ef5350',
      borderDownColor: '#ef5350',
      borderUpColor: '#26a69a',
      wickDownColor: '#ef5350',
      wickUpColor: '#26a69a',
    });
    chartRef.current = chart;
    seriesRef.current = series;
    markerPrimitiveRef.current = createSeriesMarkers(series, []);
    selectedPrimitiveRef.current = new SelectedCandlePrimitive();
    series.attachPrimitive(selectedPrimitiveRef.current);

    // Click → select candle. Also resolve the click's Y coordinate back to a price
    // so placing mode can use the crosshair price (not just the candle close).
    chart.subscribeClick((param) => {
      if (!param.time) return;
      const tsMs = (param.time as number) * 1000;
      const candle = candlesRef.current.find(c => c.t === tsMs);
      if (!candle) return;
      let clickedPrice: number | null = null;
      if (param.point && seriesRef.current) {
        const pv = seriesRef.current.coordinateToPrice(param.point.y);
        if (pv != null && Number.isFinite(pv)) clickedPrice = pv as number;
      }
      onClickRef.current(candle, isShiftRef.current, clickedPrice);
    });

    // Scroll left → load more historical data; also drive SubChart sync via logical range
    chart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
      if (!range) return;
      if (range.from <= 30 && !isLoadingMore.current && candlesRef.current.length > 0) {
        isLoadingMore.current = true;
        onMoreRef.current(candlesRef.current[0].t);
      }
      onLogicalRangeRef.current?.(range.from, range.to);
    });

    // Resize observer
    const ro = new ResizeObserver((entries) => {
      const e = entries[0];
      if (e && chartRef.current) {
        chartRef.current.applyOptions({
          width: e.contentRect.width,
          height: e.contentRect.height,
        });
      }
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      markerPrimitiveRef.current?.detach();
      markerPrimitiveRef.current = null;
      if (selectedPrimitiveRef.current) {
        try { series.detachPrimitive(selectedPrimitiveRef.current); } catch { /* ignore */ }
        selectedPrimitiveRef.current = null;
      }
      chart.remove();
      chartRef.current  = null;
      seriesRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!chartRef.current) return;
    chartRef.current.applyOptions({
      timeScale: {
        tickMarkFormatter: (time: number) => formatChartTime(time, timezone),
      },
      localization: {
        timeFormatter: (time: number) => formatChartTime(time, timezone),
      },
    });
  }, [timezone]);

  const applyJumpRequest = (request: { ts: number; token: number }) => {
    if (!chartRef.current || candlesRef.current.length === 0) return;

    const cs = candlesRef.current;
    let nearest = cs[0];
    for (const c of cs) {
      if (Math.abs(c.t - request.ts) < Math.abs(nearest.t - request.ts)) nearest = c;
    }

    const idx = cs.indexOf(nearest);
    const maxIndex = cs.length - 1;
    const halfWindow = Math.floor(JUMP_VISIBLE_BARS / 2);
    let from = idx - halfWindow;
    let to = idx + halfWindow;

    if (from < 0) {
      to = Math.min(maxIndex, to - from);
      from = 0;
    }
    if (to > maxIndex) {
      from = Math.max(0, from - (to - maxIndex));
      to = maxIndex;
    }

    chartRef.current.timeScale().setVisibleLogicalRange({
      from,
      to,
    });
    lastAppliedJumpTokenRef.current = request.token;
  };

  useEffect(() => {
    pendingDatasetResetRef.current = true;
    pendingDatasetJumpRef.current = false;
    prevFirstTsRef.current = null;
  }, [datasetSessionKey]);

  useEffect(() => {
    latestJumpRequestRef.current = jumpRequest;
    if (jumpRequest == null || candlesRef.current.length === 0) return;
    if (lastAppliedJumpTokenRef.current === jumpRequest.token) return;

    if (pendingDatasetResetRef.current) {
      pendingDatasetJumpRef.current = true;
      return;
    }

    applyJumpRequest(jumpRequest);
  }, [jumpRequest]);

  // Track the first candle's timestamp from the previous render to detect prepend vs. full reload
  const prevFirstTsRef = useRef<number | null>(null);

  // ── Update candles data ──
  useEffect(() => {
    if (!seriesRef.current) return;
    if (candles.length === 0) {
      // Full reset (e.g. symbol/interval change) — clear first-ts tracking so the
      // next load is treated as a fresh reload rather than a tail merge.
      prevFirstTsRef.current = null;
      return;
    }

    const newFirstTs   = candles[0].t;
    const prevFirstTs  = prevFirstTsRef.current;
    const isDatasetReset = pendingDatasetResetRef.current;
    const isPrepend    = prevFirstTs !== null && newFirstTs < prevFirstTs;
    const isTailMerge  = prevFirstTs !== null && newFirstTs === prevFirstTs;
    prevFirstTsRef.current = newFirstTs;

    isLoadingMore.current = false;
    candlesRef.current = candles;

    // Preserve the current viewport on prepend and tail-append updates.
    // Logical range is more stable than time range for replay/step-forward because
    // it keeps the current bar-index window instead of re-centering on timestamps.
    const preserveRange = !isDatasetReset && (isPrepend || isTailMerge);
    const logicalRange = preserveRange ? chartRef.current?.timeScale().getVisibleLogicalRange() : null;

    const data: CandlestickData[] = candles.map(c => ({
      time: (c.t / 1000) as UTCTimestamp,
      open: c.o,
      high: c.h,
      low: c.l,
      close: c.c,
    }));
    seriesRef.current.setData(data);
    seriesRef.current.applyOptions({
      priceFormat: {
        type: 'price',
        ...getPriceFormat(candles[candles.length - 1].c),
      },
    });

    if (logicalRange) {
      chartRef.current?.timeScale().setVisibleLogicalRange(logicalRange);
    } else if (isDatasetReset && pendingDatasetJumpRef.current && latestJumpRequestRef.current) {
      pendingDatasetJumpRef.current = false;
      applyJumpRequest(latestJumpRequestRef.current);
    } else {
      // Initial / full reload: scroll to the latest (rightmost) candle
      chartRef.current?.timeScale().scrollToPosition(0, false);
    }
    pendingDatasetResetRef.current = false;
  }, [candles]);

  // Highlight the selected candle without re-setting the full main series.
  useEffect(() => {
    if (!selectedPrimitiveRef.current) return;
    const selected = selectedCandleTs == null
      ? null
      : candlesRef.current.find(c => c.t === selectedCandleTs) ?? null;
    selectedPrimitiveRef.current.setSelection(selected, candlesRef.current);
  }, [candles, selectedCandleTs]);

  // ── Update marks + swings (price lines + series markers) ──
  // Combined into one effect so setMarkers is called once with all markers merged.
  useEffect(() => {
    if (!seriesRef.current) return;

    // ── 1. Clear old manual-mark price lines ──
    priceLines.current.forEach(pl => {
      try { seriesRef.current?.removePriceLine(pl); } catch { /* ignore */ }
    });
    priceLines.current.clear();

    const markers: SeriesMarker<MarkerTime>[] = [];

    // ── 3. Manual marks ──
    marks.forEach(mark => {
      const cfg = MARK_MARKER[mark.label_type as LabelType];
      if (!cfg) return;
      const timeS = (mark.timestamp / 1000) as UTCTimestamp;

      if ((mark.label_type === 'valid_swing_high' || mark.label_type === 'valid_swing_low') && mark.price) {
        const pl = seriesRef.current!.createPriceLine({
          price: mark.price,
          color: cfg.color,
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: cfg.text,
        });
        priceLines.current.set(mark.id, pl);
      }

      markers.push({
        time: timeS,
        position: cfg.position,
        shape: cfg.shape,
        color: cfg.color,
        text: cfg.text,
        id: `mark-${mark.id}`,
      });
    });

    // ── 4. Auto-detected swings ──
    if (showSwings) {
      swings.forEach((sw, i) => {
        const timeS = (sw.timestamp / 1000) as UTCTimestamp;
        const isHigh = sw.type === 'high';

        if (sw.is_valid) {
          // Valid: large circle directly on the candle, bright color
          markers.push({
            time: timeS,
            position: isHigh ? 'aboveBar' : 'belowBar',
            shape: 'circle',
            color: isHigh ? '#FF6B6B' : '#4DD0C4',
            text: isHigh ? 'H' : 'L',
            size: 2,
            id: `swing-valid-${i}`,
          });
        } else {
          // Invalid: small dim circle
          markers.push({
            time: timeS,
            position: isHigh ? 'aboveBar' : 'belowBar',
            shape: 'circle',
            color: isHigh ? 'rgba(255,107,107,0.4)' : 'rgba(77,208,196,0.4)',
            text: '',
            size: 1,
            id: `swing-invalid-${i}`,
          });
        }
      });
    }

    // ── 5. TD Sequential Setup numbers ──
    if (tdConfig.show && candles.length > tdConfig.lookback) {
      const { buy, sell } = computeTDSetup(candles, tdConfig.lookback, tdConfig.setupLength);
      for (let i = 0; i < candles.length; i++) {
        const timeS = (candles[i].t / 1000) as UTCTimestamp;
        if (buy[i] >= 1) {
          const isComplete = buy[i] === tdConfig.setupLength;
          markers.push({
            time: timeS,
            position: 'belowBar',
            shape: 'circle',
            color: isComplete ? '#26a69a' : 'rgba(38,166,154,0.55)',
            text: String(buy[i]),
            size: isComplete ? 1 : 0,
            id: `td-buy-${i}`,
          });
        }
        if (sell[i] >= 1) {
          const isComplete = sell[i] === tdConfig.setupLength;
          markers.push({
            time: timeS,
            position: 'aboveBar',
            shape: 'circle',
            color: isComplete ? '#ef5350' : 'rgba(239,83,80,0.55)',
            text: String(sell[i]),
            size: isComplete ? 1 : 0,
            id: `td-sell-${i}`,
          });
        }
      }
    }

    // ── 6. Position entry / exit markers ──
    for (const p of positions) {
      const entryTs = (p.entry_ts / 1000) as UTCTimestamp;
      const isLong = p.direction === 'long';
      markers.push({
        time: entryTs,
        position: isLong ? 'belowBar' : 'aboveBar',
        shape: isLong ? 'arrowUp' : 'arrowDown',
        color: isLong ? '#26a69a' : '#ef5350',
        text: isLong ? '開多' : '開空',
        size: 2,
        id: `pos-entry-${p.id}`,
      });
      if (p.exit_ts != null) {
        markers.push({
          time: (p.exit_ts / 1000) as UTCTimestamp,
          position: isLong ? 'aboveBar' : 'belowBar',
          shape: 'square',
          color: '#787b86',
          text: '平倉',
          size: 1,
          id: `pos-exit-${p.id}`,
        });
      }
    }

    // lightweight-charts requires markers sorted by time
    markers.sort((a, b) => (a.time as number) - (b.time as number));
    markerPrimitiveRef.current?.setMarkers(markers);
  }, [marks, swings, showSwings, candles, tdConfig, positions]);

  // ── Moving averages ──
  useEffect(() => {
    if (!chartRef.current) return;
    maSeriesRef.current.forEach(s => {
      try { chartRef.current?.removeSeries(s); } catch { /* ignore */ }
    });
    maSeriesRef.current = [];
    if (!showMA || candles.length === 0) return;

    const label = maType.toUpperCase();
    maConfigs.forEach(cfg => {
      const s = chartRef.current!.addSeries(LineSeries, {
        color: cfg.color,
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: true,
        crosshairMarkerVisible: false,
        title: `${label}${cfg.length}`,
      });
      const data = maType === 'ema' ? computeEMA(candles, cfg.length) : computeSMA(candles, cfg.length);
      s.setData(data);
      maSeriesRef.current.push(s);
    });
  }, [candles, maConfigs, showMA, maType]);

  // ── Selected candle highlight line ──
  useEffect(() => {
    if (!seriesRef.current) return;
    if (selLineRef.current) {
      try { seriesRef.current.removePriceLine(selLineRef.current); } catch { /* ignore */ }
      selLineRef.current = null;
    }
    if (selectedCandleTs != null) {
      const c = candlesRef.current.find(x => x.t === selectedCandleTs);
      if (c) {
        selLineRef.current = seriesRef.current.createPriceLine({
          price: c.c,
          color: 'rgba(255,255,255,0.25)',
          lineWidth: 1,
          lineStyle: LineStyle.Dotted,
          axisLabelVisible: false,
          title: '',
        });
      }
    }
  }, [selectedCandleTs]);

  // ── Range highlight lines ──
  useEffect(() => {
    if (!seriesRef.current) return;
    rangeLines.current.forEach(pl => {
      try { seriesRef.current?.removePriceLine(pl); } catch { /* ignore */ }
    });
    rangeLines.current = [];

    const addLine = (ts: number, color: string, title: string) => {
      const c = candlesRef.current.find(x => x.t === ts);
      if (!c || !seriesRef.current) return;
      const pl = seriesRef.current.createPriceLine({
        price: c.c,
        color,
        lineWidth: 1,
        lineStyle: LineStyle.Solid,
        axisLabelVisible: true,
        title,
      });
      rangeLines.current.push(pl);
    };

    if (rangeStartTs != null) addLine(rangeStartTs, 'rgba(41,98,255,0.8)', '▶');
    if (rangeEndTs   != null) addLine(rangeEndTs,   'rgba(41,98,255,0.8)', '◀');
  }, [rangeStartTs, rangeEndTs]);

  // ── Consolidation range bands ──
  useEffect(() => {
    // Remove old band series
    rangeBandsRef.current.forEach(s => {
      try { chartRef.current?.removeSeries(s); } catch { /* ignore */ }
    });
    rangeBandsRef.current = [];

    if (!chartRef.current || !showRanges || ranges.length === 0) return;

    // Show at most last 12 ranges to keep series count reasonable
    const visible = ranges.slice(-12);

    for (const r of visible) {
      const color = r.is_active
        ? 'rgba(255,213,79,0.95)'  // brighter amber for active range
        : 'rgba(138,180,248,0.9)'; // cornflower blue, more visible on dark bg
      const fromS = (r.start_ts / 1000) as UTCTimestamp;
      const toS   = (r.end_ts   / 1000) as UTCTimestamp;

      const addBand = (price: number) => {
        const s = chartRef.current!.addSeries(LineSeries, {
          color,
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          priceLineVisible:       false,
          lastValueVisible:       false,
          crosshairMarkerVisible: false,
        });
        s.setData([
          { time: fromS, value: price },
          { time: toS,   value: price },
        ]);
        rangeBandsRef.current.push(s);
      };

      addBand(r.upper);
      addBand(r.lower);
    }
  }, [ranges, showRanges]);

  // ── Position primitives (TradingView-style filled band + lines + axis labels) ──
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    const map = positionPrimitivesRef.current;
    const open = positions.filter(p => p.exit_ts == null);
    const wantIds = new Set(open.map(p => p.id));

    for (const [id, prim] of map) {
      if (!wantIds.has(id)) {
        try { series.detachPrimitive(prim); } catch { /* ignore */ }
        map.delete(id);
      }
    }
    for (const p of open) {
      const existing = map.get(p.id);
      if (existing) {
        existing.setPosition(p);
      } else {
        const prim = new PositionPrimitive(p, () => {
          const c = candlesRef.current;
          return c.length > 0 ? c[c.length - 1].c : null;
        });
        series.attachPrimitive(prim);
        map.set(p.id, prim);
      }
    }
  }, [positions]);

  // Redraw primitives when candles change (keeps entry axis PnL % fresh)
  useEffect(() => {
    for (const prim of positionPrimitivesRef.current.values()) prim.requestRedraw();
  }, [candles]);

  // ── Toggle last-price horizontal line + right-axis label ──
  useEffect(() => {
    if (!seriesRef.current) return;
    seriesRef.current.applyOptions({
      priceLineVisible: showLastPrice,
      lastValueVisible: showLastPrice,
    });
  }, [showLastPrice]);

  // ── Draggable handles for open positions (TP/SL/Entry) ──
  // Imperative DOM + RAF loop because lightweight-charts v4 exposes no priceScale change event.
  useEffect(() => {
    const overlay = dragOverlayRef.current;
    if (!overlay) return;

    const startDrag = (e: MouseEvent, positionId: string, field: PosField, initialPrice: number, labelPrefix: string) => {
      e.preventDefault();
      e.stopPropagation();
      const key = `${positionId}:${field}`;
      draggingRef.current = { key, positionId, field, price: initialPrice };
      const handle = handlesRef.current.get(key);
      if (handle) handle.style.outline = '2px solid rgba(255,255,255,0.6)';

      const onMove = (ev: MouseEvent) => {
        const drag = draggingRef.current;
        if (!drag || !seriesRef.current || !overlay) return;
        const rect = overlay.getBoundingClientRect();
        const y = ev.clientY - rect.top;
        const price = seriesRef.current.coordinateToPrice(y);
        if (price == null || !Number.isFinite(price)) return;
        drag.price = price as number;
        const h = handlesRef.current.get(drag.key);
        if (h) {
          h.dataset.price = String(price);
          h.textContent = `${labelPrefix} ${formatPrice(price as number)}`;
        }
      };
      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        const drag = draggingRef.current;
        const h = drag ? handlesRef.current.get(drag.key) : null;
        if (h) h.style.outline = '';
        if (drag && Number.isFinite(drag.price)) {
          onPositionUpdateRef.current?.(drag.positionId, { [drag.field]: drag.price } as Partial<Position>);
        }
        draggingRef.current = null;
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    };

    const wantKeys = new Set<string>();
    const openPositions = positions.filter(p => p.exit_ts == null);
    for (const p of openPositions) {
      const entryColor = p.direction === 'long' ? '#26a69a' : '#ef5350';
      const entryLabel = p.direction === 'long' ? '多' : '空';
      const specs: { field: PosField; color: string; label: string }[] = [
        { field: 'entry_price', color: entryColor, label: entryLabel },
        { field: 'tp_price',    color: '#26a69a', label: 'TP' },
        { field: 'sl_price',    color: '#ef5350', label: 'SL' },
      ];
      for (const { field, color, label } of specs) {
        const key = `${p.id}:${field}`;
        wantKeys.add(key);
        let h = handlesRef.current.get(key);
        if (!h) {
          h = document.createElement('div');
          h.style.cssText = [
            'position:absolute', 'right:56px', 'transform:translateY(-50%)',
            'padding:2px 8px', 'border-radius:3px', 'font-size:11px',
            'font-family:monospace', 'cursor:ns-resize', 'z-index:20',
            'color:#fff', 'user-select:none', 'pointer-events:auto',
            'box-shadow:0 1px 3px rgba(0,0,0,0.5)',
          ].join(';');
          overlay.appendChild(h);
          handlesRef.current.set(key, h);
        }
        h.style.background = color;
        h.dataset.price = String(p[field]);
        h.textContent = `${label} ${formatPrice(Number(p[field]))}`;
        // Replace listener on every render so it closes over the latest labelPrefix
        const onDown = (ev: MouseEvent) => startDrag(ev, p.id, field, p[field], label);
        (h as HTMLDivElement & { _onDown?: (e: MouseEvent) => void })._onDown
          && h.removeEventListener('mousedown', (h as HTMLDivElement & { _onDown?: (e: MouseEvent) => void })._onDown!);
        h.addEventListener('mousedown', onDown);
        (h as HTMLDivElement & { _onDown?: (e: MouseEvent) => void })._onDown = onDown;
      }
    }
    // Remove handles no longer present
    for (const [key, el] of handlesRef.current) {
      if (!wantKeys.has(key)) { el.remove(); handlesRef.current.delete(key); }
    }
  }, [positions]);

  // RAF: continuously reposition handles based on priceToCoordinate (price scale has no event)
  useEffect(() => {
    let rafId = 0;
    const tick = () => {
      const series = seriesRef.current;
      if (series && handlesRef.current.size > 0) {
        for (const el of handlesRef.current.values()) {
          const price = Number(el.dataset.price);
          if (!Number.isFinite(price)) { el.style.display = 'none'; continue; }
          const y = series.priceToCoordinate(price);
          if (y == null) { el.style.display = 'none'; }
          else { el.style.display = ''; el.style.top = `${y}px`; }
        }
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, []);

  // ── Phase B + D: hit-test + drag for entry/tp/sl prices AND entry-time grip ──
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    type Hit =
      | { kind: 'line'; positionId: string; field: PosField; label: string }
      | { kind: 'time'; positionId: string };
    let hoveredHit: Hit | null = null;
    type ActiveDrag =
      | { kind: 'line'; positionId: string; field: PosField; label: string; price: number }
      | { kind: 'time'; positionId: string; entryTs: number };
    let activeDrag: ActiveDrag | null = null;

    const findHit = (x: number, y: number): Hit | null => {
      if (draggingRef.current || activeDrag || placingDirection) return null;
      const map = positionPrimitivesRef.current;
      let bestLine: { hit: Hit; dist: number } | null = null;
      let timeHit: Hit | null = null;
      for (const p of positions) {
        if (p.exit_ts != null) continue;
        const prim = map.get(p.id);
        if (!prim) continue;
        const d = prim.getDims();
        if (!d) continue;

        // Time grip: small square at (xStart, entryY). Check first so it wins
        // over the entry line when cursor is right on the grip.
        if (Math.abs(x - d.xStart) <= 5 && Math.abs(y - d.entryY) <= 9) {
          timeHit = { kind: 'time', positionId: p.id };
          break;
        }

        if (x < d.xStart || x > d.xEnd) continue;
        const dirLabel = p.direction === 'long' ? '多' : '空';
        const cands: Array<[PosField, number, string]> = [
          ['entry_price', d.entryY, dirLabel],
          ['tp_price',    d.tpY,    'TP'],
          ['sl_price',    d.slY,    'SL'],
        ];
        for (const [field, ly, label] of cands) {
          const dist = Math.abs(y - ly);
          if (dist <= 5 && (!bestLine || dist < bestLine.dist)) {
            bestLine = { hit: { kind: 'line', positionId: p.id, field, label }, dist };
          }
        }
      }
      return timeHit ?? bestLine?.hit ?? null;
    };

    const cursorFor = (hit: Hit | null): string =>
      hit?.kind === 'time' ? 'ew-resize' : hit?.kind === 'line' ? 'ns-resize' : '';

    const onMove = (ev: MouseEvent) => {
      if (activeDrag) return;
      if (placingDirection) { container.style.cursor = 'crosshair'; hoveredHit = null; return; }
      const rect = container.getBoundingClientRect();
      hoveredHit = findHit(ev.clientX - rect.left, ev.clientY - rect.top);
      container.style.cursor = cursorFor(hoveredHit);
    };

    const onLeave = () => {
      if (!activeDrag) container.style.cursor = '';
      hoveredHit = null;
    };

    const onDown = (ev: MouseEvent) => {
      if (!hoveredHit) return;
      ev.preventDefault();
      ev.stopPropagation();
      const p = positions.find(x => x.id === hoveredHit!.positionId);
      if (!p) return;

      if (hoveredHit.kind === 'line') {
        const hit = hoveredHit;
        activeDrag = { kind: 'line', positionId: hit.positionId, field: hit.field, label: hit.label, price: p[hit.field] };
      } else {
        activeDrag = { kind: 'time', positionId: hoveredHit.positionId, entryTs: p.entry_ts };
      }

      const moveHandler = (mev: MouseEvent) => {
        if (!seriesRef.current || !activeDrag) return;
        const rect = container.getBoundingClientRect();

        if (activeDrag.kind === 'line') {
          const priceVal = seriesRef.current.coordinateToPrice(mev.clientY - rect.top);
          if (priceVal == null || !Number.isFinite(priceVal)) return;
          activeDrag.price = priceVal as number;
          const prim = positionPrimitivesRef.current.get(activeDrag.positionId);
          if (prim) prim.setPosition({ ...prim.position, [activeDrag.field]: activeDrag.price });
          const pill = handlesRef.current.get(`${activeDrag.positionId}:${activeDrag.field}`);
          if (pill) {
            pill.dataset.price = String(activeDrag.price);
            pill.textContent = `${activeDrag.label} ${formatPrice(activeDrag.price)}`;
          }
          return;
        }

        // kind === 'time': snap cursor x to nearest loaded candle's timestamp
        const cs = candlesRef.current;
        if (cs.length === 0 || !chartRef.current) return;
        const cursorTime = chartRef.current.timeScale().coordinateToTime(mev.clientX - rect.left);
        if (cursorTime == null) return;
        const targetMs = (cursorTime as number) * 1000;
        let nearest = cs[0];
        for (const c of cs) {
          if (Math.abs(c.t - targetMs) < Math.abs(nearest.t - targetMs)) nearest = c;
        }
        activeDrag.entryTs = nearest.t;
        const prim = positionPrimitivesRef.current.get(activeDrag.positionId);
        if (prim) prim.setPosition({ ...prim.position, entry_ts: nearest.t });
      };
      const upHandler = () => {
        window.removeEventListener('mousemove', moveHandler);
        window.removeEventListener('mouseup', upHandler);
        if (activeDrag) {
          if (activeDrag.kind === 'line' && Number.isFinite(activeDrag.price)) {
            onPositionUpdateRef.current?.(activeDrag.positionId, { [activeDrag.field]: activeDrag.price } as Partial<Position>);
          } else if (activeDrag.kind === 'time' && Number.isFinite(activeDrag.entryTs)) {
            onPositionUpdateRef.current?.(activeDrag.positionId, { entry_ts: activeDrag.entryTs });
          }
        }
        activeDrag = null;
        container.style.cursor = '';
      };
      window.addEventListener('mousemove', moveHandler);
      window.addEventListener('mouseup', upHandler);
    };

    if (placingDirection) container.style.cursor = 'crosshair';

    container.addEventListener('mousemove', onMove);
    container.addEventListener('mouseleave', onLeave);
    container.addEventListener('mousedown', onDown, true);
    return () => {
      container.removeEventListener('mousemove', onMove);
      container.removeEventListener('mouseleave', onLeave);
      container.removeEventListener('mousedown', onDown, true);
      container.style.cursor = '';
    };
  }, [positions, placingDirection]);

  // ── Jump to timestamp ──
  return (
    <div style={{ flex: 1, minWidth: 0, minHeight: 0, position: 'relative' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      <div ref={dragOverlayRef} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} />
      {placingDirection && (
        <div style={{
          position: 'absolute', top: 8, left: '50%', transform: 'translateX(-50%)',
          background: placingDirection === 'long' ? 'rgba(38,166,154,0.95)' : 'rgba(239,83,80,0.95)',
          color: '#fff', padding: '5px 14px', borderRadius: 4, fontSize: 13,
          zIndex: 15, pointerEvents: 'none', fontWeight: 600,
          boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
        }}>
          點擊 K 線放置{placingDirection === 'long' ? '多' : '空'}頭倉位 · ESC 取消
        </div>
      )}
    </div>
  );
}
