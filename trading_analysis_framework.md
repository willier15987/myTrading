# 交易分析框架：多空力道量化與有效結構辨識

> 本文件整理了完整的交易分析量化框架，目標是將人類交易直覺翻譯成可程式執行的邏輯。

---

## 一、核心理念

交易的本質是判斷**多空雙方誰在當前時間點擁有主導權**，以及這個主導權是否正在發生轉換。

關鍵認知：
- 多空力量是時刻變化的，上一根 K 線多方主導，下一根可能就被翻轉
- 量化的目標不是複製人眼，而是**萃取人眼判斷時真正依賴的特徵**
- 不追求 100% 正確判定，而是追求統計上有意義的勝率和盈虧比

---

## 二、K 線品質量化

### 2.1 單根 K 線品質

```python
def candle_quality(open, high, low, close, atr):
    """
    計算單根 K 線的品質指標
    """
    body = abs(close - open)
    total_range = high - low

    if total_range == 0:
        return {"body_ratio": 0, "displacement": 0, "direction": 0}

    # 實體比例：實體佔整根 K 線的比例
    # > 0.6-0.7 代表飽滿，影線少
    body_ratio = body / total_range

    # 方向位移：實體相對於 ATR 的大小
    # > 0.8 代表這根 K 線走了接近一整個 ATR 的有效距離
    displacement = body / atr if atr > 0 else 0

    # 方向：1 = 陽線, -1 = 陰線, 0 = 十字線
    direction = 1 if close > open else (-1 if close < open else 0)

    return {
        "body_ratio": body_ratio,
        "displacement": displacement,
        "direction": direction,
        "body": body,
        "range": total_range
    }
```

### 2.2 品質判斷標準

| 指標 | 強勢 K 線 | 弱勢 K 線 |
|------|-----------|-----------|
| 實體比例 (body_ratio) | > 0.65 | < 0.35 |
| 方向位移 (displacement) | > 0.8 ATR | < 0.3 ATR |
| 綜合判斷 | 大實體、短影線 | 小實體、長影線或十字線 |

---

## 三、多空力道分析

### 3.1 平均力道對比

不使用單純的實體加總，而是**除以 K 線數量**來反映真正的單次出力強度。

```python
def force_analysis(candles, atr):
    """
    計算一段 K 線內的多空力道對比

    candles: list of dict, 每根 K 線包含 open, high, low, close
    atr: 當前 ATR 值
    """
    bull_bodies = []  # 陽線實體
    bear_bodies = []  # 陰線實體

    for c in candles:
        body = abs(c['close'] - c['open'])
        if c['close'] > c['open']:
            bull_bodies.append(body)
        elif c['close'] < c['open']:
            bear_bodies.append(body)
        # 十字線忽略不計

    bull_count = len(bull_bodies)
    bear_count = len(bear_bodies)
    total_count = bull_count + bear_count

    # 平均力道
    bull_avg = sum(bull_bodies) / bull_count if bull_count > 0 else 0
    bear_avg = sum(bear_bodies) / bear_count if bear_count > 0 else 0

    # 力道比（0~1，> 0.5 多方優勢，< 0.5 空方優勢）
    total_avg = bull_avg + bear_avg
    force_ratio = bull_avg / total_avg if total_avg > 0 else 0.5

    # 數量優勢
    count_ratio = bull_count / total_count if total_count > 0 else 0.5

    # 品質優勢
    quality_ratio = bull_avg / bear_avg if bear_avg > 0 else float('inf')

    return {
        "bull_avg_force": bull_avg,
        "bear_avg_force": bear_avg,
        "force_ratio": force_ratio,       # > 0.6 多方主導, < 0.4 空方主導
        "count_ratio": count_ratio,        # 多方出現頻率
        "quality_ratio": quality_ratio,    # > 1 多方單次更強, < 1 空方單次更強
    }
```

### 3.2 四象限判斷模型

根據「數量優勢」與「品質優勢」的組合來判斷市場狀態：

