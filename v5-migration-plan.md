# Lightweight Charts v4 → v5 升級企劃書

## 0. 文件目的

將前端圖表函式庫從 `lightweight-charts@^4.2.0` 升級至 `^5.0.0`，**維持現有功能 1:1 等價**，並為後續「TradingView 風格倉位工具」取得 v5 的 `ISeriesPrimitive` 自訂繪圖能力。

本文件是給接手工程師的交付規格：包含變更清單、階段拆解、驗收條件與風險控管。

---

## 1. 背景 / 動機

| 項目 | 現況 (v4) | 升到 v5 之後 |
|---|---|---|
| 自訂繪圖物件 (filled band、可拖曳 overlay) | ❌ 沒有 primitives API，目前以 DOM 疊加層 + `requestAnimationFrame` 硬刻 | ✅ `ISeriesPrimitive` 官方支援 |
| 多系列 API | `addCandlestickSeries` / `addLineSeries` 等分散方法 | 統一 `addSeries(XxxSeries, {...})`，型別更一致 |
| 未來維護 | v4 已進入僅修重大 bug 狀態 | v5 為主要維護線 |
| License / 費用 | Apache 2.0，商用免費 | 同前，無差異 |

**觸發時機：** 後續要把目前的倉位工具往 TradingView 風格（填色盈虧帶、整條線拖曳、點圖放倉）推進時，v4 實作成本顯著增加。升 v5 是該方向的前置基礎設施。

---

## 2. Scope

### In scope

- 前端 `lightweight-charts` 依賴升級
- `frontend/src/components/Chart.tsx`（主圖）全部 API 遷移
- `frontend/src/components/SubChart.tsx`（力道子圖）全部 API 遷移
- 既有視覺/互動行為維持 1:1 等價（見第 7 節驗收條件）

### Out of scope（另立 PR）

- TradingView 風格倉位工具的重寫（留待 v5 完成後以 `ISeriesPrimitive` 另行規劃）
- 後端、資料層、其他 UI
- 效能調校、bundle 體積優化
- 視覺重新設計

---

## 3. 影響範圍

### 需要修改的檔案

| 檔案 | 行數 | 變更量 |
|---|---|---|
| `frontend/package.json` | — | 1 行依賴版本 |
| `frontend/package-lock.json` | — | 由 `npm install` 重新產生 |
| `frontend/src/components/Chart.tsx` | 700 | 約 40–60 行（集中在 series 建立、marker 設定） |
| `frontend/src/components/SubChart.tsx` | 164 | 約 10–15 行 |

### 不受影響的檔案

除上述兩個元件與 `package.json` 之外，其餘檔案（`App.tsx`、`Toolbar.tsx`、`MarkPanel.tsx`、`PositionPanel.tsx`、`PositionFormModal.tsx`、所有 `utils/*`、`api/*`、`types.ts`）皆不需要改動。

> **驗證指令：** `grep -r "lightweight-charts" frontend/src` 應該只有 2 個檔案命中。

---

## 4. 技術變更清單

> 下列是 v4 → v5 的 API mapping。**標記為「不變」的項目代表可以留原樣。** 實作前請同步對照官方 migration guide（連結見第 10 節）。

### 4.1 依賴升級

```diff
// frontend/package.json
- "lightweight-charts": "^4.2.0"
+ "lightweight-charts": "^5.0.0"
```

需要重跑：
```bash
cd frontend
rm -rf node_modules package-lock.json
npm install
```

### 4.2 Series 建立 API（必改）

| v4 | v5 |
|---|---|
| `chart.addCandlestickSeries(options)` | `chart.addSeries(CandlestickSeries, options)` |
| `chart.addLineSeries(options)` | `chart.addSeries(LineSeries, options)` |
| `chart.addHistogramSeries(options)` | `chart.addSeries(HistogramSeries, options)` |

**import 變更：**

```ts
// v5：series definition 必須額外 import
import { CandlestickSeries, LineSeries } from 'lightweight-charts';
```

**Chart.tsx 影響點：**
- 第 ~159 行：`chart.addCandlestickSeries({...})` 主 K 線
- 第 ~362 行：`chart.addLineSeries({...})` MA 線
- 第 ~445 行：`chart.addLineSeries({...})` 橫盤區間帶

**SubChart.tsx 影響點：**
- 對應的 `addLineSeries` 呼叫

