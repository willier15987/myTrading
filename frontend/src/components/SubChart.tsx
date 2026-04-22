import React, { useEffect, useRef } from 'react';
import {
  createChart,
  HistogramSeries,
  LineSeries,
  ColorType,
  CrosshairMode,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from 'lightweight-charts';
import type { IndicatorPoint } from '../types';
import { type AppTimeZone, formatChartTime } from '../utils/time';

interface SubChartProps {
  series: IndicatorPoint[];
  timezone: AppTimeZone;
  mode: 'force' | 'adx';
  setLogicalRangeRef: React.MutableRefObject<((from: number, to: number) => void) | null>;
  setCrosshairTimeRef: React.MutableRefObject<((time: number | null) => void) | null>;
}

export function SubChart({ series, timezone, mode, setLogicalRangeRef, setCrosshairTimeRef }: SubChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const forceRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const deRef = useRef<ISeriesApi<'Line'> | null>(null);
  const adxRef = useRef<ISeriesApi<'Line'> | null>(null);
  const plusDiRef = useRef<ISeriesApi<'Line'> | null>(null);
  const minusDiRef = useRef<ISeriesApi<'Line'> | null>(null);
  const seriesDataRef = useRef<IndicatorPoint[]>([]);
  const modeRef = useRef(mode);

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
      handleScroll: false,
      handleScale: false,
    });

    // --- Force / DE series ---
    const forceSeries = chart.addSeries(HistogramSeries, {
      color: '#26a69a',
      priceFormat: { type: 'price', precision: 3, minMove: 0.001 },
      priceScaleId: 'right',
    });

    const deSeries = chart.addSeries(LineSeries, {
      color: '#FFC107',
      lineWidth: 1,
      priceScaleId: 'right',
      priceFormat: { type: 'price', precision: 3, minMove: 0.001 },
      lastValueVisible: false,
      priceLineVisible: false,
      crosshairMarkerRadius: 3,
    });

    // --- ADX / DI series ---
    const adxSeries = chart.addSeries(LineSeries, {
      color: '#e040fb',
      lineWidth: 2,
      priceScaleId: 'right',
      priceFormat: { type: 'price', precision: 1, minMove: 0.1 },
      lastValueVisible: true,
      priceLineVisible: false,
      crosshairMarkerRadius: 3,
      title: 'ADX',
    });

    const plusDiSeries = chart.addSeries(LineSeries, {
      color: '#26a69a',
      lineWidth: 1,
      priceScaleId: 'right',
      priceFormat: { type: 'price', precision: 1, minMove: 0.1 },
      lastValueVisible: true,
      priceLineVisible: false,
      crosshairMarkerRadius: 2,
      title: '+DI',
    });

    const minusDiSeries = chart.addSeries(LineSeries, {
      color: '#ef5350',
      lineWidth: 1,
      priceScaleId: 'right',
      priceFormat: { type: 'price', precision: 1, minMove: 0.1 },
      lastValueVisible: true,
      priceLineVisible: false,
      crosshairMarkerRadius: 2,
      title: '-DI',
    });

    chartRef.current = chart;
    forceRef.current = forceSeries;
    deRef.current = deSeries;
    adxRef.current = adxSeries;
    plusDiRef.current = plusDiSeries;
    minusDiRef.current = minusDiSeries;

    setLogicalRangeRef.current = (from: number, to: number) => {
      if (!chartRef.current) return;
      try {
        chartRef.current.timeScale().setVisibleLogicalRange({ from, to });
      } catch {
        /* range can be invalid during fast scroll */
      }
    };

    setCrosshairTimeRef.current = (time: number | null) => {
      if (!chartRef.current) return;
      if (time == null) {
        chartRef.current.clearCrosshairPosition();
        return;
      }
      const ms = time * 1000;
      const point = seriesDataRef.current.find(p => p.t === ms);
      const isForce = modeRef.current === 'force';
      const value = point ? (isForce ? point.force_ratio : point.adx) : NaN;
      const targetSeries = isForce
        ? (forceRef.current ?? adxRef.current)
        : (adxRef.current ?? forceRef.current);
      if (!targetSeries) return;
      chartRef.current.setCrosshairPosition(value, time as UTCTimestamp, targetSeries);
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
      setCrosshairTimeRef.current = null;
      chart.remove();
      chartRef.current = null;
      forceRef.current = null;
      deRef.current = null;
      adxRef.current = null;
      plusDiRef.current = null;
      minusDiRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep modeRef in sync
  useEffect(() => { modeRef.current = mode; }, [mode]);

  // Toggle series visibility when mode changes
  useEffect(() => {
    const isForce = mode === 'force';
    forceRef.current?.applyOptions({ visible: isForce });
    deRef.current?.applyOptions({ visible: isForce });
    adxRef.current?.applyOptions({ visible: !isForce });
    plusDiRef.current?.applyOptions({ visible: !isForce });
    minusDiRef.current?.applyOptions({ visible: !isForce });
  }, [mode]);

  // Timezone
  useEffect(() => {
    if (!chartRef.current) return;
    chartRef.current.applyOptions({
      timeScale: { tickMarkFormatter: (time: number) => formatChartTime(time, timezone) },
      localization: { timeFormatter: (time: number) => formatChartTime(time, timezone) },
    });
  }, [timezone]);

  // Data
  useEffect(() => {
    seriesDataRef.current = series;
    if (!forceRef.current || !deRef.current || !adxRef.current || !plusDiRef.current || !minusDiRef.current) return;

    if (series.length === 0) {
      forceRef.current.setData([]);
      deRef.current.setData([]);
      adxRef.current.setData([]);
      plusDiRef.current.setData([]);
      minusDiRef.current.setData([]);
      return;
    }

    forceRef.current.setData(
      series.map((p) => ({
        time: (p.t / 1000) as UTCTimestamp,
        value: p.force_ratio,
        color: p.force_ratio >= 0.5 ? '#26a69a' : '#ef5350',
      })),
    );
    deRef.current.setData(
      series.map((p) => ({ time: (p.t / 1000) as UTCTimestamp, value: p.displacement_efficiency })),
    );
    adxRef.current.setData(
      series.filter((p) => p.adx > 0).map((p) => ({ time: (p.t / 1000) as UTCTimestamp, value: p.adx })),
    );
    plusDiRef.current.setData(
      series.filter((p) => p.plus_di > 0).map((p) => ({ time: (p.t / 1000) as UTCTimestamp, value: p.plus_di })),
    );
    minusDiRef.current.setData(
      series.filter((p) => p.minus_di > 0).map((p) => ({ time: (p.t / 1000) as UTCTimestamp, value: p.minus_di })),
    );
  }, [series]);

  const isForce = mode === 'force';

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
        {isForce ? (
          <>
            <span style={{ color: '#26a69a' }}>■ force_ratio</span>
            <span style={{ color: '#FFC107' }}>— 位移效率</span>
            <span style={{ color: '#787b86' }}>（綠色 ≥ 0.5 多方主導）</span>
          </>
        ) : (
          <>
            <span style={{ color: '#e040fb' }}>— ADX</span>
            <span style={{ color: '#26a69a' }}>— +DI</span>
            <span style={{ color: '#ef5350' }}>— -DI</span>
            <span style={{ color: '#787b86' }}>（ADX &gt; 25 趨勢明確）</span>
          </>
        )}
      </div>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
    </div>
  );
}
