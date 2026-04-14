def force_analysis(candles: list[dict], atr: float) -> dict:
    """
    Calculate bull/bear force comparison across a candle window.
    framework §3.1

    candles: list of dicts with keys: open, high, low, close
    atr:     current ATR value (kept for API compatibility, not used in calc)
    """
    bull_bodies: list[float] = []
    bear_bodies: list[float] = []

    for c in candles:
        body = abs(c["close"] - c["open"])
        if c["close"] > c["open"]:
            bull_bodies.append(body)
        elif c["close"] < c["open"]:
            bear_bodies.append(body)
        # doji candles ignored

    bull_count = len(bull_bodies)
    bear_count = len(bear_bodies)
    total_count = bull_count + bear_count

    bull_avg = sum(bull_bodies) / bull_count if bull_count > 0 else 0.0
    bear_avg = sum(bear_bodies) / bear_count if bear_count > 0 else 0.0

    total_avg = bull_avg + bear_avg
    force_ratio = bull_avg / total_avg if total_avg > 0 else 0.5
    count_ratio = bull_count / total_count if total_count > 0 else 0.5

    if bear_avg > 0:
        quality_ratio = round(bull_avg / bear_avg, 4)
    else:
        quality_ratio = 9999.0  # infinity represented as large number

    return {
        "bull_avg_force": round(bull_avg, 4),
        "bear_avg_force": round(bear_avg, 4),
        "force_ratio": round(force_ratio, 4),
        "count_ratio": round(count_ratio, 4),
        "quality_ratio": quality_ratio,
        "bull_count": bull_count,
        "bear_count": bear_count,
    }
