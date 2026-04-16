# 即時抓取計畫書（Live Fetch Plan）

> 目標：前端一個開關，打開後每 N 分鐘自動把「當前圖表所在 symbol 的所有時框」最新的 K 線補齊到資料庫，再刷新畫面。
>
> 作者：2026-04-16 規劃，對應 repo 現況（`fetch_klines.py` 單機腳本 + FastAPI 後端 + React 前端）。

---

## 狀態註記（2026-04-16）

- `Phase 1` 到 `Phase 4` 已完成實作。
- `Phase 5（合併 auto-refresh）` 尚未做；目前採用「`live-sync` 補資料進 DB + 既有 `auto-refresh` 從 DB 刷 UI」的並行方案。
- 已完成端到端驗收：`/api/live/sync`、symbol lock、interval filter、`not_due` skip、前端工具列渲染均正常。
- 本文件保留為「規劃 / 設計紀錄」；實際使用說明以 `README.md` 為準，後續待辦以 `BACKLOG.md` 為準。

---

## 1. 需求整理

| 項目 | 內容 |
|------|------|
| 觸發條件 | 前端工具列「即時同步」toggle 開啟 |
| 輪詢週期 | 預設 60 秒；可調整（15s / 30s / 60s / 300s） |
| 範圍 | **當前顯示的 `symbol` 的所有時框（15m / 1h / 4h / 1d）**，不抓其他幣種（效能） |
| 行為 | 每個時框各自補齊 DB `MAX(timestamp)` 到「現在」之間的缺口，寫回 `klines` 表 |
| 成本優化 | 高時框（1h/4h/1d）上一根沒收時 `last_timestamp` 查完就 return，不打 Binance API |
| 暫停條件 | 回放模式進行中、瀏覽器分頁隱藏、後端回 429/418、符號切換中 |
| 視覺回饋 | 工具列顯示狀態（idle / syncing / ok / error + 上次同步時間） |
| 資料安全 | 使用 `INSERT OR REPLACE`，與現有 `fetch_klines.py --watch` 並行不會壞 |

**非目標**（本輪不做）：
- WebSocket 即時推送（仍維持 pull polling）
- 全幣種同步（仍由 `fetch_klines.py --watch` 負責）

---

## 2. 架構決策

### 2.1 核心邏輯放哪裡？

**決策：把 `fetch_klines.py` 的抓取邏輯抽出到 `backend/core/live_fetch.py`，標腳本改為 import 使用，後端也能共用。**

理由：
- 避免複製貼上（標腳本跟後端共用重試、退避、`INSERT OR REPLACE`、WAL 設定）
- 後端與 `fetch_klines.py --watch` 可以同時寫入同一個 DB（已 WAL，無衝突）
- 測試只要測一份程式碼

### 2.2 前端驅動還是後端驅動？

**決策：前端驅動 polling，後端只暴露「補齊一個 (symbol, interval) 的缺口」的無狀態 endpoint。**

理由：
- 後端不需要 session / 每個使用者各自的 state
- 使用者關掉瀏覽器後，不會留下殭屍 polling 任務
- 符號切換就直接停舊的 interval、開新的，最簡單

### 2.3 同步觸發時機

前端在以下時機呼叫後端 endpoint（不只是固定 interval）：

1. **定時**：每 N 秒由 `setInterval` 驅動
2. **切換 symbol 時立即觸發一次**（避免剛切過去要等 N 秒才看到最新；切換 interval 不需觸發因為所有時框已同步）
3. **分頁從隱藏變可見時**觸發一次（回到分頁立刻更新）

---

## 3. 後端設計

### 3.1 新檔：`backend/core/live_fetch.py`

抽自 `fetch_klines.py`：

```python
# 底層：單一 (symbol, interval)
async def sync_symbol_interval(
    symbol: str,
    interval: str,
    db_path: str = CRYPTO_DB_PATH,
) -> dict:
    """
    補齊單一 (symbol, interval) 從 DB 最後一根到現在的缺口。
    返回 {interval, added: int, last_ts: int, skipped: bool, reason?: str}
    """

# 上層：一個 symbol 的多個時框
async def sync_symbol(
    symbol: str,
    intervals: Iterable[str] = PREFETCH_INTERVALS,  # ('15m','1h','4h','1d')
    db_path: str = CRYPTO_DB_PATH,
) -> list[dict]:
    """
    同一 symbol 平行同步多個時框。各時框各自決定是否真的打 API。
    """
```

