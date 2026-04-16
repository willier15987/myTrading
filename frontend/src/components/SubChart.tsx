import React, { useEffect, useRef } from 'react';
import {
  createChart,
  HistogramSeries,
  LineSeries,
  ColorType,
  CrosshairMode,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from 'lightweight-charts';
import type { IndicatorPoint } from '../types';
import { type AppTimeZone, formatChartTime } from '../utils/time';

interface SubChartProps {
  series: IndicatorPoint[];
  timezone: AppTimeZone;
  // App passes a mutable ref; SubChart writes its setVisibleLogicalRange fn into it
  setLogicalRangeRef: React.MutableRefObject<((from: number, to: number) => void) | null>;
}

export function SubChart({ series, timezone, setLogicalRangeRef }: SubChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const forceRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const deRef = useRef<ISeriesApi<'Line'> | null>(null);

  // Init chart once
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
        tickMarkFormatter: (time: number) => formatChartTime(time, timezone),
      },
      localization: {
        timeFormatter: (time: number) => formatChartTime(time, timezone),
      },
      // Sub-chart is read-only; disable user scroll/scale so it only moves
      // when the main chart drives the sync
      handleScroll: false,
      handleScale: false,
    });

    const forceSeries = chart.addSeries(HistogramSeries, {
      color: '#26a69a',
      priceFormat: { type: 'price', precision: 3, minMove: 0.001 },
      priceScaleId: 'right',
    });

    // Reference lines at 0.4 / 0.5 / 0.6
    forceSeries.createPriceLine({ price: 0.6, color: 'rgba(38,166,154,0.5)', lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: '0.6' });
    forceSeries.createPriceLine({ price: 0.5, color: 'rgba(255,255,255,0.4)', lineWidth: 1, lineStyle: LineStyle.Solid, axisLabelVisible: true, title: '0.5' });
    forceSeries.createPriceLine({ price: 0.4, color: 'rgba(239,83,80,0.5)', lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: '0.4' });

    const deSeries = chart.addSeries(LineSeries, {
      color: '#FFC107',
      lineWidth: 1,
      priceScaleId: 'right',
      priceFormat: { type: 'price', precision: 3, minMove: 0.001 },
      lastValueVisible: false,
      priceLineVisible: false,
      crosshairMarkerRadius: 3,
    });

    chartRef.current = chart;
    forceRef.current = forceSeries;
    deRef.current = deSeries;

    // Logical range works past the data edges (unlike setVisibleRange), so the
    // sub-chart stays aligned even when the main chart scrolls into empty space.
    setLogicalRangeRef.current = (from: number, to: number) => {
      if (!chartRef.current) return;
      try {
        chartRef.current.timeScale().setVisibleLogicalRange({ from, to });
      } catch {
        /* range can be invalid during fast scroll */
      }
    };

    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry || !chartRef.current) return;
      chartRef.current.applyOptions({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      });
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      setLogicalRangeRef.current = null;
      chart.remove();
      chartRef.current = null;
      forceRef.current = null;
      deRef.current = null;
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

  // Update data
  useEffect(() => {
    if (!forceRef.current || !deRef.current) return;
    if (series.length === 0) {
      forceRef.current.setData([]);
      deRef.current.setData([]);
      return;
    }

    forceRef.current.setData(
      series.map((point) => ({
        time: (point.t / 1000) as UTCTimestamp,
        value: point.force_ratio,
        color: point.force_ratio >= 0.5 ? '#26a69a' : '#ef5350',
      })),
    );

    deRef.current.setData(
      series.map((point) => ({
        time: (point.t / 1000) as UTCTimestamp,
        value: point.displacement_efficiency,
      })),
    );
  }, [series]);

  return (
    <div style={{ position: 'relative', flexShrink: 0, height: '100%' }}>
      <div
        style={{
          position: 'absolute',
          top: 4,
          left: 8,
          zIndex: 10,
          fontSize: 11,
          display: 'flex',
          gap: 12,
          pointerEvents: 'none',
        }}
      >
        <span style={{ color: '#26a69a' }}>■ force_ratio</span>
        <span style={{ color: '#FFC107' }}>— 位移效率</span>
        <span style={{ color: '#787b86' }}>（綠色 ≥ 0.5 多方主導）</span>
      </div>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
    </div>
  );
}
