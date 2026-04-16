# Replay Feature Implementation Plan

## 0. 目標

在現有交易圖表工具上新增「K 線回放」功能，讓使用者可以從指定時間點開始，逐根或自動播放後續 K 線，並在回放過程中進行觀察、標記與模擬持倉。

第一版目標不是做完整回測引擎，而是先做出穩定、可互動、沒有 future leak 的 replay workflow。

---

## 1. MVP 範圍

### In Scope

- 單一 `symbol + interval` 的 K-bar replay
- 從指定時間點進入回放
- 支援 `播放 / 暫停 / 單步前進 / 單步後退 / 調速 / 結束回放`
- 主圖、子圖、波段、橫盤、TD、MA 都跟著 replay 游標更新
- 回放中的標記與持倉獨立於正式資料
- 回放模式中禁止顯示游標之後的未來資料

### Out of Scope

- Tick replay
- 完整策略回測報表
- 回放 session 永久保存
- 自動化交易規則引擎

---

## 2. 核心原則

1. `No Future Leak`
   回放游標之後的資料，不能出現在主圖、子圖、波段、橫盤、TD、標記預設值、持倉預設值中。

2. `Live Mode Must Stay Intact`
   不開 replay 時，現有功能與操作流程必須維持原樣。

3. `Replay Data Must Be Sandboxed`
   回放期間新增的標記與持倉不能污染正式 marks DB 與正式 localStorage positions。

4. `Deterministic`
   同一個 `symbol / interval / anchorTs / replay cursor`，每次打開結果都應一致。

5. `Responsive UI`
   播放時不應每步都讓整張圖明顯重整或跳動。

---

## 3. 現況限制

目前系統要做 replay，會先碰到以下幾個結構問題：

1. [frontend/src/App.tsx](/C:/Users/User/Desktop/Ace/trading/frontend/src/App.tsx) 目前把 `candles` 同時當成資料來源與畫面顯示資料。
2. [frontend/src/api/client.ts](/C:/Users/User/Desktop/Ace/trading/frontend/src/api/client.ts) 對應的 `swings / indicators/series / ranges` 都是「拿最新資料算結果」，不適合 replay。
3. [backend/routes/marks.py](/C:/Users/User/Desktop/Ace/trading/backend/routes/marks.py) 會直接寫正式 marks DB。
4. [frontend/src/App.tsx](/C:/Users/User/Desktop/Ace/trading/frontend/src/App.tsx) 的 `positions` 走 `useLocalStorage('positions')`，也會直接寫正式資料。
5. [frontend/src/components/Chart.tsx](/C:/Users/User/Desktop/Ace/trading/frontend/src/components/Chart.tsx) 現在大部分更新仍以 props 驅動；回放逐步前進時，必須避免不必要的全量重畫。

---

## 4. 建議架構

### 4.1 模式切分

新增兩種模式：

- `live mode`
- `replay mode`

切換 replay 時，不應只是改一個布林值，而應有一個獨立的 replay session。

### 4.2 資料分層

建議把 K 線拆成三層：

- `sourceCandles`
  已載入到前端記憶體中的完整資料池，可能包含 replay 游標之後的 bars，但不直接顯示。
- `visibleCandles`
  真正傳給 `Chart` 的資料，只能到 replay 游標為止。
- `derivedVisibleData`
  依據 `visibleCandles` 算出來或查出來的 swings / indicators / ranges / markers overlays。

### 4.3 Replay State

建議新增 `ReplayState`，至少包含：

```ts
type ReplayStatus = 'idle' | 'paused' | 'playing' | 'ended';

interface ReplayState {
  enabled: boolean;
  status: ReplayStatus;
  anchorTs: number | null;
  cursorIndex: number;
  speed: 1 | 2 | 4 | 8;
  warmupBars: number;
  forwardPreloadBars: number;
}
```

### 4.4 Session Data

回放期間需要獨立維護：

- `sessionMarks`
- `sessionPositions`
- `sessionSelectedCandle`
- `sessionRangeSelection`

這些資料只存在 replay session，不進正式資料源。

### 4.5 控制器切分

建議新增：

- `frontend/src/replay/useReplayController.ts`
- `frontend/src/replay/types.ts`
- 視情況新增 `frontend/src/components/ReplayControls.tsx`

`App.tsx` 只負責接線，不直接承擔 replay 所有邏輯。

---

## 5. 後端 API 改造需求

目前 replay 最大風險是 future leak，所以以下 API 都要支援「截至某時間點」的查詢：

