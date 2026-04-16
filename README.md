# 交易分析標記工具 — 使用手冊

TradingView 風格 K 線工具，用於校準量化交易框架參數、人工標記進出場、以及回放歷史行情做策略驗證。

---

## 目錄

1. [安裝](#安裝)
2. [日常啟動](#日常啟動)
3. [功能概覽](#功能概覽)
4. [操作指南](#操作指南)
5. [快捷鍵](#快捷鍵)
6. [修改資料庫路徑](#修改資料庫路徑)
7. [常見問題](#常見問題)
8. [專案結構](#專案結構)

---

## 安裝

> 只需要做一次。之後直接看「日常啟動」。

**後端**
```bash
cd trading/
pip install -r backend/requirements.txt
```

**前端**
```bash
cd trading/frontend/
npm install
```

---

## 日常啟動

需要**同時開啟兩個終端機**。

**終端機 1 — 後端**
```bash
cd trading/
python run.py
```
出現 `Uvicorn running on http://127.0.0.1:8000` 代表成功。

**終端機 2 — 前端**
```bash
cd trading/frontend/
npm run dev
```
出現 `Local: http://localhost:5173/` 代表成功。

開啟瀏覽器前往 **http://localhost:5173**

> 兩個終端機都必須保持開著。

---

## 功能概覽

### 主圖

| 功能 | 說明 |
|------|------|
| 交易對搜尋 | 工具列左側輸入框，即時篩選 |
| 時間週期 | 15m / 1h / 4h / 1d |
| 日期跳轉 | 輸入日期時間，圖表自動捲到該位置 |
| 自動更新 | 每 30 秒更新最新 K 線（可關閉；回放模式自動停用） |
| 時區切換 | 本地時間 / UTC / Asia/Taipei |

### 技術指標

| 功能 | 說明 |
|------|------|
| 波段偵測 | 自動標記高低點（可調 N、推進/反轉門檻、ATR 倍數） |
| 均線 | SMA / EMA，長度逗號分隔可輸入多條，各條配色自動分配 |
| TD Sequential | 標準買賣訊號，可調比對根數與 Setup 長度 |
| 橫盤整理 | 自動偵測並標記最近 12 個整理區間 |
| 力道子圖 | `force_ratio` 直方圖 + `displacement_efficiency` 折線（可顯示/隱藏） |

### 標記系統

| 類型 | 快捷鍵 | 圖示 |
|------|--------|------|
| 多方主導 | `1` | 綠色向上箭頭（K 線下方） |
| 空方主導 | `2` | 紅色向下箭頭（K 線上方） |
| 力道轉換 | `3` | 黃色圓點 |
| 有效前高 | `H` | 紅色方塊 + 水平虛線 |
| 有效前低 | `L` | 綠色方塊 + 水平虛線 |

### 倉位工具（TradingView 風格）

- **放置**：點工具列「放多 / 放空」→ 游標變十字線 → 點任一 K 線，以十字線 Y 座標為 entry 價格 → 跳出 Modal 確認 R/R 與進場理由
- **視覺化**：彩色填充盈虧帶（entry → TP 綠色 / entry → SL 紅色）；右軸顯示即時 PnL %
- **拖曳調整**：
  - 任意拖曳 Entry / TP / SL 線（整條線都可拖，不限右側 pill）
  - 拖曳左側時間把手（方形 grip）← 橫向吸附最近 K 線，調整 entry_ts
- **平倉**：側欄「平倉」按鈕，預帶已選 K 線的時間和收盤價（可手動改）
- **持久化**：倉位存在 `localStorage`，重整頁面不會消失
- **P / O 快捷鍵**：使用已選中 K 線直接開 modal（不用放置模式）

### 回放模式

模擬歷史行情逐根播放，用於策略驗證。

- 設定起始時間 → 點「開始」→ 自動載入暖機 K 線並跳到起點
- 播放 / 暫停 / 逐根步進（前進/後退）
- 播放速度：1x / 2x / 4x / 8x
- 回放期間可正常使用**標記系統**與**倉位工具**（資料不影響 live 模式）
- 自動更新在回放模式自動停用

---

## 操作指南

### 基本互動

| 動作 | 說明 |
|------|------|
| 滾輪 | 縮放 |
| 左鍵拖曳 | 平移 |
| 點擊 K 線 | 選中，右側面板顯示指標與標記按鈕 |
| Shift + 點擊 | 設定區間起點；再次 Shift+點擊設定終點（顯示區間分析） |
| ESC | 取消選擇 / 取消倉位放置模式 |
| ← → | 移動選中 K 線（無選擇時從最新 K 線開始） |

### 倉位放置流程

```
工具列「放多」或「放空」
  → 游標變十字線，圖表頂部出現提示橫幅
  → 在目標 K 線上點擊（時間取 K 線，價格取十字線 Y 座標）
  → Modal 開啟，預填 Entry / TP(+1%) / SL(-1%)
  → 調整數值、填寫進場理由 → 開倉
  → 圖表顯示填色倉位框，右軸顯示即時 PnL %
  → 拖曳任意線段微調
```

### 回放流程

```
工具列最右側「回放」區塊
  → 輸入起始時間（或點選 K 線後直接開始，用 selectedCandle 為起點）
  → 點「開始」→ 載入資料後自動跳至起點
  → 播放 / 暫停 / 逐根步進
  → 可正常標記和開倉（回放內獨立資料）
  → 點「結束」離開回放，回到即時模式
```

---

## 快捷鍵

### 一般模式

| 鍵 | 說明 |
|----|------|
| `←` `→` | 移動選中 K 線 |
| `1` | 標記多方主導 |
| `2` | 標記空方主導 |
| `3` | 標記力道轉換 |
| `H` | 標記有效前高（取 K 線高點價格） |
| `L` | 標記有效前低（取 K 線低點價格） |
| `Delete` | 刪除選中 K 線的所有標記 |
| `P` | 以選中 K 線開多頭 Modal |
| `O` | 以選中 K 線開空頭 Modal |
| `ESC` | 取消選擇 / 取消放置模式 |

### 回放模式

| 鍵 | 說明 |
|----|------|
| `Space` | 播放 / 暫停（待實作，見 BACKLOG） |
| `]` | 步進下一根（待實作） |
| `[` | 步進上一根（待實作） |

---

## 修改資料庫路徑

### K 線資料庫

**`backend/db.py` 第 4 行**
```python
CRYPTO_DB_PATH = r"D:\你的路徑\crypto_data.db"
```

### 標記資料庫

同檔案第 5 行（預設自動建立於 `data/marks.db`）：
```python
MARKS_DB_PATH = Path(r"D:\你想要的路徑\marks.db")
```

> 路徑前的 `r` 不能拿掉（Windows 反斜線跳脫）。修改後重啟後端即可。

---

## 常見問題

### 後端「port 8000 already in use」

```powershell
powershell -Command "Get-NetTCPConnection -LocalPort 8000 | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }"
```

然後重啟後端。

### 圖表打開後看不到 K 線

K 線資料可能較舊，瀏覽器顯示的是現在時間。
解法：用頂部**日期跳轉**輸入框輸入有資料的日期，圖表就會跳過去。

### 資料庫更新後前端沒有反映

重新整理瀏覽器（F5）即可。後端每次請求都直接查資料庫，不做快取。

### 前端顯示「Cannot find package.json」

確認是在 `frontend/` 目錄下執行 `npm run dev`：
```bash
cd trading/frontend/
npm run dev
```

---

## 專案結構

```
trading/
├── backend/
│   ├── main.py              ← FastAPI 入口
│   ├── db.py                ← 資料庫路徑設定
│   ├── core/                ← 量化計算（ATR、force_ratio、波段偵測等）
│   └── routes/              ← API 端點（klines、marks、swings、ranges、indicators）
├── frontend/
│   └── src/
│       ├── App.tsx           ← 主應用程式（狀態管理、回放邏輯）
│       ├── components/
│       │   ├── Chart.tsx               ← 主圖（lightweight-charts v5）
│       │   ├── SubChart.tsx            ← 力道子圖
│       │   ├── Toolbar.tsx             ← 工具列（含回放控制區）
│       │   ├── MarkPanel.tsx           ← 右側標記面板
│       │   ├── PositionPanel.tsx       ← 右側倉位面板
│       │   ├── PositionFormModal.tsx   ← 開倉/平倉 Modal
│       │   ├── position-primitive.ts   ← TradingView 風格倉位 Primitive
│       │   └── selected-candle-primitive.ts
│       ├── replay/
│       │   └── types.ts     ← 回放狀態型別
│       ├── utils/
│       │   ├── positions.ts ← PnL 計算工具
│       │   ├── time.ts      ← 時區格式化工具
│       │   └── useLocalStorage.ts
│       ├── api/             ← 後端 API 客戶端
│       └── types.ts         ← 共用型別定義
├── data/
│   └── marks.db             ← 標記資料（自動建立）
├── BACKLOG.md               ← 待辦與改善清單
└── run.py                   ← 啟動腳本
```

## API 文件

後端啟動後：**http://localhost:8000/docs**
