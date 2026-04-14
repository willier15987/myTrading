import React, { useEffect, useLayoutEffect, useRef } from 'react';
import {
  createChart,
  ColorType,
  CrosshairMode,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
  type CandlestickData,
  type UTCTimestamp,
  type SeriesMarker,
} from 'lightweight-charts';

// Price line handle returned by series.createPriceLine()
type PriceLineHandle = ReturnType<ISeriesApi<'Candlestick'>['createPriceLine']>;
import type { Candle, DetectedRange, LabelType, Mark, SwingPoint } from '../types';
import { LABEL_META } from '../types';

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

interface ChartProps {
  candles: Candle[];
  marks: Mark[];
  swings: SwingPoint[];
  showSwings: boolean;
  ranges: DetectedRange[];
  showRanges: boolean;
  selectedCandleTs: number | null;
  rangeStartTs: number | null;
  rangeEndTs: number | null;
  onCandleClick: (candle: Candle, isShift: boolean) => void;
  onNeedMoreData: (beforeTs: number) => void;
  onVisibleRangeChange?: (fromMs: number, toMs: number) => void;
  jumpToTs: number | null;
}

export function Chart({ candles, marks, swings, showSwings, ranges, showRanges, selectedCandleTs, rangeStartTs, rangeEndTs, onCandleClick, onNeedMoreData, onVisibleRangeChange, jumpToTs }: ChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef     = useRef<IChartApi | null>(null);
  const seriesRef    = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const priceLines      = useRef<Map<number, PriceLineHandle>>(new Map());
  const selLineRef      = useRef<PriceLineHandle | null>(null);
  const rangeLines      = useRef<PriceLineHandle[]>([]);
  const isShiftRef   = useRef(false);
  const isLoadingMore = useRef(false);
  const candlesRef   = useRef<Candle[]>([]);
  const rangeBandsRef = useRef<ISeriesApi<'Line'>[]>([]);

  // Keep latest callbacks accessible inside stable chart event handlers
  const onClickRef      = useRef(onCandleClick);
  const onMoreRef       = useRef(onNeedMoreData);
  const onRangeChangeRef = useRef(onVisibleRangeChange);
  useLayoutEffect(() => { onClickRef.current      = onCandleClick; });
  useLayoutEffect(() => { onMoreRef.current        = onNeedMoreData; });
  useLayoutEffect(() => { onRangeChangeRef.current = onVisibleRangeChange; });

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
      },
    });

    const series = chart.addCandlestickSeries({
      upColor: '#26a69a',
      downColor: '#ef5350',
      borderDownColor: '#ef5350',
      borderUpColor: '#26a69a',
      wickDownColor: '#ef5350',
      wickUpColor: '#26a69a',
    });

    chartRef.current = chart;
    seriesRef.current = series;

    // Click → select candle
    chart.subscribeClick((param) => {
      if (!param.time) return;
      const tsMs = (param.time as number) * 1000;
      const candle = candlesRef.current.find(c => c.t === tsMs);
      if (candle) onClickRef.current(candle, isShiftRef.current);
    });

    // Scroll left → load more historical data
    chart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
      if (!range) return;
      if (range.from <= 30 && !isLoadingMore.current && candlesRef.current.length > 0) {
        isLoadingMore.current = true;
        onMoreRef.current(candlesRef.current[0].t);
      }
    });

    // Visible time range → drive SubChart sync
    chart.timeScale().subscribeVisibleTimeRangeChange((range) => {
      if (!range) return;
      onRangeChangeRef.current?.(
        (range.from as number) * 1000,
        (range.to   as number) * 1000,
      );
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
      chart.remove();
      chartRef.current  = null;
      seriesRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Track the first candle's timestamp from the previous render to detect prepend vs. full reload
  const prevFirstTsRef = useRef<number | null>(null);

  // ── Update candles data ──
  useEffect(() => {
    if (!seriesRef.current || candles.length === 0) return;

    const newFirstTs  = candles[0].t;
    const isPrepend   = prevFirstTsRef.current !== null && newFirstTs < prevFirstTsRef.current;
    prevFirstTsRef.current = newFirstTs;

    isLoadingMore.current = false;
    candlesRef.current = candles;

    // Save range only when prepending (to prevent scroll jump)
    const visRange = isPrepend ? chartRef.current?.timeScale().getVisibleRange() : null;

    const data: CandlestickData[] = candles.map(c => ({
      time: (c.t / 1000) as UTCTimestamp,
      open: c.o, high: c.h, low: c.l, close: c.c,
    }));
    seriesRef.current.setData(data);

    if (visRange) {
      // Prepend: restore previous visible range so the user's scroll position stays
      chartRef.current?.timeScale().setVisibleRange(visRange);
    } else {
      // Initial / full reload: scroll to the latest (rightmost) candle
      chartRef.current?.timeScale().scrollToPosition(0, false);
    }
  }, [candles]);

  // ── Update marks + swings (price lines + series markers) ──
  // Combined into one effect so setMarkers is called once with all markers merged.
  useEffect(() => {
    if (!seriesRef.current) return;

    // ── 1. Clear old manual-mark price lines ──
    priceLines.current.forEach(pl => {
      try { seriesRef.current?.removePriceLine(pl); } catch { /* ignore */ }
    });
    priceLines.current.clear();

    const markers: SeriesMarker<UTCTimestamp>[] = [];

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

    // lightweight-charts requires markers sorted by time
    markers.sort((a, b) => (a.time as number) - (b.time as number));
    seriesRef.current.setMarkers(markers);
  }, [marks, swings, showSwings]);

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
        ? 'rgba(255,193,7,0.7)'   // yellow for active range
        : 'rgba(41,98,255,0.45)'; // blue for completed range
      const fromS = (r.start_ts / 1000) as UTCTimestamp;
      const toS   = (r.end_ts   / 1000) as UTCTimestamp;

      const addBand = (price: number) => {
        const s = chartRef.current!.addLineSeries({
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

  // ── Jump to timestamp ──
  useEffect(() => {
    if (jumpToTs == null || !chartRef.current || candlesRef.current.length === 0) return;

    // Find the nearest loaded candle to the requested timestamp
    const cs = candlesRef.current;
    let nearest = cs[0];
    for (const c of cs) {
      if (Math.abs(c.t - jumpToTs) < Math.abs(nearest.t - jumpToTs)) nearest = c;
    }

    // Show ~100 candles centred around the nearest candle
    const idx  = cs.indexOf(nearest);
    const from = cs[Math.max(0, idx - 50)];
    const to   = cs[Math.min(cs.length - 1, idx + 50)];

    chartRef.current.timeScale().setVisibleRange({
      from: (from.t / 1000) as UTCTimestamp,
      to:   (to.t   / 1000) as UTCTimestamp,
    });
  }, [jumpToTs]);

  return <div ref={containerRef} style={{ flex: 1, minWidth: 0 }} />;
}
