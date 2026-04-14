# myTrading — 開發筆記

> 給換電腦或重新拿起這個專案的自己看的。  
> 記錄所有設計決策、踩過的坑、以及「為什麼這樣做」。

---

## 這個工具是做什麼的

一個類 TradingView 的 K 線標記工具，用來**校準量化框架的參數**。

核心思路：
1. 人工在圖上標記「我認為這裡是有效前高/有效前低、多方主導、空方主導...」
2. 工具同時計算量化指標（force_ratio、位移效率等）
3. 對比「人的直覺」與「程式的判斷」，找出參數閾值

---

## 技術架構

```
myTrading/
├── run.py                  ← 啟動後端的入口（見下方說明）
├── backend/
│   ├── main.py             ← FastAPI app，所有 router 在這裡註冊
│   ├── db.py               ← 資料庫路徑設定（改路徑只改這裡）
│   ├── core/               ← 純計算模組，不依賴 FastAPI
│   │   ├── atr.py
│   │   ├── force_analysis.py
│   │   ├── displacement.py
│   │   └── swing_validity.py
│   └── routes/             ← API 端點
│       ├── klines.py
│       ├── indicators.py
│       ├── marks.py
│       ├── swings.py
│       ├── series.py       ← 力道/位移效率時間序列
│       └── ranges.py       ← 橫盤整理偵測
├── frontend/
│   └── src/
│       ├── types.ts        ← 所有 TypeScript 型別
│       ├── api/client.ts   ← 所有後端 API 呼叫
│       └── components/
│           ├── Chart.tsx   ← 主圖（K 線 + 波段標記 + 橫盤區間）
│           ├── SubChart.tsx← 力道子圖（force_ratio 直方圖 + 位移效率折線）
│           ├── Toolbar.tsx ← 頂部工具列
│           └── MarkPanel.tsx← 右側面板
├── data/
│   └── marks.db            ← 自動建立，儲存你的標記
├── glossary.md             ← 指標名詞解釋
└── README.md               ← 安裝與日常操作指南
```

**前端技術棧**：React + TypeScript + Vite + `lightweight-charts` v4.2.0（TradingView 開源圖表庫）

---

## 兩個資料庫

| 資料庫 | 路徑 | 用途 | 讀/寫 |
|--------|------|------|-------|
| `crypto_data.db` | `D:\AI_Projects\Trading\crypto_data.db` | 歷史 K 線（唯讀） | 唯讀 |
| `marks.db` | `./data/marks.db` | 你的標記 | 讀寫 |

要換 K 線資料庫路徑：修改 `backend/db.py` 第 4 行的 `CRYPTO_DB_PATH`。

---

## 啟動方式

```bash
# 後端（在 myTrading/ 目錄下）
python run.py

# 前端（在 myTrading/frontend/ 目錄下）
npm run dev

# 開啟瀏覽器
http://localhost:5173
```

> **為什麼不是 `python backend/main.py`？**  
> FastAPI 使用相對 import（`from .routes import ...`），直接跑 `main.py` 會報
> `ImportError: attempted relative import with no known parent package`。  
> 必須透過 `run.py`，讓 Python 把 `backend` 視為套件：
> ```python
> # run.py
> import uvicorn
> if __name__ == "__main__":
>     uvicorn.run("backend.main:app", reload=True, port=8000)
> ```

---

## 功能說明

### 1. K 線操作

| 動作 | 說明 |
|------|------|
| 滾輪 | 縮放 |
| 左鍵拖曳 | 平移 |
| 點擊 K 線 | 選中，右側面板顯示指標 |
| Shift + 點擊 | 選起點，再 Shift+點擊選終點，顯示區間分析 |
| 頂部「跳轉」欄 | 輸入日期，圖表自動跳到最近的 K 線 ±50 根 |
| 向左捲到底 | 自動載入更舊的資料（每次 300 根） |

---

### 2. 手動標記（快捷鍵）

> 需要先點擊選中一根 K 線

| 鍵 | 標記類型 | 說明 |
|----|----------|------|
| `1` | 多方主導開始 | 綠色向上箭頭，K 線下方 |
| `2` | 空方主導開始 | 紅色向下箭頭，K 線上方 |
| `3` | 力道轉換點 | 黃色圓點，K 線下方 |
| `H` | 有效前高 | 紅色方塊 + 水平虛線 |
| `L` | 有效前低 | 綠色方塊 + 水平虛線 |
| `Delete` | 刪除此 K 線所有標記 | |
| `Escape` | 取消選擇 | |

---

### 3. 自動波段偵測（「波段」按鈕）

偵測幾何高低點並驗證有效性。

**幾何判斷**：`pivot_n` 決定「左右各看幾根」。N=5 代表該點的 high/low 嚴格高於/低於左右各 5 根。

**有效性驗證**（三條件同時滿足）：
1. 到達高點前，多方有實際力道推進（force_ratio > 0.5）
2. 高點後，空方接管（force_ratio < 0.45）
3. 價格從高點下跌超過 0.5 ATR

