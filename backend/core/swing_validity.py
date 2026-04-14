"""
Swing High / Swing Low validity checks.
framework §5
"""
from .force_analysis import force_analysis


def find_pivots(candles: list[dict], pivot_n: int = 5) -> list[tuple[str, int]]:
    """
    Find geometric pivot highs and lows using a symmetric window.

    A candle is a pivot high  if its high  is strictly greater than all
    highs within pivot_n bars on each side.
    A candle is a pivot low   if its low   is strictly less    than all
    lows  within pivot_n bars on each side.

    Returns list of ('high'|'low', candle_index) sorted by index.
    """
    pivots: list[tuple[str, int]] = []
    n = len(candles)

    for i in range(pivot_n, n - pivot_n):
        h = candles[i]['high']
        l = candles[i]['low']

        is_high = (
            all(h > candles[i - j]['high'] for j in range(1, pivot_n + 1))
            and all(h > candles[i + j]['high'] for j in range(1, pivot_n + 1))
        )
        is_low = (
            all(l < candles[i - j]['low'] for j in range(1, pivot_n + 1))
            and all(l < candles[i + j]['low'] for j in range(1, pivot_n + 1))
        )

        if is_high:
            pivots.append(('high', i))
        if is_low:
            pivots.append(('low', i))

    return pivots


def is_valid_swing_high(candles: list[dict], pivot_index: int, atr: float, params: dict | None = None) -> tuple[bool, dict]:
    """
    Verify a geometric local high is a valid Swing High.
    framework §5.2
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

    approach_candles = candles[pivot_index - lb: pivot_index]
    approach_force = force_analysis(approach_candles, atr)
    condition_1 = approach_force["force_ratio"] > params["min_approach_quality"]

    rejection_candles = candles[pivot_index + 1: pivot_index + 1 + lf]
    rejection_force = force_analysis(rejection_candles, atr)
    condition_2 = rejection_force["force_ratio"] < (1 - params["min_rejection_force"])

    pivot_high = candles[pivot_index]["high"]
    lowest_after = min(c["low"] for c in rejection_candles)
    departure = pivot_high - lowest_after
    condition_3 = departure > atr * params["min_departure_atr"]

    details = {
        "approach_force_ratio": approach_force["force_ratio"],
        "rejection_force_ratio": rejection_force["force_ratio"],
        "departure_atr_multiple": round(departure / atr, 4) if atr > 0 else 0,
        "conditions": [condition_1, condition_2, condition_3],
    }

    return all([condition_1, condition_2, condition_3]), details


def is_valid_swing_low(candles: list[dict], pivot_index: int, atr: float, params: dict | None = None) -> tuple[bool, dict]:
    """
    Verify a geometric local low is a valid Swing Low.
    framework §5.3
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

    approach_candles = candles[pivot_index - lb: pivot_index]
    approach_force = force_analysis(approach_candles, atr)
    condition_1 = approach_force["force_ratio"] < (1 - params["min_approach_quality"])

    rejection_candles = candles[pivot_index + 1: pivot_index + 1 + lf]
    rejection_force = force_analysis(rejection_candles, atr)
    condition_2 = rejection_force["force_ratio"] > params["min_rejection_force"]

    pivot_low = candles[pivot_index]["low"]
    highest_after = max(c["high"] for c in rejection_candles)
    departure = highest_after - pivot_low
    condition_3 = departure > atr * params["min_departure_atr"]

    details = {
        "approach_force_ratio": approach_force["force_ratio"],
        "rejection_force_ratio": rejection_force["force_ratio"],
        "departure_atr_multiple": round(departure / atr, 4) if atr > 0 else 0,
        "conditions": [condition_1, condition_2, condition_3],
    }

    return all([condition_1, condition_2, condition_3]), details
