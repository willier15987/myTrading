# 交易分析逆向工程工具 - 開發規格書

> 本文件為 `trading_analysis_framework.md` 配套的 UI 工具開發規格。
> 目的：讓交易者能在 TradingView 風格的圖表上手動標記多空判斷，並與量化指標即時對照，找出人類直覺與哪些量化指標最吻合。

---

## 一、專案背景

### 1.1 最終目標

交易者已建立一套完整的多空力道量化框架（見 `trading_analysis_framework.md`），但所有演算法需要**大量參數校準**（例如 `body_ratio > 0.65`、`force_ratio > 0.6` 等閾值）。

本工具是該框架的**校準與驗證平台**：
- 使用者在真實歷史 K 線上用直覺標記關鍵點（多方主導、空方主導、反轉點、有效前高/前低）
- 工具自動記錄該點位的所有量化指標數值
- 累積足夠樣本後，統計分析「哪些指標組合最能預測使用者的直覺判斷」
- 反饋回去調整框架的預設參數

### 1.2 操作體驗目標

**必須接近 TradingView 的操作手感**：滾輪縮放、拖曳平移、流暢互動。使用者每天會長時間操作此工具，任何卡頓或不符合直覺的互動都會直接影響工作效率。

---

## 二、技術選型

| 層級 | 技術 | 備註 |
|------|------|------|
| 前端框架 | React + TypeScript | 建議 TS，型別安全對長期維護重要 |
| 圖表函式庫 | **lightweight-charts**（TradingView 官方開源） | 不要用其他圖表庫，這是最接近 TradingView 手感的選擇 |
| 建置工具 | Vite | 熱更新快 |
| 後端框架 | FastAPI (Python 3.11+) | 自動 OpenAPI 文件，開發速度快 |
| 計算函式庫 | pandas, numpy | 框架中所有演算法原本就是 Python |
| 資料庫 | SQLite（既有 `crypto_data.db` + 新建 `marks.db`）| 兩個 DB 分離 |
| 開發模式 | 前後端分離，各自熱更新 | 前端 `vite dev`，後端 `uvicorn --reload` |

---

## 三、資料庫

### 3.1 既有 K 線資料庫（唯讀）

**路徑**：`D:\AI_Projects\Trading\script\coin\crypto_data.db`

**klines 表結構**：
```sql
CREATE TABLE klines (
    symbol    TEXT,
    interval  TEXT,
    timestamp INTEGER,  -- 毫秒 UNIX timestamp
    open      REAL,
    high      REAL,
    low       REAL,
    close     REAL,
    volume    REAL,
    PRIMARY KEY (symbol, interval, timestamp)
);
CREATE INDEX idx_symbol_interval ON klines(symbol, interval);
```

**資料覆蓋**：
- 126 個交易對（USDT 永續合約為主）
- 4 個時框：`15m`, `1h`, `4h`, `1d`
- 大多數幣種每時框 1000 根 K 線
- **BTCUSDT 資料最完整**（17280×15m / 4320×1h / 1080×4h / 180×1d），建議作為主要開發/測試標的
- 最新資料約到 2026-04 中旬

**其他表（`sr_levels`, `backtest_signals`）為舊系統遺留，本工具忽略。**

### 3.2 標記資料庫（新建，讀寫）

**路徑**：`./data/marks.db`（放在專案內，與 `crypto_data.db` 分離）

```sql
CREATE TABLE marks (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol      TEXT NOT NULL,
    interval    TEXT NOT NULL,
    timestamp   INTEGER NOT NULL,      -- 對應 K 線時間（ms），與 klines.timestamp 一致
    label_type  TEXT NOT NULL,         -- 見下表
    price       REAL,                  -- 選填：標記掛在哪個價位（用於 Swing High/Low）
    note        TEXT,                  -- 使用者備註
    indicators  TEXT,                  -- 標記當下的指標快照（JSON 字串）
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_marks_lookup ON marks(symbol, interval, timestamp);
```

**label_type 枚舉值**：
| 值 | 意義 |
|----|------|
| `bull_dominance` | 多方主導開始 |
| `bear_dominance` | 空方主導開始 |
| `force_shift` | 力量轉換點 |
| `valid_swing_high` | 有效前高 |
| `valid_swing_low` | 有效前低 |