```
                    品質優勢高（多方單次力道大）
                           |
      多方蓄力型            |          多方明確主導
   （出手少但每次都強）      |       （又多又強）
                           |
  ─────────────────────────┼─────────────────────── 數量優勢高
                           |
      空方明確主導           |          多方虛張聲勢
   （又少又弱）             |      （次數多但每次都弱）
                           |                → 派發特徵
                    品質優勢低
```

### 3.3 力道變化追蹤

除了當下的力道，更重要的是力道的**變化方向**：

```python
def force_shift(current_force_ratio, previous_force_ratio):
    """
    判斷力道是否正在轉換

    兩組連續的 K 線段分別計算 force_ratio 後比較
    """
    shift = current_force_ratio - previous_force_ratio

    if shift > 0.15:
        return "多方正在接管"
    elif shift < -0.15:
        return "空方正在接管"
    else:
        return "局面未明顯改變"
```

---

## 四、位移效率

衡量一段走勢的方向性，區分「有效推進」和「來回拉鋸」。

```python
def displacement_efficiency(candles):
    """
    位移效率 = 淨位移 / 總路徑

    接近 1 → 非常有方向性，幾乎沒有來回
    接近 0 → 走了很多路但沒有淨位移
    """
    if len(candles) < 2:
        return 0

    net_displacement = abs(candles[-1]['close'] - candles[0]['open'])
    total_path = sum(c['high'] - c['low'] for c in candles)

    return net_displacement / total_path if total_path > 0 else 0
```

---

## 五、有效 Swing High / Swing Low 判定

### 5.1 傳統方法的不足

傳統 Pivot 定義（前後 N 根取局部極值）只是幾何篩選，不代表市場意義上的「有效」。有效性應該回到力量轉換：**多方在那裡嘗試了，但被空方拒絕了（反之亦然）**。

### 5.2 有效 Swing High 的三個驗證條件

```python
def is_valid_swing_high(candles, pivot_index, atr, params=None):
    """
    驗證一個幾何上的局部高點是否為有效 Swing High

    三個條件都必須滿足：
    1. 推進段品質：到達高點之前，多方有實際的推進力道
    2. 力量轉換：高點之後，空方展現了主導權
    3. 離場幅度：價格從高點產生了有意義的位移
    """
    if params is None:
        params = {
            "lookback": 5,              # 推進段回看根數
            "lookforward": 5,           # 轉換段前看根數
            "min_approach_quality": 0.5, # 推進段最低品質要求
            "min_rejection_force": 0.55, # 空方力道比最低要求
            "min_departure_atr": 0.5,   # 最低離場幅度（ATR 倍數）
        }

    lb = params["lookback"]
    lf = params["lookforward"]

    # 確保有足夠的前後數據
    if pivot_index < lb or pivot_index + lf >= len(candles):
        return False, {}

    # --- 條件 1：推進段品質 ---
    approach_candles = candles[pivot_index - lb : pivot_index]
    approach_force = force_analysis(approach_candles, atr)
    # 多方在到達高點前必須有實際力道，不是飄上來的
    condition_1 = approach_force["force_ratio"] > params["min_approach_quality"]

    # --- 條件 2：力量轉換 ---
    rejection_candles = candles[pivot_index + 1 : pivot_index + 1 + lf]
    rejection_force = force_analysis(rejection_candles, atr)
    # 高點之後空方必須展現主導權
    # force_ratio < 0.45 代表空方平均力道 > 多方平均力道
    condition_2 = rejection_force["force_ratio"] < (1 - params["min_rejection_force"])

    # --- 條件 3：離場幅度 ---
    pivot_high = candles[pivot_index]['high']
    lowest_after = min(c['low'] for c in rejection_candles)
    departure = pivot_high - lowest_after
    condition_3 = departure > atr * params["min_departure_atr"]

    details = {
        "approach_force_ratio": approach_force["force_ratio"],
        "rejection_force_ratio": rejection_force["force_ratio"],
        "departure_atr_multiple": departure / atr if atr > 0 else 0,
        "conditions": [condition_1, condition_2, condition_3]
    }

    return all([condition_1, condition_2, condition_3]), details
```

### 5.3 有效 Swing Low（對稱邏輯）