內部重用 `KlineStore`、`fetch_klines()`、`_get_json()`，行為與 `_sync_symbol_interval()` 一致。高時框「上一根未收」的 skip 判斷保留，確保絕大多數情況只有 15m 真的打 API。

### 3.2 新檔：`backend/routes/live.py`

```python
@router.post("/api/live/sync")
async def live_sync(
    symbol: str,
    intervals: str | None = None,  # 逗號分隔，例如 "15m,1h"；留空則抓預設四個時框
):
    iv_list = intervals.split(",") if intervals else list(PREFETCH_INTERVALS)
    results = await sync_symbol(symbol, iv_list)
    return {
        "symbol": symbol,
        "fetched_at": int(time.time() * 1000),
        "results": results,  # [{interval, added, last_ts, skipped?, reason?}]
    }
```

**防抖動**：後端用 dict-per-symbol lock 確保同一個 symbol 不會同時跑兩次（前端若誤觸也沒關係）。

```python
_locks: dict[str, asyncio.Lock] = {}

def _get_lock(symbol: str) -> asyncio.Lock:
    if symbol not in _locks:
        _locks[symbol] = asyncio.Lock()
    return _locks[symbol]
```

若 lock 已被佔用，就回 `{skipped: true, reason: "in_progress"}`，不排隊。

### 3.3 掛載到 `main.py`

```python
from .routes import ..., live
app.include_router(live.router)
```

### 3.4 aiohttp session 生命週期

每次 endpoint 呼叫都 `async with aiohttp.ClientSession()` 成本略高，但實際每分鐘只呼叫一次，沒必要過早優化。需要的話可改為 module-level session + `@app.on_event("shutdown")` 關閉。

---

## 4. 前端設計

### 4.1 新 state（放在 `App.tsx`）

```ts
const [liveSyncEnabled, setLiveSyncEnabled] = useLocalStorage('liveSyncEnabled', false);
const [liveSyncIntervalSec, setLiveSyncIntervalSec] = useLocalStorage('liveSyncIntervalSec', 60);
const [liveSyncStatus, setLiveSyncStatus] = useState<'idle'|'syncing'|'ok'|'error'>('idle');
const [liveSyncLastAt, setLiveSyncLastAt] = useState<number|null>(null);
const [liveSyncError, setLiveSyncError] = useState<string|null>(null);
```

### 4.2 新 API 客戶端：`frontend/src/api/live.ts`

```ts
export interface IntervalResult {
  interval: string;
  added: number;
  last_ts: number;
  skipped?: boolean;
  reason?: string;
}

export interface LiveSyncResponse {
  symbol: string;
  fetched_at: number;
  results: IntervalResult[];
}

export async function syncLive(symbol: string): Promise<LiveSyncResponse> {
  const r = await fetch(`${API_BASE}/api/live/sync?symbol=${symbol}`, { method: 'POST' });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}
```

### 4.3 Polling hook：`frontend/src/hooks/useLiveSync.ts`

```ts
export function useLiveSync(opts: {
  enabled: boolean;
  symbol: string | null;
  currentInterval: string;  // 僅用來判斷要不要觸發 UI 重讀
  pollSec: number;
  replayEnabled: boolean;   // 回放時停用
  onSynced: (r: LiveSyncResponse) => void;
  onStatus: (s: Status, err?: string) => void;
}) { ... }
```

**職責**：
- `enabled && !replayEnabled && symbol` 全部為真時才啟動
- 先立即跑一次（切換 symbol / 打開開關 / 從隱藏分頁回來都算）
- **切換 interval 不重跑**（所有時框都已同步；只需要 UI 層重讀對應資料）
- 設 `setInterval` 週期觸發，`clearInterval` 清乾淨
- 監聽 `document.visibilitychange`：隱藏時暫停、顯示時立即 sync
- 收到回應後：只要 `results` 裡「當前顯示的 interval」對應的 `added > 0` 就觸發 `onSynced`（避免其他時框有更新時白刷畫面）
- 失敗時 `onStatus('error', msg)` 但不拋出，避免打斷 UI
- 連續失敗 3 次才把狀態顯示為 error（暫時性網路問題不刷屏）

### 4.4 與 Chart / 資料的接合

