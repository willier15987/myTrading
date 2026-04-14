# 交易分析逆向工程工具 — 使用手冊

TradingView 風格 K 線標記工具，用於校準量化交易框架的參數。

---

## 目錄

1. [第一次使用（安裝）](#第一次使用安裝)
2. [日常啟動](#日常啟動)
3. [操作指南](#操作指南)
4. [修改資料庫位置](#修改資料庫位置)
5. [常見問題](#常見問題)

---

## 第一次使用（安裝）

> 只需要做一次。之後直接看「日常啟動」。

### 1. 安裝後端套件

```bash
cd d:/AI_Projects/myTrading
pip install -r backend/requirements.txt
```

### 2. 安裝前端套件

```bash
cd d:/AI_Projects/myTrading/frontend
npm install
```

---

## 日常啟動

每次使用都需要**同時開啟兩個終端機視窗**。

### 終端機 1 — 後端

```bash
cd d:/AI_Projects/myTrading
python run.py
```

看到以下訊息代表啟動成功：

```
INFO:     Uvicorn running on http://127.0.0.1:8000
INFO:     Application startup complete.
```

### 終端機 2 — 前端

```bash
cd d:/AI_Projects/myTrading/frontend
npm run dev
```

看到以下訊息代表啟動成功：

```
  VITE v5.x.x  ready in xxx ms
  ➜  Local:   http://localhost:5173/
```

### 開啟瀏覽器

前往 **http://localhost:5173**

> 兩個終端機都必須保持開著，關掉任何一個工具就會停止運作。

---

## 操作指南

### 基本操作

| 動作 | 說明 |
|------|------|
| 滾輪 | 縮放圖表 |
| 左鍵拖曳 | 左右平移 |
| 點擊 K 線 | 選中該根，右側面板顯示指標與標記按鈕 |
| Shift + 點擊 | 設定區間起點，再次 Shift+點擊設定終點，顯示區間力道分析 |
| ESC | 取消選擇 |

### 快捷鍵（需先點擊選中一根 K 線）

| 鍵 | 動作 |
|----|------|
| `1` | 標記「多方主導開始」|
| `2` | 標記「空方主導開始」|
| `3` | 標記「力道轉換點」|
| `H` | 標記「有效前高」|
| `L` | 標記「有效前低」|
| `Delete` | 刪除此 K 線的所有標記 |
| `ESC` | 取消選擇 |

### 標記說明

| 類型 | 顏色 | 圖示 |
|------|------|------|
| 多方主導 | 綠色 | K 線下方向上箭頭 |
| 空方主導 | 紅色 | K 線上方向下箭頭 |
| 力道轉換 | 黃色 | K 線下方圓點 |
| 有效前高 | 紅色 | K 線上方方塊 + 水平虛線 |
| 有效前低 | 綠色 | K 線下方方塊 + 水平虛線 |

---

## 修改資料庫位置

### K 線資料庫（你的歷史 K 線資料）

只需修改一個檔案：

**[backend/db.py](backend/db.py) 第 4 行**

```python
CRYPTO_DB_PATH = r"D:\AI_Projects\Trading\crypto_data.db"
```

改成你的實際路徑，例如：

```python
CRYPTO_DB_PATH = r"C:\Users\你的帳號\data\crypto_data.db"
```

> 注意：路徑前面的 `r` 不能拿掉，它是讓 Python 正確讀取 Windows 反斜線路徑用的。

### 標記資料庫（儲存你的標記紀錄）

同一個檔案的**第 5 行**：

```python
MARKS_DB_PATH = Path(__file__).parent.parent / "data" / "marks.db"
```

預設會自動建立在 `myTrading/data/marks.db`。如果要改位置：

```python
MARKS_DB_PATH = Path(r"D:\你想要的路徑\marks.db")
```

修改後重新啟動後端即可生效，不需要重裝任何東西。

---

## 常見問題

### 後端啟動時出現「port 8000 already in use」或「通訊端被拒絕」

Port 被上次的程序佔用，用以下指令清除：

```powershell
powershell -Command "Get-NetTCPConnection -LocalPort 8000 | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }"
```

然後重新啟動後端。

### 前端出現「npm error: Cannot find package.json」

你在錯誤的目錄執行了 `npm`，要切換到 `frontend/` 資料夾：

```bash
cd d:/AI_Projects/myTrading/frontend
npm run dev
```

### 圖表打開後看不到 K 線

通常是資料庫內的資料時間比較舊（例如資料到 2026-02，但瀏覽器顯示的是現在時間 2026-04）。  
解法：用頂部的**日期跳轉**輸入框，輸入你知道有資料的日期（例如 `2026-02-01`），圖表就會跳到有資料的位置。

### 資料庫更新後前端沒有反映

重新整理瀏覽器頁面（F5）即可，後端每次請求都直接查資料庫，不做快取。

---

## 專案結構（供參考）

```
myTrading/
├── backend/
│   ├── main.py          ← 後端入口，從這裡啟動
│   ├── db.py            ← 資料庫路徑設定在這裡
│   ├── core/            ← 量化計算模組（ATR、力道分析等）
│   └── routes/          ← API 端點
├── frontend/
│   └── src/             ← React 前端原始碼
├── data/
│   └── marks.db         ← 標記資料（自動建立）
└── README.md            ← 本文件
```

## API 文件

後端啟動後可在瀏覽器查看所有 API：**http://localhost:8000/docs**