```python
def is_valid_swing_low(candles, pivot_index, atr, params=None):
    """
    與 Swing High 完全對稱
    """
    if params is None:
        params = {
            "lookback": 5,
            "lookforward": 5,
            "min_approach_quality": 0.5,
            "min_rejection_force": 0.55,
            "min_departure_atr": 0.5,
        }

    lb = params["lookback"]
    lf = params["lookforward"]

    if pivot_index < lb or pivot_index + lf >= len(candles):
        return False, {}

    # --- 條件 1：推進段品質（空方推進到低點）---
    approach_candles = candles[pivot_index - lb : pivot_index]
    approach_force = force_analysis(approach_candles, atr)
    # 空方在到達低點前必須有實際力道
    condition_1 = approach_force["force_ratio"] < (1 - params["min_approach_quality"])

    # --- 條件 2：力量轉換（多方接管）---
    rejection_candles = candles[pivot_index + 1 : pivot_index + 1 + lf]
    rejection_force = force_analysis(rejection_candles, atr)
    # 低點之後多方必須展現主導權
    condition_2 = rejection_force["force_ratio"] > params["min_rejection_force"]

    # --- 條件 3：離場幅度 ---
    pivot_low = candles[pivot_index]['low']
    highest_after = max(c['high'] for c in rejection_candles)
    departure = highest_after - pivot_low
    condition_3 = departure > atr * params["min_departure_atr"]

    details = {
        "approach_force_ratio": approach_force["force_ratio"],
        "rejection_force_ratio": rejection_force["force_ratio"],
        "departure_atr_multiple": departure / atr if atr > 0 else 0,
        "conditions": [condition_1, condition_2, condition_3]
    }

    return all([condition_1, condition_2, condition_3]), details
```

---

## 六、多時間框架分析

### 6.1 高點結構在小時框的展開分類

大時框出現 Pivot High 時，切入小時框檢查內部結構：

```python
def classify_swing_structure(small_tf_candles, swing_high_price, atr):
    """
    將大時框的 Swing High 在小時框中分類

    small_tf_candles: 大時框該根 K 棒對應的小時框 K 線
    swing_high_price: 高點價格
    atr: 小時框的 ATR
    """
    near_high_threshold = atr * 0.3
    candles_near_high = [
        c for c in small_tf_candles
        if c['high'] >= swing_high_price - near_high_threshold
    ]

    count_near_high = len(candles_near_high)
    total_candles = len(small_tf_candles)

    # 在高點附近停留的比例
    dwell_ratio = count_near_high / total_candles if total_candles > 0 else 0

    # 檢查是否有反轉 K 線結構
    has_reversal = False
    for i in range(1, len(small_tf_candles)):
        prev = small_tf_candles[i-1]
        curr = small_tf_candles[i]
        # 簡化的吞噬判斷
        if (prev['close'] > prev['open'] and  # 前一根陽線
            curr['close'] < curr['open'] and    # 當前陰線
            curr['close'] < prev['open'] and    # 收盤低於前根開盤
            abs(curr['close'] - curr['open']) > abs(prev['close'] - prev['open'])):
            has_reversal = True
            break

    if has_reversal:
        structure_type = "reversal"      # 反轉型，有效性最高
    elif dwell_ratio > 0.3:
        structure_type = "consolidation"  # 停留型，有效性中等
    else:
        structure_type = "spike"          # 插針型，有效性最低

    return {
        "type": structure_type,
        "dwell_ratio": dwell_ratio,
        "has_reversal_pattern": has_reversal,
        "candles_near_high": count_near_high,
        # 有效性權重
        "validity_weight": {
            "reversal": 1.0,
            "consolidation": 0.6,
            "spike": 0.3
        }[structure_type]
    }
```

---

## 七、動態窗口：以有效 Swing Point 分段

### 7.1 核心概念

不使用固定根數窗口，而是讓市場的結構轉折自然切分段落。每兩個相鄰的有效 Swing Point 之間就是一個市場段落。