- Chart 現在的取 K 線流程：`loadCandles(symbol, interval, start, end)` →  `setCandles(...)`
- 同步成功且 `added > 0` 時呼叫相同的 loader 重抓「最後 N 根」補進 state
- **不要整段重取**，只補尾巴（例如取最後 500 根合併進 state，比對 timestamp 去重）

若目前 `App.tsx` 已有類似 auto-refresh 的機制，直接沿用它的合併邏輯即可。

### 4.5 Toolbar UI

在既有工具列「回放」區塊旁邊加一組：

```
[即時同步] [●/○] [60s ▼]  上次: 10:25:12 (+3 根)
```

細節：
- Toggle 用現有 `actionBtnStyle(active)` 風格
- 下拉可選 15s / 30s / 60s / 300s
- 狀態點：灰（idle）/ 藍閃爍（syncing）/ 綠（ok）/ 紅（error，hover 顯示 error message）
- 「+N 根」只顯示當前 interval 的結果，其他時框的 added 不顯示（避免混淆，但 tooltip 可列完整 4 個時框狀態）
- 回放模式時 toggle 禁用並 tooltip「回放中停用」

### 4.6 與現有 auto-refresh 的關係

README 提到每 30s auto-refresh K 線。需要確認：

- 若現有 auto-refresh 只從 DB 重讀（沒觸發抓取），**保留它**並與 live-sync 並行：
  - live-sync 補資料進 DB
  - auto-refresh 重讀 DB → UI 更新
  - 語意清楚：一個管「從交易所到 DB」，一個管「從 DB 到 UI」
- 若兩個重疊，把 auto-refresh 收掉，改由 live-sync 的 `onSynced` 直接觸發 UI 重讀

**建議**：先做前者（並行），第二次 iteration 再考慮合併。

> 目前狀態：已採用前者，保留 `auto-refresh` 作為「DB → UI」更新層。

---

## 5. 邊界情況

| 情境 | 處理 |
|------|------|
| 使用者剛切 symbol | 切換時立刻 trigger 一次，不等 N 秒 |
| 使用者切 interval | 不重新 trigger（所有時框已同步），UI 層直接讀對應資料 |
| Binance 回 429 | 後端已有 retry/backoff；前端收到 500 時把輪詢暫停 2 分鐘再試 |
| DB 被 `fetch_klines.py --watch` 同時寫 | WAL 模式 + `INSERT OR REPLACE` 已處理；兩者可並存 |
| 最新一根 K 線還沒收盤 | `sync_symbol_interval` 已內建 `now_ms - last_ts < step_ms` 時 skip |
| 使用者在回放模式 | `replayEnabled` 為 true 時 hook 不啟動 |
| 分頁切到背景 | `visibilitychange` 暫停，切回來立刻 sync 一次 |
| 連續失敗 | 前端連續 3 次失敗後把狀態標紅，不停但將 poll 間隔調為 5 分鐘；成功後還原 |
| 切換 symbol 時 pending 請求 | 用 `AbortController` 或比對 response 的 symbol 是否仍是當前 symbol，不是就丟掉 |
| 網路離線 | `fetch` 會 throw，走 error 分支，下個週期再試 |
| 只有高時框更新 | 例如 1h 剛收盤但 15m 上一根已在 DB，照樣寫回；UI 若當前看 15m 則不 refetch，避免無謂閃爍 |

---

## 6. 分階段執行計畫

**每個 Phase 自成一 commit，可獨立驗證。**

### 目前進度

| Phase | 狀態 |
|------|------|
| Phase 1 — 後端抽取與 endpoint | 已完成 |
| Phase 2 — 前端 hook + API | 已完成 |
| Phase 3 — Toolbar UI + 狀態顯示 | 已完成 |
| Phase 4 — 錯誤 UX + 回放互斥 | 已完成 |
| Phase 5 — 合併 auto-refresh | 尚未執行 |

### Phase 1 — 後端抽取與 endpoint
**檔案**：`backend/core/live_fetch.py`（新）、`backend/routes/live.py`（新）、`backend/main.py`、`fetch_klines.py`（改為 import）

**驗收**：
- `curl -X POST "http://localhost:8000/api/live/sync?symbol=BTCUSDT"` 回 JSON，`results` 陣列含 4 個時框
- 非 15m 整點時只有 15m `added>0`，其餘 `skipped:true`
- 15m 整點後第一次呼叫：15m `added>=1`；第二次呼叫：`added=0`
- `?intervals=1h,4h` 可限制只跑指定時框
- `fetch_klines.py --watch` 仍可執行，邏輯不變