### 4.3 Marker API（必改，最花時間的部分）

v5 將 markers 從 series 方法改成獨立 primitive。這是唯一行為模型有改動的地方。

**v4：**
```ts
series.setMarkers(markers);
```

**v5：**
```ts
import { createSeriesMarkers } from 'lightweight-charts';

// 初始化一次
const markerPrimitive = createSeriesMarkers(series, []);

// 後續更新
markerPrimitive.setMarkers(newMarkers);
```

**實作建議：**
- 在 `Chart.tsx` 新增 `markerPrimitiveRef = useRef(null)`，在 chart init 的 effect 內建立一次 `createSeriesMarkers(series, [])`
- 將 `Chart.tsx` 目前第 ~243 行起那整個 merging effect 中的 `seriesRef.current.setMarkers(markers)` 改為 `markerPrimitiveRef.current.setMarkers(markers)`
- `SeriesMarker<UTCTimestamp>` 型別本身**不變**，內部欄位（`time`、`position`、`shape`、`color`、`text`、`size`、`id`）亦不變

### 4.4 PriceLine API（不變）

`series.createPriceLine(...)` 與 `series.removePriceLine(...)` 在 v5 維持原樣。目前所有 priceLine 相關程式碼（選擇高亮線、倉位 TP/SL、波段價位線、區間起訖線）**可完全留用**。

### 4.5 Time scale / logical range（不變）

以下 API 在 v5 維持原樣：
- `chart.timeScale().subscribeVisibleLogicalRangeChange(cb)`
- `chart.timeScale().setVisibleLogicalRange({from, to})`
- `chart.timeScale().setVisibleRange({from, to})`
- `chart.timeScale().getVisibleRange()`
- `chart.timeScale().scrollToPosition(x, animated)`

### 4.6 Coordinate helpers（不變）

- `series.priceToCoordinate(price)` — 不變
- `series.coordinateToPrice(y)` — 不變

→ 倉位拖曳 overlay（`Chart.tsx` 的 RAF loop 與 handle DOM 管理）**整段可留用**。

### 4.7 Options 與其它（不變或微調）

以下皆不變，可直接 copy-paste：
- `crosshair.mode` + `CrosshairMode.Normal`
- `rightPriceScale`
- `layout.background` / `layout.textColor`
- `grid.vertLines` / `grid.horzLines`
- `timeScale.timeVisible` / `secondsVisible` / `tickMarkFormatter`
- `localization.timeFormatter`
- `LineStyle.Dashed` / `LineStyle.Dotted` / `LineStyle.Solid`
- series options: `priceLineVisible`, `lastValueVisible`, `title`, `lineWidth`, `color`, `priceLineVisible`, `crosshairMarkerVisible`

### 4.8 型別 import（不變）

`Chart.tsx` 頂部的型別 import 皆可保留：
```ts
import {
  ColorType, CrosshairMode, LineStyle,
  type IChartApi, type ISeriesApi,
  type CandlestickData, type UTCTimestamp, type SeriesMarker,
} from 'lightweight-charts';
```

v5 僅**新增** `CandlestickSeries` / `LineSeries` 等 series definition 需要 import，原有型別無 breaking change。

---

## 5. 實作階段拆解

建議分成 6 個小 commit，每個 commit 可獨立驗證、不破壞現有功能。

### Phase 1：依賴升級 + 編譯通過（0.5 day）

- 升級 `package.json`，清理 `node_modules`、`lockfile` 重裝
- 執行 `npm run build`，此時 TS 會跳出所有 v4 API 不存在的錯誤
- 不實作任何功能，僅盤點錯誤清單
- **Commit：** `chore: bump lightweight-charts to v5 (build broken)`

### Phase 2：Chart.tsx — series 建立（0.5 day）

- `addCandlestickSeries` / `addLineSeries` → `addSeries(XxxSeries, {...})`
- import `CandlestickSeries`, `LineSeries`
- 暫時把 `setMarkers` 註解掉讓檔案 build 過
- **驗證：** K 線、MA 線、橫盤區間帶渲染與 v4 視覺一致
- **Commit：** `refactor(chart): migrate series creation to v5 addSeries API`

### Phase 3：Chart.tsx — marker primitive（0.5 day）

