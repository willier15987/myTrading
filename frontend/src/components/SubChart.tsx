import React, { useEffect, useLayoutEffect, useRef } from 'react';
import {
  createChart,
  ColorType,
  CrosshairMode,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from 'lightweight-charts';
import type { IndicatorPoint } from '../types';

interface SubChartProps {
  series: IndicatorPoint[];
  // App passes a mutable ref; SubChart writes its setVisibleRange fn into it
  setRangeRef: React.MutableRefObject<((fromMs: number, toMs: number) => void) | null>;
}

export function SubChart({ series, setRangeRef }: SubChartProps) {
  const containerRef   = useRef<HTMLDivElement>(null);
  const chartRef       = useRef<IChartApi | null>(null);
  const forceRef       = useRef<ISeriesApi<'Histogram'> | null>(null);
  const deRef          = useRef<ISeriesApi<'Line'> | null>(null);

  // ── Init chart once ──
  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      width:  containerRef.current.clientWidth,
      height: containerRef.current.clientHeight,
      layout: {
        background: { type: ColorType.Solid, color: '#131722' },
        textColor: '#d1d4dc',
      },
      grid: {
        vertLines: { color: 'rgba(42,46,57,0.3)' },
        horzLines: { color: 'rgba(42,46,57,0.3)' },
      },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: {
        borderColor: 'rgba(197,203,206,0.4)',
        scaleMargins: { top: 0.05, bottom: 0.05 },
      },
      timeScale: {
        borderColor: 'rgba(197,203,206,0.4)',
        timeVisible: true,
        secondsVisible: false,
      },
      // Sub-chart is read-only; disable user scroll/scale so it only moves
      // when the main chart drives the sync
      handleScroll: false,
      handleScale:  false,
    });

    // ── force_ratio histogram ──
    const forceSeries = chart.addHistogramSeries({
      color: '#26a69a',
      priceFormat: { type: 'price', precision: 3, minMove: 0.001 },
      priceScaleId: 'right',
    });

    // Reference lines at 0.4 / 0.5 / 0.6
    forceSeries.createPriceLine({ price: 0.6, color: 'rgba(38,166,154,0.5)',  lineWidth: 1, lineStyle: LineStyle.Dashed,  axisLabelVisible: true, title: '0.6' });
    forceSeries.createPriceLine({ price: 0.5, color: 'rgba(255,255,255,0.4)', lineWidth: 1, lineStyle: LineStyle.Solid,   axisLabelVisible: true, title: '0.5' });
    forceSeries.createPriceLine({ price: 0.4, color: 'rgba(239,83,80,0.5)',   lineWidth: 1, lineStyle: LineStyle.Dashed,  axisLabelVisible: true, title: '0.4' });

    // ── displacement_efficiency line ──
    const deSeries = chart.addLineSeries({
      color: '#FFC107',
      lineWidth: 1,
      priceScaleId: 'right',
      priceFormat: { type: 'price', precision: 3, minMove: 0.001 },
      lastValueVisible: false,
      priceLineVisible: false,
      crosshairMarkerRadius: 3,
    });

    chartRef.current  = chart;
    forceRef.current  = forceSeries;
    deRef.current     = deSeries;

    // Expose setVisibleRange so App can drive sync from the main chart
    setRangeRef.current = (fromMs: number, toMs: number) => {
      if (!chartRef.current) return;
      try {
        chartRef.current.timeScale().setVisibleRange({
          from: (fromMs / 1000) as UTCTimestamp,
          to:   (toMs   / 1000) as UTCTimestamp,
        });
      } catch { /* range can be invalid during fast scroll */ }
    };

    // Resize observer
    const ro = new ResizeObserver((entries) => {
      const e = entries[0];
      if (e && chartRef.current) {
        chartRef.current.applyOptions({
          width:  e.contentRect.width,
          height: e.contentRect.height,
        });
      }
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      setRangeRef.current = null;
      chart.remove();
      chartRef.current = null;
      forceRef.current = null;
      deRef.current    = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep setRangeRef wired even if the ref object changes identity (shouldn't, but safe)
  useLayoutEffect(() => {
    if (!chartRef.current) return;
    setRangeRef.current = (fromMs: number, toMs: number) => {
      try {
        chartRef.current?.timeScale().setVisibleRange({
          from: (fromMs / 1000) as UTCTimestamp,
          to:   (toMs   / 1000) as UTCTimestamp,
        });
      } catch { /* ignore */ }
    };
  });

  // ── Update data ──
  useEffect(() => {
    if (!forceRef.current || !deRef.current || series.length === 0) return;

    forceRef.current.setData(
      series.map(p => ({
        time:  (p.t / 1000) as UTCTimestamp,
        value: p.force_ratio,
        color: p.force_ratio >= 0.5 ? '#26a69a' : '#ef5350',
      })),
    );

    deRef.current.setData(
      series.map(p => ({
        time:  (p.t / 1000) as UTCTimestamp,
        value: p.displacement_efficiency,
      })),
    );
  }, [series]);

  return (
    <div style={{ position: 'relative', flexShrink: 0, height: '100%' }}>
      {/* Legend */}
      <div style={{
        position: 'absolute', top: 4, left: 8, zIndex: 10,
        fontSize: 11, display: 'flex', gap: 12, pointerEvents: 'none',
      }}>
        <span style={{ color: '#26a69a' }}>■ force_ratio</span>
        <span style={{ color: '#FFC107' }}>— 位移效率</span>
        <span style={{ color: '#787b86' }}>（綠色 ≥ 0.5 多方主導）</span>
      </div>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
    </div>
  );
}