1. [backend/routes/klines.py](/C:/Users/User/Desktop/Ace/trading/backend/routes/klines.py)
   已經支援 `start / end / limit`，可直接重用。

2. [backend/routes/swings.py](/C:/Users/User/Desktop/Ace/trading/backend/routes/swings.py)
   需要新增 `end`，只用 `timestamp <= end` 的資料做 pivot 與 validity 計算。

3. [backend/routes/series.py](/C:/Users/User/Desktop/Ace/trading/backend/routes/series.py)
   需要新增 `end`，讓 force/displacement 子圖只算到 replay 游標。

4. [backend/routes/ranges.py](/C:/Users/User/Desktop/Ace/trading/backend/routes/ranges.py)
   需要新增 `end`，讓橫盤區間只看當前可見資料。

### API 檢查點

- 同一個 `end` 下，多次請求結果一致
- 回放游標往前時，不會出現超前的波段或橫盤
- 子圖最後一根永遠對齊目前 replay 的最後可見 K 線

---

## 6. 前端實作階段

### Phase 1. Scope Freeze

完成內容：

- 確認 replay 第一版規格
- 確認是否要支援單步後退
- 確認回放結束後是停在末端還是自動退出
- 確認 replay 是否允許修改正式 UI state

檢查點：

- 有一份明確 MVP 規格
- 不再邊做邊擴 scope

### Phase 2. Replay State Refactor

完成內容：

- 在 [frontend/src/App.tsx](/C:/Users/User/Desktop/Ace/trading/frontend/src/App.tsx) 切分 `sourceCandles` 與 `visibleCandles`
- 新增 replay state 與 replay session state
- 整理 live mode 與 replay mode 的資料分流

檢查點：

- replay 關閉時，畫面與現在完全一致
- replay 開啟後，`visibleCandles` 不再直接等於完整資料池

### Phase 3. Replay Data Loading

完成內容：

- 新增 `enterReplay(anchorTs)`
- 進入 replay 時，抓一段 `warmupBars + forward preload`
- 游標接近尾端時自動背景補抓下一批資料

檢查點：

- 起始點附近有足夠 warmup 可算 MA / TD / swings / force / ranges
- 播放到 preload 邊界不會卡住

### Phase 4. Replay Engine

完成內容：

- `play`
- `pause`
- `stepForward`
- `stepBackward`
- `scrubTo`
- `exitReplay`

檢查點：

- `play -> pause -> play` 不會重複建立 timer
- 到最後一根自動 pause
- 單步一次只推進一根 bar

### Phase 5. Derived Data Gating

完成內容：

- swings 改成支援 replay cursor
- force subchart 改成支援 replay cursor
- ranges 改成支援 replay cursor
- TD / MA 只基於 `visibleCandles`

檢查點：

- overlay 不會看到未來
- 回放與 live 模式下的 overlay 更新邏輯清楚分離

### Phase 6. Replay UI Controls

完成內容：

- 在 [frontend/src/components/Toolbar.tsx](/C:/Users/User/Desktop/Ace/trading/frontend/src/components/Toolbar.tsx) 或新元件中加入 replay controls
- 支援選擇起點、播放控制、速度控制、進度顯示
- 回放啟動時自動停用 `autoRefresh`

檢查點：

- control 狀態清楚
- 按鈕文案不會和既有功能混淆
- 日期跳轉與 replay 起點設定不互相打架

### Phase 7. Chart Integration

完成內容：

- `Chart` 改吃 `visibleCandles`
- 回放前進時，優先考慮增量更新而不是每步整包 `setData`
- 保持目前選中 K 線、拖曳持倉線、placing mode 行為可用

檢查點：

- 播放時視窗不亂跳
- 點 K 線不會整圖重整
- 回放中持倉線與 marker 仍可正常操作

### Phase 8. Replay Sandbox

完成內容：

- 回放中的 marks 改走 session store
- 回放中的 positions 改走 session store
- 回放中禁止寫正式 DB / 正式 localStorage

檢查點：

- 回放新增標記後，正式 marks 不變
- 回放開倉平倉後，正式 positions 不變

### Phase 9. Panels Adaptation

完成內容：

- [frontend/src/components/MarkPanel.tsx](/C:/Users/User/Desktop/Ace/trading/frontend/src/components/MarkPanel.tsx) 在 replay mode 改讀 session data
- [frontend/src/components/PositionPanel.tsx](/C:/Users/User/Desktop/Ace/trading/frontend/src/components/PositionPanel.tsx) 在 replay mode 顯示 session positions
- `currentPrice` 改成 replay 最後可見 K 線 close

