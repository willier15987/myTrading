def atr(candles: list[dict], period: int = 14) -> float:
    """
    Calculate Average True Range (simple moving average of True Range).

    candles: list of dicts with keys: open, high, low, close
    period:  ATR period (default 14)
    """
    if len(candles) < 2:
        return 0.0

    true_ranges: list[float] = []
    for i in range(1, len(candles)):
        prev_close = candles[i - 1]["close"]
        high = candles[i]["high"]
        low = candles[i]["low"]
        tr = max(high - low, abs(high - prev_close), abs(low - prev_close))
        true_ranges.append(tr)

    if not true_ranges:
        return 0.0

    recent = true_ranges[-period:] if len(true_ranges) >= period else true_ranges
    return sum(recent) / len(recent)
