def candle_quality(candle: dict, atr_value: float) -> dict:
    """
    Calculate single candle quality metrics.
    framework §2.1

    candle:    dict with keys open, high, low, close
    atr_value: pre-calculated ATR
    """
    o = candle["open"]
    h = candle["high"]
    l = candle["low"]
    c = candle["close"]

    body = abs(c - o)
    total_range = h - l

    if total_range == 0:
        return {
            "body_ratio": 0.0,
            "displacement": 0.0,
            "direction": 0,
            "body": 0.0,
            "range": 0.0,
        }

    body_ratio = body / total_range
    displacement = body / atr_value if atr_value > 0 else 0.0
    direction = 1 if c > o else (-1 if c < o else 0)

    return {
        "body_ratio": round(body_ratio, 4),
        "displacement": round(displacement, 4),
        "direction": direction,
        "body": round(body, 4),
        "range": round(total_range, 4),
    }
