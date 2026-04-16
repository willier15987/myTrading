import type {
  ISeriesPrimitive,
  IPrimitivePaneView,
  IPrimitivePaneRenderer,
  ISeriesPrimitiveAxisView,
  PrimitivePaneViewZOrder,
  SeriesAttachedParameter,
  IChartApi,
  ISeriesApi,
  SeriesType,
  Time,
  UTCTimestamp,
} from 'lightweight-charts';
import type { CanvasRenderingTarget2D } from 'fancy-canvas';
import type { Position } from '../types';
import { pnlFraction } from '../utils/positions';
import { formatPrice } from '../utils/price';

const COLOR = {
  longEntry:   '#26a69a',
  shortEntry:  '#ef5350',
  tp:          '#26a69a',
  sl:          '#ef5350',
  profitFill:  'rgba(38,166,154,0.15)',
  lossFill:    'rgba(239,83,80,0.15)',
  labelText:   '#ffffff',
};

interface Dims {
  entryY: number;
  tpY: number;
  slY: number;
  xStart: number;
  xEnd: number;
}

// ── Renderers ──────────────────────────────────────────────

class BandRenderer implements IPrimitivePaneRenderer {
  constructor(private dims: Dims | null) {}

  draw(target: CanvasRenderingTarget2D) {
    const dims = this.dims;
    if (!dims) return;
    target.useMediaCoordinateSpace(scope => {
      const ctx = scope.context;
      const { entryY, tpY, slY, xStart, xEnd } = dims;
      const w = xEnd - xStart;
      if (w <= 0) return;

      ctx.fillStyle = COLOR.profitFill;
      ctx.fillRect(xStart, Math.min(entryY, tpY), w, Math.abs(entryY - tpY));

      ctx.fillStyle = COLOR.lossFill;
      ctx.fillRect(xStart, Math.min(entryY, slY), w, Math.abs(entryY - slY));
    });
  }
}

class LineRenderer implements IPrimitivePaneRenderer {
  constructor(private dims: Dims | null, private position: Position) {}

  draw(target: CanvasRenderingTarget2D) {
    const dims = this.dims;
    if (!dims) return;
    target.useMediaCoordinateSpace(scope => {
      const ctx = scope.context;
      const { entryY, tpY, slY, xStart, xEnd } = dims;
      const entryColor = this.position.direction === 'long' ? COLOR.longEntry : COLOR.shortEntry;

      // Entry (thick solid)
      ctx.strokeStyle = entryColor;
      ctx.lineWidth = 2;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(xStart, entryY);
      ctx.lineTo(xEnd, entryY);
      ctx.stroke();

      // TP / SL (dashed)
      ctx.lineWidth = 1;
      ctx.setLineDash([6, 4]);

      ctx.strokeStyle = COLOR.tp;
      ctx.beginPath();
      ctx.moveTo(xStart, tpY);
      ctx.lineTo(xEnd, tpY);
      ctx.stroke();

      ctx.strokeStyle = COLOR.sl;
      ctx.beginPath();
      ctx.moveTo(xStart, slY);
      ctx.lineTo(xEnd, slY);
      ctx.stroke();

      ctx.setLineDash([]);

      // Entry-time grip: a small vertical rectangle on the entry line at xStart.
      // Users drag it horizontally to snap entry_ts to another candle.
      const gripW = 6;
      const gripH = 14;
      ctx.fillStyle = entryColor;
      ctx.fillRect(xStart - gripW / 2, entryY - gripH / 2, gripW, gripH);
      ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      ctx.lineWidth = 1;
      ctx.strokeRect(xStart - gripW / 2, entryY - gripH / 2, gripW, gripH);
    });
  }
}

// ── Pane views ─────────────────────────────────────────────

class BandPaneView implements IPrimitivePaneView {
  private _renderer = new BandRenderer(null);
  constructor(private source: PositionPrimitive) {}
  update(): void { this._renderer = new BandRenderer(this.source.getDims()); }
  renderer(): IPrimitivePaneRenderer { return this._renderer; }
  zOrder(): PrimitivePaneViewZOrder { return 'bottom'; }
}