- 新增 `markerPrimitiveRef`
- 在 chart init effect 最後加入 `markerPrimitiveRef.current = createSeriesMarkers(series, [])`
- 把第 ~243 行的 merging effect 結尾 `seriesRef.current.setMarkers(markers)` 改為 `markerPrimitiveRef.current.setMarkers(markers)`
- **驗證：**
  - 手動標記（1/2/3/H/L）新增後有出現對應 marker
  - 波段偵測（有效/無效兩種樣式）正確渲染
  - TD Sequential 數字 1–9 顯示正確且顏色對應（多/空）
  - 倉位開倉/平倉箭頭 marker 出現在正確的 K 線
- **Commit：** `refactor(chart): migrate setMarkers to createSeriesMarkers primitive`

### Phase 4：SubChart.tsx 遷移（0.5 day）

- 與 Phase 2、3 相同的 API 轉換
- **驗證：** 力道比 / count / quality / 位移效率四條線同 v4 渲染；子圖水平同步（含主圖拖超過資料邊界時）仍可運作
- **Commit：** `refactor(subchart): migrate to v5 APIs`

### Phase 5：整體 QA + polish（0.5 day）

- 跑完第 7 節的回歸清單
- 修視覺瑕疵（線寬、顏色、字級若因 v5 default 變動而偏離）
- **Commit：** `chore: v5 migration polish and regression fixes`

### Phase 6（選做）：POC v5 primitives（0.5 day）

- 用 `ISeriesPrimitive` 做一個最小實驗：在一個開倉倉位上加一個「填色盈虧帶」
- 不合併到 main，僅驗證 v5 primitives 足以支撐未來倉位工具升級
- **輸出：** 一段 PoC 程式碼 + 可行性報告（留在 PR 描述內）

---

## 6. 風險與降險

| 風險 | 可能影響 | 降險策略 |
|---|---|---|
| v5 migration guide 有我未列出的隱性變更 | Phase 4 後仍有殘餘視覺/行為差異 | Phase 5 QA 清單逐項對比 v4 branch 截圖；必要時二分法 git bisect 找問題點 |
| `createSeriesMarkers` 的 lifecycle 與 series disposal 互動不明 | 切換 symbol/interval 時 marker 殘留或 memory leak | 在 chart init effect 的 cleanup 中明確 `markerPrimitiveRef.current = null`；在 chart remove 前 detach |
| v5 對 options 的 defaults 有微調（顏色、線寬） | 與 v4 視覺有細微差異 | 截圖比對；必要時顯式指定原 v4 default 值 |
| `addSeries(CandlestickSeries, ...)` 的 options 型別比 v4 嚴 | TS build error | 用 `satisfies` 或補型別；不該用 `any` 繞過 |
| 拖曳 overlay 的 RAF 與 v5 的 render cycle 有不相容 | 倉位拖曳時 handle 跳動 | RAF 邏輯不依賴 v5 內部、只讀 `priceToCoordinate`，理論上應無影響；若有則改用 `chart.subscribeCrosshairMove` 做節流觸發 |
| PR 太大難 review | 合併風險、回滾成本高 | 分 6 個 commit，每 commit 可獨立 rollback |

---

## 7. 驗收條件（QA Checklist）

**前置：** 以 BTCUSDT 1h 為主測對象，另抽測 ETHUSDT 15m / 1d 各一次。

### 基礎功能
- [ ] `npm run build` TS strict 無錯誤
- [ ] `npm run dev` 啟動並正確渲染
- [ ] Console 無 error / warning

### 主圖
- [ ] K 線渲染正確（顏色、燭芯、時間軸）
- [ ] 時間軸顯示 `YY/M/D-HH:MM` 格式（UTC+8）
- [ ] Crosshair 十字游標正常
- [ ] 無限向左滾動載入歷史 K 線
- [ ] 自動更新不會跳回最新時刻（保留目前可視範圍）
- [ ] 日期跳轉功能正常

### 指標與 overlay
- [ ] MA（SMA/EMA 兩種、多長度）渲染與 v4 一致
- [ ] 橫盤區間帶 active（琥珀）/ inactive（藍）顏色正確
- [ ] 波段偵測：有效（大圓）/ 無效（小暗圓）兩種樣式
- [ ] TD Sequential：buy/sell 兩邊數字皆顯示，完成 setup 9 時變亮

