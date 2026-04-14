def displacement_efficiency(candles: list[dict]) -> float:
    """
    Displacement efficiency = net displacement / total path.
    framework §4

    Close to 1 → strong directional move.
    Close to 0 → choppy, no net progress.
    """
    if len(candles) < 2:
        return 0.0

    net_displacement = abs(candles[-1]["close"] - candles[0]["open"])
    total_path = sum(c["high"] - c["low"] for c in candles)

    if total_path == 0:
        return 0.0

    return round(net_displacement / total_path, 4)