**indicators 欄位（JSON）範例**：
```json
{
  "candle_quality": {
    "body_ratio": 0.72,
    "displacement": 0.85,
    "direction": 1
  },
  "force_analysis_lookback_10": {
    "force_ratio": 0.62,
    "count_ratio": 0.6,
    "quality_ratio": 1.15
  },
  "displacement_efficiency_lookback_20": 0.45,
  "atr_14": 1234.5
}
```
**規則**：標記建立時，後端必須自動計算當下的完整指標快照並序列化存入。未來要新增指標時，可在舊標記上批次補算。

---

## 四、專案結構

```
trading/
├── backend/
│   ├── main.py                    # FastAPI 入口
│   ├── db.py                      # SQLite 連線管理（兩個 DB）
│   ├── routes/
│   │   ├── __init__.py
│   │   ├── klines.py              # K 線相關端點
│   │   ├── indicators.py          # 指標計算端點
│   │   ├── marks.py               # 標記 CRUD
│   │   └── swings.py              # 有效 Swing 判定（Phase 2）
│   ├── core/                      # 純計算模組，對應 framework 文件
│   │   ├── __init__.py
│   │   ├── atr.py
│   │   ├── candle_quality.py      # framework §2.1
│   │   ├── force_analysis.py      # framework §3.1
│   │   ├── displacement.py        # framework §4
│   │   └── swing_validity.py      # framework §5（Phase 2）
│   ├── tests/
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── main.tsx
│   │   ├── App.tsx
│   │   ├── components/
│   │   │   ├── Chart.tsx          # lightweight-charts 主圖
│   │   │   ├── Toolbar.tsx        # 交易對/時框/日期選擇器
│   │   │   ├── MarkPanel.tsx      # 右側標記詳情面板
│   │   │   └── SubCharts.tsx      # 子圖（Phase 後期）
│   │   ├── api/
│   │   │   └── client.ts          # FastAPI 呼叫封裝
│   │   ├── hooks/
│   │   └── types.ts
│   ├── index.html
│   ├── package.json
│   ├── tsconfig.json
│   └── vite.config.ts
├── data/
│   └── marks.db                   # 首次啟動時自動建立
├── trading_analysis_framework.md  # 框架原始文件
└── ui_tool_spec.md                # 本文件
```

**注意**：`crypto_data.db` 保留在原路徑 `C:\Users\User\Desktop\Ace\coin\crypto_data.db`，不要移動或複製到專案內。

---

## 五、後端 API 規格

**基底 URL**：`http://localhost:8000`

### 5.1 交易對與資料範圍

```
GET /api/symbols
```
**回應**：
```json
[
  {
    "symbol": "BTCUSDT",
    "intervals": [
      {"interval": "15m", "start_ts": 1760513400000, "end_ts": 1776064500000, "count": 17280},
      {"interval": "1h",  "start_ts": 1760515200000, "end_ts": 1776063600000, "count": 4320},
      ...
    ]
  },
  ...
]
```

### 5.2 K 線資料

```
GET /api/klines?symbol=BTCUSDT&interval=1h&start=<ms>&end=<ms>&limit=1000
```
- `start` / `end` 可選；都不給時回傳最近 `limit` 根
- `limit` 預設 1000，上限 5000

**回應**：
```json
{
  "symbol": "BTCUSDT",
  "interval": "1h",
  "candles": [
    {"t": 1760515200000, "o": 62345.1, "h": 62500.0, "l": 62200.5, "c": 62410.3, "v": 123.45},
    ...
  ]
}
```
欄位縮寫用 `t/o/h/l/c/v` 以減少傳輸體積（圖表載入時這個最大）。

### 5.3 單根 K 線指標

```
POST /api/indicators/candle
Body: { "symbol": "BTCUSDT", "interval": "1h", "timestamp": 1760515200000, "atr_period": 14 }
```
**回應**：
```json
{
  "body_ratio": 0.72,
  "displacement": 0.85,
  "direction": 1,
  "body": 165.2,
  "range": 299.5,
  "atr": 194.3
}
```

### 5.4 範圍指標（框選時用）