**視覺呈現**：
- 有效：大圓圈（size:2），紅色（高點）/ 綠色（低點），標 H / L
- 無效：小圓圈（size:1），半透明

**延遲說明**：pivot_n=5 時，T0 最快只能確認 T-5 是否為高低點；T0 本身要等到 T+5 才能確認。這是所有 pivot 演算法共同的限制，無法消除。

---

### 4. 力道子圖（「力道」按鈕）

開啟後主圖下方出現 160px 高的子圖，包含：

| 元素 | 說明 |
|------|------|
| 綠色直方條 | force_ratio ≥ 0.5（多方主導）|
| 紅色直方條 | force_ratio < 0.5（空方主導）|
| 黃色折線 | 位移效率（接近 1 = 有方向性推進，接近 0 = 橫盤震盪）|
| 虛線 0.4 / 0.6 | 多空判斷閾值 |
| 實線 0.5 | 中性基準線 |

子圖**不可獨立捲動**，完全跟隨主圖的時間範圍（用 ref 驅動，不走 React state，不會影響效能）。

---

### 5. 橫盤偵測（「橫盤」按鈕）

主圖上用虛線框標示整理區間：
- **藍色**：已完成的整理區間
- **黃色**：目前正在進行的整理區間（最新一段）
- 上下兩條虛線 = 該區間的最高價 / 最低價

**偵測邏輯**（`backend/routes/ranges.py`）：
對每一根 K 線計算滾動 20 根的「位移效率」，位移效率 < 0.3 且持續 ≥ 10 根，就視為一段整理區間。

---

## 關鍵指標說明

詳細定義見 `glossary.md`，這裡只記重點：

| 指標 | 範圍 | 判斷 |
|------|------|------|
| `force_ratio` | 0~1 | > 0.6 多方主導，< 0.4 空方主導 |
| `count_ratio` | 0~1 | 陽線頻率，搭配 force_ratio 解讀 |
| `quality_ratio` | 0~∞ | > 1 多方每次出手比空方強 |
| `displacement_efficiency` | 0~1 | > 0.7 趨勢推進，< 0.3 橫盤震盪 |
| `body_ratio` | 0~1 | > 0.65 飽滿 K，< 0.35 虛弱 K |
| `displacement` | 0~∞ | 實體長度 / ATR，> 0.8 力道強勁 |

---

## 踩過的坑（避免重蹈覆轍）

### 圖表打開看不到 K 線
K 線資料時間是舊的（例如到 2026-02），但 lightweight-charts 預設顯示當前時間（2026-04），所以右側全是空白。  
**解法**：用頂部的「跳轉」輸入你知道有資料的日期。

### 資料庫路徑
`D:\AI_Projects\Trading\crypto_data.db`（正確）  
`D:\AI_Projects\Trading\script\coin\crypto_data.db`（空的，45KB，是舊的測試資料庫）

### Port 8000 被佔用
```powershell
Get-NetTCPConnection -LocalPort 8000 | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
```

### 波段用虛線不清楚
早期版本波段高低點用水平虛線延伸全圖，看不出具體在哪根 K 線。  
**現在改成**：直接在 K 棒上下畫圓圈標記，有效用實心大圓，無效用半透明小圓。

### lightweight-charts `ISeriesPriceLine` 不能直接 import
```typescript
// 不能這樣
import type { ISeriesPriceLine } from 'lightweight-charts';

// 要這樣
type PriceLineHandle = ReturnType<ISeriesApi<'Candlestick'>['createPriceLine']>;
```

### 子圖同步不用 React state
如果把 `visibleRange` 放進 React state，每次捲圖就會觸發 re-render，造成明顯卡頓。  
**做法**：App 持有一個 `subChartSetRangeRef`，Chart 在時間軸變動時直接呼叫 `subChartSetRangeRef.current?.(from, to)`，完全繞過 React 更新機制。

---

## API 一覽

後端啟動後可在 `http://localhost:8000/docs` 查看 Swagger 文件。

| 端點 | 說明 |
|------|------|
| GET `/api/symbols` | 取得所有交易對清單 |
| GET `/api/klines` | 取得 K 線資料（支援分頁） |
| POST `/api/indicators/candle` | 單根 K 線指標（ATR、body_ratio、displacement 等） |
| POST `/api/indicators/range` | 區間力道分析（force_ratio、count_ratio 等） |
| GET `/api/indicators/series` | 滾動力道 + 位移效率時間序列（供子圖使用） |
| GET `/api/marks` | 查詢標記 |
| POST `/api/marks` | 新增標記 |
| DELETE `/api/marks/:id` | 刪除標記 |
| PATCH `/api/marks/:id` | 修改標記備注 |
| GET `/api/swings` | 自動偵測波段高低點 |
| GET `/api/ranges` | 偵測橫盤整理區間 |