### 標記
- [ ] 1/2/3/H/L 快捷鍵新增標記
- [ ] 前高/前低標記帶出虛線 price line
- [ ] Delete 鍵刪除當根 K 線所有標記
- [ ] 側欄標記列表同步

### 選中高亮
- [ ] 點擊 K 線出現白色虛線
- [ ] Shift+點擊區間，首尾兩條藍色實線
- [ ] ESC 取消選擇
- [ ] 鍵盤 ←/→ 移動選中

### 力道子圖
- [ ] 開關按鈕顯示/隱藏子圖
- [ ] 四條指標線（force/count/quality/位移）顏色正確
- [ ] 主圖水平捲動時子圖同步
- [ ] 主圖拖超過資料邊界時子圖也同步跟隨

### 最新價格線
- [ ] `現價線` toggle 可關閉右軸最新價格水平線與 tag

### 倉位
- [ ] `開多 P` / `開空 O` 按鈕與快捷鍵都能開啟 modal
- [ ] Modal 進場時間正確、預設 TP/SL 在正確方向 1%
- [ ] 倉位 entry 實線 + TP/SL 虛線 price line 渲染
- [ ] Entry 標題含浮動 PnL %
- [ ] 右側欄倉位卡片顯示正確
- [ ] 開倉箭頭 marker（↑多 ↓空）在進場 K 線
- [ ] 平倉 marker（灰方塊）在出場 K 線
- [ ] 右側三顆拖曳 pill（Entry/TP/SL）可上下拖曳並存檔
- [ ] 平倉 modal 正確顯示 PnL 預覽
- [ ] 匯出 CSV 功能正常，Excel 開中文不亂碼

### 側欄
- [ ] K 線資訊側欄收合 / 展開不報錯（曾有 Rules of Hooks bug，需特別確認）
- [ ] 倉位側欄收合 / 展開正常
- [ ] localStorage 收合狀態持久化

### 持久化
- [ ] 重新載入瀏覽器後：symbol、interval、各開關、MA 長度、倉位列表都還在

---

## 8. 預估工時

| 階段 | 工時 |
|---|---|
| 熟 v5 migration guide | 0.5 day |
| Phase 1（依賴） | 0.5 day |
| Phase 2（Chart series） | 0.5 day |
| Phase 3（Chart markers） | 0.5 day |
| Phase 4（SubChart） | 0.5 day |
| Phase 5（QA + polish） | 0.5 day |
| Phase 6（primitives POC，選做） | 0.5 day |
| Buffer（10%） | 0.5 day |
| **合計** | **3.5–4 days** |

> 對象：一位熟悉 React 18 + TypeScript、讀過 lightweight-charts v4 文件、有能力讀 migration guide 的中階前端工程師。

---

## 9. 交付物

1. **Pull Request** 一份，包含第 5 節列出的 6 個 commit
2. PR 描述含：
   - 本文件連結
   - v4 branch 與 v5 branch 的截圖對照（至少 3 張：主圖 + 力道子圖、倉位工具、標記）
   - 第 7 節 QA checklist 逐項勾選
3. 若做 Phase 6：`ISeriesPrimitive` PoC 片段（可以用 gist 或獨立 branch）
4. （選）於 `docs/` 新增 `v5-notes.md` 紀錄升級過程發現的注意事項，供日後升 v6 時參考

---

## 10. 參考

- **官方 migration guide（必讀）**：https://tradingview.github.io/lightweight-charts/docs/migrations/from-v4-to-v5
- **v5 API 文件**：https://tradingview.github.io/lightweight-charts/docs
- **v5 plugins / primitives（為未來倉位工具準備）**：https://tradingview.github.io/lightweight-charts/plugin-examples
- **License (Apache 2.0) + 歸屬要求**：https://github.com/tradingview/lightweight-charts/blob/master/LICENSE
- **現有程式碼主要接觸點：**
  - `frontend/src/components/Chart.tsx`
  - `frontend/src/components/SubChart.tsx`

---

## 11. 開工前 checklist（給接手工程師）

- [ ] 讀完本文件第 1–4 節
- [ ] 讀完官方 migration guide
- [ ] 本機 `git checkout -b feat/lightweight-charts-v5`
- [ ] `npm run dev` 起動現有 v4 版本、熟悉既有功能（特別是第 7 節所列清單）
- [ ] 在 v4 版本下對主圖截圖存檔，做為後續比對基準
- [ ] 開始 Phase 1