```python
def segment_by_swings(candles, valid_swing_indices):
    """
    用有效 Swing Point 將 K 線序列切成自然段落

    valid_swing_indices: 已驗證的有效 Swing High/Low 的 index 列表（已排序）
    """
    segments = []

    for i in range(len(valid_swing_indices) - 1):
        start = valid_swing_indices[i]
        end = valid_swing_indices[i + 1]
        segment_candles = candles[start:end + 1]

        segments.append({
            "start_index": start,
            "end_index": end,
            "length": end - start + 1,
            "candles": segment_candles
        })

    # 最後一個 swing point 到當前的「進行中」段落
    if valid_swing_indices:
        last_swing = valid_swing_indices[-1]
        if last_swing < len(candles) - 1:
            segments.append({
                "start_index": last_swing,
                "end_index": len(candles) - 1,
                "length": len(candles) - last_swing,
                "candles": candles[last_swing:],
                "is_current": True  # 標記為進行中的段落
            })

    return segments
```

### 7.2 多窗口交叉驗證（備選方案）

如果有效 Swing Point 還未建立完整，可以先用多窗口交叉驗證作為過渡：

```python
def multi_window_force(candles, atr, windows=[8, 15, 30]):
    """
    同時計算多個窗口的力道，觀察一致性
    """
    results = {}

    for w in windows:
        if len(candles) < w:
            continue
        recent = candles[-w:]
        fa = force_analysis(recent, atr)
        results[f"window_{w}"] = fa

    # 判斷一致性
    force_ratios = [r["force_ratio"] for r in results.values()]

    if all(fr > 0.6 for fr in force_ratios):
        consensus = "多方全面主導"
    elif all(fr < 0.4 for fr in force_ratios):
        consensus = "空方全面主導"
    elif force_ratios[0] > 0.6 and force_ratios[-1] < 0.4:
        consensus = "短線多方反彈但大結構偏空"
    elif force_ratios[0] < 0.4 and force_ratios[-1] > 0.6:
        consensus = "短線空方回調但大結構偏多"
    else:
        consensus = "多空膠著"

    results["consensus"] = consensus
    return results
```

---

## 八、交易區間判定

### 8.1 複合條件判定

```python
def is_trading_range(candles, atr, adx_value, bb_bandwidth_percentile):
    """
    判斷當前是否處於交易區間

    至少滿足 2-3 項條件
    """
    conditions = []

    # 條件 1：ADX 低於閾值（無趨勢）
    conditions.append(adx_value < 25)

    # 條件 2：布林帶寬處於低位
    conditions.append(bb_bandwidth_percentile < 30)

    # 條件 3：存在多個相近的 Swing High 和 Swing Low
    # （需要先跑 pivot 檢測和聚類）

    # 條件 4：位移效率低
    efficiency = displacement_efficiency(candles[-20:])
    conditions.append(efficiency < 0.3)

    score = sum(conditions)
    return {
        "is_range": score >= 2,
        "confidence": score / len(conditions),
        "conditions_met": conditions
    }
```

### 8.2 區間上下界定義

使用「價位帶」而非單一價格線，寬度約為 ATR * 0.3~0.5：

```python
def define_range_boundaries(swing_highs, swing_lows, atr):
    """
    定義區間的上下邊界帶
    """
    tolerance = atr * 0.4

    upper_band = {
        "center": sum(swing_highs) / len(swing_highs),
        "upper": max(swing_highs) + tolerance * 0.5,
        "lower": min(swing_highs) - tolerance * 0.5,
    }

    lower_band = {
        "center": sum(swing_lows) / len(swing_lows),
        "upper": max(swing_lows) + tolerance * 0.5,
        "lower": min(swing_lows) - tolerance * 0.5,
    }

    range_width = upper_band["center"] - lower_band["center"]

    return {
        "upper_band": upper_band,
        "lower_band": lower_band,
        "range_width": range_width,
        "range_width_atr": range_width / atr if atr > 0 else 0,
        # 區間寬度至少要 1.5 ATR 以上才有交易價值
        "is_tradeable": range_width > atr * 1.5
    }
```

---

## 九、Swing Point 有效性評分模型

### 9.1 綜合評分

將所有維度整合成單一分數：

