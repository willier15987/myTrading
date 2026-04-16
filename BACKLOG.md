# 待辦與改善清單

> 2026-04-16 更新。已移除已完成的回放與即時同步項目，以下只保留目前仍待處理的內容。

---

## 中優先

### PERF-01 — 子圖時間偏移在回放推進後可能漂移
**位置**：`App.tsx` / `SubChart.tsx`

力道子圖目前仍依賴主圖可視範圍偏移同步；在回放長時間推進、前後補資料的情境下，仍可能出現主圖與子圖對齊誤差。

**方向**：
- 回放啟動時一次抓齊對應指標資料
- 或在回放模式下對子圖採獨立時間軸同步策略

---

### PERF-02 — 高速回放效能仍有優化空間
**位置**：`App.tsx` / `Chart.tsx`

目前回放以 `setInterval` 推進 cursor，速度提高後會頻繁觸發 `candles` 切片、圖表更新與多個 side effect；資料量大時仍可能感到卡頓。

**方向**：
- 改為 `requestAnimationFrame` 驅動
- 高倍速時批次前進多根 K 線
- 進一步減少每步進都必須重算的 UI 區塊

---

### FEAT-01 — live-sync 與 auto-refresh 仍是兩段式機制
**位置**：`App.tsx`

目前語意是：
- `即時同步`：交易所 → SQLite
- `自動更新`：SQLite → UI

這樣邏輯清楚，但也代表有兩組輪詢與兩組開關。若後續想簡化 UX，可考慮整合成單一資料刷新管線。

**方向**：
- 保留兩層架構，但由 live-sync 成功後主動觸發 UI 尾端刷新
- 或重新設計成單一「即時模式」開關

---

## 低優先

### FEAT-02 — live-sync 目前只支援單一 symbol
**位置**：`useLiveSync.ts` / `Toolbar.tsx`

現在只會同步當前圖表所在的 symbol。若之後有 watchlist 需求，可以支援額外釘住幾個 symbol 在背景同步。

---

### FEAT-03 — live-sync 仍採 polling，尚未切 WebSocket
**位置**：`backend/core/live_fetch.py`

目前是定時補 K 線，簡單穩定，但延遲仍是秒級到分鐘級。若未來需要更即時的體驗，可評估 Binance `@kline` streams。

---

## 已知限制

- 回放模式不支援儲存 / 恢復 session（marks + positions）
- 力道子圖在回放期間的精確度仍受限於已知 K 線資料
- 即時同步目前只支援 polling，不做 WebSocket 推播
- 若同時開啟 `即時同步` 與 `python fetch_klines.py --watch`，雖然資料不會壞，但會重複打 Binance API
