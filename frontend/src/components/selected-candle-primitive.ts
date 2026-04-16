import type {
  ISeriesPrimitive,
  IPrimitivePaneView,
  IPrimitivePaneRenderer,
  PrimitivePaneViewZOrder,
  SeriesAttachedParameter,
  IChartApi,
  ISeriesApi,
  SeriesType,
  Time,
  UTCTimestamp,
} from 'lightweight-charts';
import type { CanvasRenderingTarget2D } from 'fancy-canvas';
import type { Candle } from '../types';

const SELECTED_CANDLE_BORDER = '#FFD54F';
const SELECTED_UP_CANDLE_FILL = 'rgba(38,166,154,0.35)';
const SELECTED_DOWN_CANDLE_FILL = 'rgba(239,83,80,0.35)';
const MIN_BODY_WIDTH = 6;
const MAX_BODY_WIDTH = 36;
const DEFAULT_BODY_WIDTH = 12;

interface Geometry {
  x: number;
  bodyWidth: number;
  openY: number;
  highY: number;
  lowY: number;
  closeY: number;
  fillColor: string;
}

class SelectedCandleRenderer implements IPrimitivePaneRenderer {
  constructor(private geometry: Geometry | null) {}

  draw(target: CanvasRenderingTarget2D): void {
    const geometry = this.geometry;
    if (!geometry) return;

    target.useMediaCoordinateSpace(scope => {
      const ctx = scope.context;
      const { x, bodyWidth, openY, highY, lowY, closeY, fillColor } = geometry;
      const halfWidth = bodyWidth / 2;
      const bodyTop = Math.min(openY, closeY);
      const bodyBottom = Math.max(openY, closeY);
      const bodyHeight = Math.max(bodyBottom - bodyTop, 1);

      ctx.save();
      ctx.strokeStyle = SELECTED_CANDLE_BORDER;
      ctx.fillStyle = fillColor;
      ctx.lineWidth = 2;

      ctx.beginPath();
      ctx.moveTo(x, highY);
      ctx.lineTo(x, lowY);
      ctx.stroke();

      ctx.fillRect(x - halfWidth, bodyTop, bodyWidth, bodyHeight);
      ctx.strokeRect(x - halfWidth, bodyTop, bodyWidth, bodyHeight);
      ctx.restore();
    });
  }
}

class SelectedCandlePaneView implements IPrimitivePaneView {
  private _renderer = new SelectedCandleRenderer(null);

  constructor(private source: SelectedCandlePrimitive) {}

  update(): void {
    this._renderer = new SelectedCandleRenderer(this.source.getGeometry());
  }

  renderer(): IPrimitivePaneRenderer {
    return this._renderer;
  }

  zOrder(): PrimitivePaneViewZOrder {
    return 'top';
  }
}

export class SelectedCandlePrimitive implements ISeriesPrimitive<Time> {
  private _chart?: IChartApi;
  private _series?: ISeriesApi<SeriesType>;
  private _requestUpdate?: () => void;
  private _paneView = new SelectedCandlePaneView(this);
  private _selected: Candle | null = null;
  private _candles: Candle[] = [];

  attached(param: SeriesAttachedParameter<Time>): void {
    this._chart = param.chart;
    this._series = param.series as ISeriesApi<SeriesType>;
    this._requestUpdate = param.requestUpdate;
  }

  detached(): void {
    this._chart = undefined;
    this._series = undefined;
    this._requestUpdate = undefined;
  }

  updateAllViews(): void {
    this._paneView.update();
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return [this._paneView];
  }

  setSelection(candle: Candle | null, candles: Candle[]): void {
    this._selected = candle;
    this._candles = candles;
    this._requestUpdate?.();
  }

  getGeometry(): Geometry | null {
    const chart = this._chart;
    const series = this._series;
    const selected = this._selected;
    if (!chart || !series || !selected) return null;

    const openY = series.priceToCoordinate(selected.o);
    const highY = series.priceToCoordinate(selected.h);
    const lowY = series.priceToCoordinate(selected.l);
    const closeY = series.priceToCoordinate(selected.c);
    const x = chart.timeScale().timeToCoordinate((selected.t / 1000) as UTCTimestamp);
    if (openY == null || highY == null || lowY == null || closeY == null || x == null) return null;

    return {
      x,
      bodyWidth: this.getBodyWidth(selected.t),
      openY,
      highY,
      lowY,
      closeY,
      fillColor: selected.c >= selected.o ? SELECTED_UP_CANDLE_FILL : SELECTED_DOWN_CANDLE_FILL,
    };
  }

  private getBodyWidth(selectedTs: number): number {
    const chart = this._chart;
    if (!chart || this._candles.length <= 1) return DEFAULT_BODY_WIDTH;

    const index = this._candles.findIndex(candle => candle.t === selectedTs);
    if (index < 0) return DEFAULT_BODY_WIDTH;

    const currentX = chart.timeScale().timeToCoordinate((selectedTs / 1000) as UTCTimestamp);
    if (currentX == null) return DEFAULT_BODY_WIDTH;

    let spacing: number | null = null;
    const prev = this._candles[index - 1];
    const next = this._candles[index + 1];

    if (prev) {
      const prevX = chart.timeScale().timeToCoordinate((prev.t / 1000) as UTCTimestamp);
      if (prevX != null) spacing = Math.abs(currentX - prevX);
    }
    if (next) {
      const nextX = chart.timeScale().timeToCoordinate((next.t / 1000) as UTCTimestamp);
      if (nextX != null) spacing = spacing == null ? Math.abs(nextX - currentX) : Math.min(spacing, Math.abs(nextX - currentX));
    }
    if (spacing == null || spacing <= 0) return DEFAULT_BODY_WIDTH;

    const width = Math.max(spacing * 0.7, MIN_BODY_WIDTH);
    return Math.min(width, MAX_BODY_WIDTH);
  }
}