```
POST /api/indicators/range
Body: { "symbol": "BTCUSDT", "interval": "1h", "start_ts": ..., "end_ts": ..., "atr_period": 14 }
```
**回應**：
```json
{
  "candle_count": 20,
  "force_analysis": {
    "bull_avg_force": 142.5,
    "bear_avg_force": 98.3,
    "force_ratio": 0.592,
    "count_ratio": 0.55,
    "quality_ratio": 1.45
  },
  "displacement_efficiency": 0.42,
  "atr": 194.3
}
```

### 5.5 標記 CRUD

```
GET    /api/marks?symbol=BTCUSDT&interval=1h
POST   /api/marks
DELETE /api/marks/{id}
PATCH  /api/marks/{id}   -- 編輯 note
```

**POST 請求 body**：
```json
{
  "symbol": "BTCUSDT",
  "interval": "1h",
  "timestamp": 1760515200000,
  "label_type": "bull_dominance",
  "price": 62410.3,
  "note": "放量突破前高"
}
```
**後端職責**：收到 POST 後，自動計算該時間點的完整指標快照（以該 K 線為中心，回看 20 根做 force_analysis、回看 20 根做 displacement_efficiency、單根的 candle_quality），存入 `indicators` 欄位。

**GET 回應**：陣列形式，`indicators` 欄位已經 parse 成物件（不要讓前端自己 `JSON.parse`）。

---

## 六、前端互動規格（重要）

### 6.1 主圖行為

- 使用 **lightweight-charts** 的 `createChart` + `addCandlestickSeries`
- **必須支援**：滾輪縮放、拖曳平移、游標十字線（這些都是函式庫原生功能，確保啟用）
- 初次載入時**顯示最右側 200 根**（最新資料），使用者可往左拉捲看歷史
- 當使用者拉到左側邊緣時，自動 fetch 更早的資料並 prepend（無限捲動）

### 6.2 頂部工具列（Toolbar）

- 交易對下拉選單（搜尋式，126 個交易對需要搜尋）
- 時框按鈕組：`15m` `1h` `4h` `1d`（單選）
- 日期跳轉輸入框（跳到特定時間點）
- 預設載入：`BTCUSDT` + `1h`

### 6.3 點擊 K 線行為

- 點擊任何一根 K 線 → 右側 `MarkPanel` 顯示該 K 線資訊
- 面板內容：
  - K 線基本資訊（OHLC、時間、成交量）
  - **單根指標**：body_ratio、displacement、direction（呼叫 `/api/indicators/candle`）
  - **回看區間指標**：以該 K 線為終點，回看 20 根的 force_analysis + displacement_efficiency（呼叫 `/api/indicators/range`）
  - 「新增標記」按鈕組（5 種 label_type）
  - 若該點已有標記，顯示現有標記列表 + 刪除按鈕

### 6.4 框選範圍行為

- **滑鼠拖曳兩根 K 線之間**（例如按住 Shift + 拖曳）→ 框選該範圍
- 右側面板顯示該段的 force_analysis + displacement_efficiency
- 可選擇性地將結果作為「段落分析」儲存（Phase 2 再做）

### 6.5 快捷鍵標記（加速工作流）

在點擊選中一根 K 線之後：
| 鍵 | 動作 |
|----|------|
| `1` | 標記為「多方主導開始」 |
| `2` | 標記為「空方主導開始」 |
| `3` | 標記為「力量轉換點」 |
| `H` | 標記為「有效前高」 |
| `L` | 標記為「有效前低」 |
| `Delete` | 刪除該點已有的標記 |
| `ESC` | 取消選擇 |

### 6.6 標記在主圖上的顯示

- 使用 lightweight-charts 的 `createPriceLine` 或 `setMarkers` API
- 不同 `label_type` 用不同顏色/形狀：
  - `bull_dominance`：綠色向上箭頭（K 線下方）
  - `bear_dominance`：紅色向下箭頭（K 線上方）
  - `force_shift`：黃色圓點
  - `valid_swing_high`：紅色橫線 + "H" 標籤
  - `valid_swing_low`：綠色橫線 + "L" 標籤
- 滑鼠 hover 標記點時顯示 tooltip（label_type + note 摘要）

---

## 七、Phase 1 MVP 驗收標準

第一個可用版本需要達成以下所有條件才算完成：