class LinePaneView implements IPrimitivePaneView {
  private _renderer: LineRenderer;
  constructor(private source: PositionPrimitive) {
    this._renderer = new LineRenderer(null, source.position);
  }
  update(): void { this._renderer = new LineRenderer(this.source.getDims(), this.source.position); }
  renderer(): IPrimitivePaneRenderer { return this._renderer; }
  zOrder(): PrimitivePaneViewZOrder { return 'normal'; }
}

// ── Price axis label views ────────────────────────────────

type AxisKind = 'entry' | 'tp' | 'sl';

class AxisView implements ISeriesPrimitiveAxisView {
  constructor(private source: PositionPrimitive, private kind: AxisKind) {}

  coordinate(): number {
    const d = this.source.getDims();
    if (!d) return -1;
    return this.kind === 'entry' ? d.entryY : this.kind === 'tp' ? d.tpY : d.slY;
  }

  text(): string {
    const p = this.source.position;
    if (this.kind === 'entry') {
      const label = p.direction === 'long' ? '多' : '空';
      const price = fmtPrice(p.entry_price);
      const cur = this.source.getLatestPrice();
      if (cur != null) {
        const pnl = pnlFraction(p.direction, p.entry_price, cur);
        const sign = pnl >= 0 ? '+' : '';
        return `${label} ${price} ${sign}${(pnl * 100).toFixed(2)}%`;
      }
      return `${label} ${price}`;
    }
    if (this.kind === 'tp') {
      const pct = pnlFraction(p.direction, p.entry_price, p.tp_price) * 100;
      const sign = pct >= 0 ? '+' : '';
      return `TP ${fmtPrice(p.tp_price)} ${sign}${pct.toFixed(2)}%`;
    }
    // sl
    const pct = pnlFraction(p.direction, p.entry_price, p.sl_price) * 100;
    const sign = pct >= 0 ? '+' : '';
    return `SL ${fmtPrice(p.sl_price)} ${sign}${pct.toFixed(2)}%`;
  }

  textColor(): string { return COLOR.labelText; }

  backColor(): string {
    const p = this.source.position;
    if (this.kind === 'entry') return p.direction === 'long' ? COLOR.longEntry : COLOR.shortEntry;
    if (this.kind === 'tp') return COLOR.tp;
    return COLOR.sl;
  }
}

// ── Primitive ─────────────────────────────────────────────

export class PositionPrimitive implements ISeriesPrimitive<Time> {
  private _chart?: IChartApi;
  private _series?: ISeriesApi<SeriesType>;
  private _requestUpdate?: () => void;

  private _bandView = new BandPaneView(this);
  private _lineView = new LinePaneView(this);
  private _axisViews: AxisView[] = [
    new AxisView(this, 'entry'),
    new AxisView(this, 'tp'),
    new AxisView(this, 'sl'),
  ];

  constructor(public position: Position, public getLatestPrice: () => number | null) {}

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
    this._bandView.update();
    this._lineView.update();
  }

  paneViews(): readonly IPrimitivePaneView[] { return [this._bandView, this._lineView]; }
  priceAxisViews(): readonly ISeriesPrimitiveAxisView[] { return this._axisViews; }

  setPosition(next: Position): void {
    this.position = next;
    this._requestUpdate?.();
  }

  requestRedraw(): void { this._requestUpdate?.(); }

  getDims(): Dims | null {
    const chart = this._chart;
    const series = this._series;
    if (!chart || !series) return null;
    const entryY = series.priceToCoordinate(this.position.entry_price);
    const tpY = series.priceToCoordinate(this.position.tp_price);
    const slY = series.priceToCoordinate(this.position.sl_price);
    if (entryY == null || tpY == null || slY == null) return null;
    const ts = (this.position.entry_ts / 1000) as UTCTimestamp;
    const xRaw = chart.timeScale().timeToCoordinate(ts);
    const xStart = xRaw == null ? 0 : Math.max(0, xRaw);
    const xEnd = chart.chartElement().clientWidth;
    return { entryY, tpY, slY, xStart, xEnd };
  }
}

function fmtPrice(n: number): string {
  return formatPrice(n);
}