```python
def swing_validity_score(
    structural_strength,    # 0~1, 結構強度（N值與突出幅度）
    candle_quality_score,   # 0~1, 反轉 K 線的品質
    test_count,             # 被測試次數
    rejection_rate,         # 測試後被壓回的比例
    time_decay_weight,      # 0~1, 時間衰減
    mtf_confirmation,       # bool, 多時間框架確認
    weights=None
):
    """
    綜合評分模型
    """
    if weights is None:
        weights = {
            "structure": 0.20,
            "candle_quality": 0.25,
            "test_rejection": 0.25,
            "time_decay": 0.15,
            "mtf": 0.15,
        }

    test_score = min(test_count / 3, 1.0) * rejection_rate

    score = (
        weights["structure"] * structural_strength
        + weights["candle_quality"] * candle_quality_score
        + weights["test_rejection"] * test_score
        + weights["time_decay"] * time_decay_weight
        + weights["mtf"] * (1.0 if mtf_confirmation else 0.0)
    )

    return {
        "total_score": score,
        "is_valid": score > 0.5,    # 閾值可調
        "breakdown": {
            "structure": structural_strength,
            "candle_quality": candle_quality_score,
            "test_rejection": test_score,
            "time_decay": time_decay_weight,
            "mtf_confirmation": mtf_confirmation,
        }
    }
```

### 9.2 時間衰減函數

```python
def time_decay(bars_since_pivot, decay_constant=100):
    """
    越久以前的前高/前低，有效性逐漸降低

    decay_constant 根據交易週期調整：
    - 日線：60~120
    - 小時線：200~500
    - 分鐘線：500~1000
    """
    return 1.0 / (1.0 + bars_since_pivot / decay_constant)
```

---

## 十、逆向工程工具規格

### 10.1 目標

建立一個互動式工具，讓交易者可以：
1. 載入 K 線資料（幣安 CSV 格式）
2. 查看 TradingView 風格的 K 線圖
3. 手動標記「多方主導」「空方主導」「反轉點」等判斷
4. 自動計算標記點的各項量化指標數值
5. 統計分析，找出交易者直覺與哪些量化指標最吻合

### 10.2 幣安 CSV 資料格式（預期）

```
open_time, open, high, low, close, volume, close_time, ...
```

### 10.3 顯示需求

- TradingView 風格 K 線圖（互動式，可縮放、拖曳）
- K 線圖下方可疊加子圖：力道比、位移效率、ADX 等
- 點擊 K 線可標記，標記類型包含：
  - 多方主導開始
  - 空方主導開始
  - 力量轉換點
  - 有效前高
  - 有效前低
- 標記後自動顯示該點的各項指標數值

### 10.4 技術選型建議

- 前端：React + lightweight-charts（TradingView 開源圖表庫）
- 後端計算：Python（pandas, numpy）
- 資料格式：CSV → pandas DataFrame

---

## 十一、待調整的參數清單

以下參數需要根據具體市場和時間週期進行回測調整：

| 參數 | 說明 | 建議起始值 |
|------|------|-----------|
| pivot_N | Pivot 判定的左右確認根數 | 5 |
| body_ratio_threshold | K 線飽滿度閾值 | 0.65 |
| displacement_threshold | 位移閾值（ATR 倍數）| 0.8 |
| force_ratio_bull | 多方主導閾值 | 0.6 |
| force_ratio_bear | 空方主導閾值 | 0.4 |
| force_shift_threshold | 力道轉換幅度 | 0.15 |
| min_departure_atr | Swing Point 最低離場幅度 | 0.5 ATR |
| range_min_width | 區間最低寬度 | 1.5 ATR |
| time_decay_constant | 時間衰減常數 | 100（日線）|
| validity_score_threshold | 有效性分數門檻 | 0.5 |

---

## 十二、開發優先順序建議

1. **Phase 1**：K 線品質計算 + 多空力道分析（核心引擎）
2. **Phase 2**：有效 Swing Point 判定（結構識別）
3. **Phase 3**：動態窗口分段（自然段落切分）
4. **Phase 4**：TradingView 風格圖表 + 標記功能（逆向工程工具）
5. **Phase 5**：交易區間判定 + 區間邊界定義
6. **Phase 6**：多時間框架整合
7. **Phase 7**：綜合評分模型 + 回測驗證