1. ✅ 後端 `uvicorn` 啟動後能從 `crypto_data.db` 正確讀取並吐出 JSON
2. ✅ 前端 `npm run dev` 啟動後能畫出 BTCUSDT 1h 的 K 線圖
3. ✅ 交易對下拉（含搜尋）與時框切換可正常運作
4. ✅ 圖表滾輪縮放、拖曳平移流暢（無卡頓）
5. ✅ 點擊 K 線後右側面板顯示該根 + 回看 20 根的所有指標數值
6. ✅ 框選範圍能計算並顯示該段的 force_analysis
7. ✅ 可用按鈕或快捷鍵標記 5 種 label_type，標記持久化至 `marks.db`
8. ✅ 標記在主圖上視覺化顯示，且重新整理後仍存在
9. ✅ 可刪除標記

**Phase 1 不需要做**：
- 自動偵測有效 Swing Point（演算法由使用者手動標記校準後再實作）
- 多時框聯動顯示
- 子圖（力道比曲線、ADX 等）
- 綜合評分模型
- 回測分析介面

---

## 八、計算模組實作指引

所有計算函式的**輸入/輸出規格、公式、參數預設值**完整寫在 `trading_analysis_framework.md`。實作時請直接對應文件章節：

| 模組檔案 | 對應 framework 章節 | 函式 |
|----------|--------------------|----|
| `core/candle_quality.py` | §2.1 | `candle_quality(o, h, l, c, atr)` |
| `core/force_analysis.py` | §3.1 | `force_analysis(candles, atr)` |
| `core/displacement.py` | §4 | `displacement_efficiency(candles)` |
| `core/atr.py` | 標準 ATR 即可 | `atr(candles, period=14)` |
| `core/swing_validity.py` | §5.2, §5.3 | `is_valid_swing_high/low()`（Phase 2）|

**重要**：演算法要**完全照文件實作**，不要自己改寫邏輯。參數預設值用文件「§11 待調整的參數清單」的建議起始值。未來使用者累積標記後會回頭調參數。

---

## 九、開發環境

- **OS**：Windows 11（使用者主機）
- **Shell**：Git Bash / PowerShell 皆可
- **Python**：3.11 或 3.12
- **Node**：18 LTS 或以上
- **套件管理**：Python 用 `venv` + `pip`，前端用 `npm` 或 `pnpm`

**啟動指令（開發時）**：
```bash
# 後端
cd backend
python -m venv venv
venv\Scripts\activate   # Windows
pip install -r requirements.txt
uvicorn main:app --reload --port 8000

# 前端（另一個終端）
cd frontend
npm install
npm run dev   # Vite 預設 5173 port
```

前端 Vite 設定需加 proxy 將 `/api` 轉發到 `http://localhost:8000`，避免 CORS 問題。

---

## 十、後續 Phase 預覽（供架構設計參考）

| Phase | 功能 | 預期時程 |
|-------|------|---------|
| Phase 1 | 本文件所定義的 MVP | - |
| Phase 2 | 有效 Swing Point 自動判定 + 視覺化 | - |
| Phase 3 | 動態窗口分段（以有效 Swing 切段）| - |
| Phase 4 | 子圖（力道比曲線、位移效率時序）| - |
| Phase 5 | 交易區間自動偵測 + 邊界顯示 | - |
| Phase 6 | 多時框聯動（點大時框某根 K → 自動展開小時框內部結構）| - |
| Phase 7 | 統計分析介面（直覺 vs 指標吻合度回測）| - |

架構設計時**不需要為這些預先佈線**，但請避免做出會阻擋未來擴充的決策（例如：不要把標記的 indicators 欄位設成固定 schema，JSON 字串留彈性）。

---

## 十一、交付物清單

工程師交付 Phase 1 時需提供：

1. 完整的 `backend/` 和 `frontend/` 程式碼
2. `README.md`：包含安裝、啟動、基本使用說明
3. `requirements.txt` 與 `package.json`（鎖定版本）
4. Phase 1 驗收標準 §7 的 demo（錄製一段 2~3 分鐘的操作影片或直接現場演示）
5. 已知限制與後續 Phase 的技術筆記（任何踩坑或取捨決策）

---

## 附錄：參考資料

- 框架原始文件：`trading_analysis_framework.md`
- lightweight-charts 文件：https://tradingview.github.io/lightweight-charts/
- FastAPI 文件：https://fastapi.tiangolo.com/
- 既有 K 線 DB 路徑：`C:\Users\User\Desktop\Ace\coin\crypto_data.db`