檢查點：

- panel 顯示資訊與圖表一致
- 平倉預設值不會引用未來價格

### Phase 10. QA & Acceptance

完成內容：

- 跑完整回放驗收案例
- 補 smoke checklist
- 確認 replay on/off 來回切換穩定

檢查點：

- 功能可 demo
- 沒有 future leak
- 沒有正式資料污染

---

## 7. 驗收案例

### 基本流程

1. 選一個歷史時間點進入 replay
2. 畫面只顯示起點之前的 warmup + 起點當下可見資料
3. 單步前進 10 根，圖表與 overlays 同步更新
4. 播放到最後一根，自動停住
5. 退出 replay，回到 live mode

### 資料隔離

1. 回放中新增 3 個 marks
2. 回放中開倉、拖曳 TP/SL、平倉
3. 結束 replay
4. 確認正式 marks 與正式 positions 沒有被污染

### Future Leak 防呆

1. 在某一個歷史時間點開始 replay
2. 記錄當下 swings / force / ranges / TD
3. 將 replay cursor 往後走 20 根
4. 回到原位置，結果應與原先一致

### 性能

1. 500~1000 根資料下播放 1x / 2x / 4x
2. 圖表不應每步閃爍
3. 子圖同步不應有明顯延遲

---

## 8. 風險點

1. `visibleCandles` 與 `sourceCandles` 沒切乾淨，容易導致 future leak。
2. overlays 若仍走「最新資料 API」，結果會直接穿幫。
3. marks / positions 若沒 sandbox，回放練習資料會污染正式資料。
4. 若每一步都全量 `setData`，畫面容易抖動且效能差。
5. 若 replay timer 沒管理好，容易出現重複播放或 pause 無效。

---

## 9. 建議先後順序

推薦的實作順序：

1. 後端 bounded APIs
2. 前端 replay state 切分
3. replay engine
4. replay controls
5. sandbox marks / positions
6. 全流程 QA

不要先做花俏 UI，再回頭補資料隔離與 future leak，否則重工會很大。

---

## 10. 待決策事項

以下項目建議在正式開工前先定掉：

1. 回放起點要不要支援直接從工具列日期欄進入？
2. 單步後退是否為第一版必要功能？
3. 回放速度要不要先只做 `1x / 2x / 4x`？
4. 回放中的 marks / positions 是否要支援匯出？
5. 結束 replay 時，session 是直接清空，還是保留到重新整理頁面前？

---

## 11. 建議新增/修改檔案

### 新增

- `frontend/src/replay/types.ts`
- `frontend/src/replay/useReplayController.ts`
- `frontend/src/components/ReplayControls.tsx` 或整合到 `Toolbar.tsx`

### 修改

- [frontend/src/App.tsx](/C:/Users/User/Desktop/Ace/trading/frontend/src/App.tsx)
- [frontend/src/api/client.ts](/C:/Users/User/Desktop/Ace/trading/frontend/src/api/client.ts)
- [frontend/src/components/Toolbar.tsx](/C:/Users/User/Desktop/Ace/trading/frontend/src/components/Toolbar.tsx)
- [frontend/src/components/Chart.tsx](/C:/Users/User/Desktop/Ace/trading/frontend/src/components/Chart.tsx)
- [frontend/src/components/MarkPanel.tsx](/C:/Users/User/Desktop/Ace/trading/frontend/src/components/MarkPanel.tsx)
- [frontend/src/components/PositionPanel.tsx](/C:/Users/User/Desktop/Ace/trading/frontend/src/components/PositionPanel.tsx)
- [backend/routes/swings.py](/C:/Users/User/Desktop/Ace/trading/backend/routes/swings.py)
- [backend/routes/series.py](/C:/Users/User/Desktop/Ace/trading/backend/routes/series.py)
- [backend/routes/ranges.py](/C:/Users/User/Desktop/Ace/trading/backend/routes/ranges.py)

---

## 12. 結論

這個功能的關鍵不是「播放 K 線」，而是：

- 資料源切分
- overlays 不看未來
- session sandbox
- UI 與 timer 穩定

如果以上四個點先做對，第一版 replay 就會有可用性；如果其中任一點做錯，功能表面上看起來能跑，但實際上會有很高機率變成錯誤訓練工具。