### Phase 2 — 前端 hook + API
**檔案**：`frontend/src/api/live.ts`、`frontend/src/hooks/useLiveSync.ts`、`App.tsx` 接線

**驗收**：
- 開關打開 → Network tab 每 60s 出一次 POST
- 關閉 → 請求停止
- 切 symbol → 立即觸發一次；切 interval → 不觸發新請求，但 UI 讀對應時框資料
- 分頁隱藏 → 停、顯示 → 立刻觸發

### Phase 3 — Toolbar UI + 狀態顯示
**檔案**：`Toolbar.tsx`

**驗收**：
- toggle / interval selector 可操作並持久化（localStorage）
- 狀態點顏色隨 `liveSyncStatus` 變化
- 顯示上次同步時間與 `+N 根`
- 回放模式下 toggle 禁用

### Phase 4 — 錯誤 UX + 回放互斥
**檔案**：`App.tsx`、`Toolbar.tsx`

**驗收**：
- 後端 500 時不刷屏，連錯 3 次才變紅
- 進入回放自動暫停 live-sync（且 UI 明確告知）
- 退出回放若原本開著，自動恢復

### Phase 5（選做）— 合併 auto-refresh
視 Phase 1–4 完成後的實際體驗決定是否做。

---

## 7. 風險與考量

| 風險 | 對策 |
|------|------|
| Binance rate limit | 已有 retry/backoff；前端最小週期限制在 15s；單次只抓 1 symbol × 1 interval，量極小 |
| 使用者同時開 `fetch_klines.py --watch` 與前端 live-sync | WAL + `INSERT OR REPLACE`，重複寫同一列無副作用；但會重複打 Binance API，建議文件上說明「擇一使用」 |
| 回放模式誤觸 | 用 `replayEnabled` 互斥判斷，且 toggle 在 UI 上 disable |
| 時框切換太快 | 用 `AbortController` 或 request-id 比對，忽略過期回應 |
| DB 寫入阻塞查詢 | WAL 模式已解決；前端如感到卡頓再看 |

---

## 8. 測試清單

**手動測試**：
1. 關閉後端 → UI 顯示 error，toggle 仍可切換
2. 打開 toggle → 等 60s → `data/crypto_data.db` 的 `MAX(timestamp)`（當前 symbol）4 個時框該變動的都變動
3. 在 15m 整點（例如 16:30）觀察：15m `added=1`、1h/4h/1d `skipped:true`
4. 在 1h 整點（例如 17:00）觀察：15m + 1h 都 `added=1`、4h/1d `skipped`
5. 切 symbol 到很久沒用的冷門幣 → 立刻觸發補齊全部 4 個時框
6. 切 interval（不切 symbol）→ 不應出現新的 POST 請求
7. 同時跑 `python fetch_klines.py --watch --poll 30`，前端開啟 live-sync → 互不干擾，DB 正常增長
8. 進入回放 → UI 確認 live-sync 停用
9. 開啟 toggle 後關閉瀏覽器 → 重開網頁，toggle 狀態持久化且自動恢復 polling

**已完成驗收摘要（2026-04-16）**：
- `POST /api/live/sync?symbol=BTCUSDT` 已成功補齊 15m / 1h / 4h / 1d 缺口並回傳結果。
- 同 symbol 並行請求時，後進請求會回 `skipped: true, reason: "in_progress"`。
- 同一 symbol 補齊後立即再打一次，會回 `skipped: true, reason: "not_due"`。
- `?intervals=1h,4h` 已驗證只回指定時框。
- 前端工具列已渲染 `即時同步` toggle、輪詢秒數選單、狀態點與狀態文字。

**回歸測試**：
- 標記、倉位、回放全部功能正常
- auto-refresh（若保留）仍運作

---

## 9. 後續可延伸

- **多 symbol watchlist**：使用者可額外「釘住」幾個 symbol 讓其背景同步
- **WebSocket 取代 polling**：改用 Binance `@kline` streams，延遲從分鐘級降到秒級
- **同步歷史區段**：支援手動指定 `start_time` 回補特定日期的空白

這些皆視 Phase 1–4 實測後的需求再評估。
