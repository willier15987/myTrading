# 待辦與改善清單

> 由程式碼審查（2026-04-16）產出。依優先度排列。

---

## 高優先（影響日常使用）

### BUG-01 — 回放錨點時間輸入失敗無回饋
**位置**：`App.tsx` `handleReplayAnchorInputChange`

`parseDateTimeInput` 解析失敗時靜默 return；使用者點「開始」沒有反應，不知道是時間格式有問題。

**修法**：解析失敗時清空 `replayAnchorTs` 並顯示提示（toast 或 input 邊框變紅）。

---

### BUG-02 — 方向鍵可選到早於回放游標的 K 線
**位置**：`App.tsx` 鍵盤 handler（`ArrowLeft`）

回放模式下 `ArrowLeft` 可以把 selectedCandle 往前移到 cursorIndex 之前的 K 線，在那裡放倉位會造成時序錯亂（entry_ts < 目前回放時間）。

**修法**：回放模式中禁用 ArrowLeft；或限制 `nextIndex` 不得小於 `replayState.cursorIndex`。

---

### FEAT-01 — 回放倉位退出後消失，無任何警告
**位置**：`App.tsx` `exitReplay`

回放期間開的倉位儲存在 `replayPositions`（非持久），退出後全部清空，沒有任何確認提示。

**修法**：退出前若 `replayPositions.length > 0`，彈出確認框：「您有 N 個回放倉位，退出後將清除，確定離開？」；或加「匯出 CSV」按鈕。

---

### FEAT-02 — 回放控制沒有鍵盤捷鍵
**位置**：`App.tsx` 鍵盤 handler

須用滑鼠點擊工具列按鈕，效率低。

**建議快捷鍵**：

| 鍵 | 動作 |
|----|------|
| `Space` | 播放 / 暫停 |
| `]` 或 `→`（回放模式） | 步進下一根 |
| `[` | 步進上一根 |

---

## 中優先（UX 明顯缺口）

### BUG-03 — 進入回放後沒有自動選中錨點 K 線
**位置**：`App.tsx` `enterReplay`

進入回放後 `setSelectedCandle(null)` 清空選擇，但沒有選中錨點 K 線，使用者缺乏視覺起點。

**修法**：`setSelectedCandle(anchorCandle)` 取代 `setSelectedCandle(null)`。

---

### BUG-04 — 前向預載進行時播放卡住無任何提示
**位置**：`App.tsx` 播放 interval 邏輯

`replayHasMoreFutureRef.current === true` 時 cursorIndex 不前進，畫面凍住，使用者誤以為故障。

**修法**：加一個 `replayLoadingFuture` state，工具列顯示「載入中…」或 spinner；預載完成後自動繼續播放。

---

### FEAT-03 — 缺乏全域錯誤通知（Toast）
目前所有 API 失敗都只 `console.error`：前向預載失敗、歷史資料抓取失敗等，使用者看不到。

**建議**：加一個輕量 toast/snackbar（可用純 CSS+React state，不需第三方套件），統一顯示 3 秒後自動消失。

---

### FEAT-04 — 倉位 TP/SL 拖曳缺乏合法性驗證
**位置**：`App.tsx` `handlePositionUpdate`

拖曳可以把多頭 TP 設到 entry 以下，或 SL 設到 entry 以上，造成邏輯錯誤。

**修法**：在 `handlePositionUpdate` 或 `onPositionUpdate` 中加入方向驗證：
```
long:  tp_price > entry_price, sl_price < entry_price
short: tp_price < entry_price, sl_price > entry_price
```
違反時靜默恢復原值（或顯示短暫警告）。

---

## 低優先（體驗優化）

### PERF-01 — 子圖時間偏移在回放推進後漂移
**位置**：`App.tsx` `onVisibleLogicalRangeChange` callback

```
offset = candlesLenRef.current - indicatorLenRef.current
```

回放推進時 `candlesLenRef` 增加，但指標資料沒有跟著補抓，偏移量會越來越不準，力道子圖可能對不齊。

**修法**：回放啟動時一次抓取對應的指標資料，或切換至回放模式時隱藏子圖。

---

### FEAT-05 — 分頁隱藏時回放繼續播放
切到其他分頁後回來，游標已跑很遠。

**修法**：監聽 `document.visibilitychange`，隱藏時自動暫停（auto-refresh 已有相同邏輯可參考）。

---

### FEAT-06 — 回放時間軸缺乏 Scrubber
目前只能單步或修改 datetime-local 後重新啟動，無法快速跳到任意進度。

**建議**：工具列加 `<input type="range" min={0} max={replayLoadedBars - 1} value={replayCursorIndex} />`，拖動時暫停並跳至對應 index。

---

### FEAT-07 — 回放結束後無統計摘要
播放完成後除了狀態顯示「已到尾端」外沒有任何回顧資訊。

**建議**：回放結束時顯示小卡片：
- 共走過 N 根 K 線
- 開了 N 個倉位（N 多 / N 空）
- 放置了 N 個標記

---

### PERF-02 — 高速播放效能（8x = 125ms/bar）
每根 K 線觸發一次 `candles` useMemo → Chart re-render → `setData()`。在 1 分鐘圖等密集資料下可能感覺頓。

**建議**：批次更新 cursorIndex（例如一次跳 2–4 根），或改為 requestAnimationFrame 驅動而非 setInterval。

---

## 已知限制（暫不處理）

- 回放模式不支援儲存/恢復 session（marks + positions）
- 力道子圖在回放期間精確度有限（後端指標以已知 K 線計算）
- 目前僅支援讀取 SQLite 靜態資料，無法接入即時 WebSocket 行情
