def adx_series(candles: list[dict], period: int = 14) -> list[dict]:
    """
    Compute ADX, +DI, -DI for every candle using Wilder smoothing.

    Returns a list of the same length as `candles`.
    Entries before sufficient warmup return zeros.
    candles: chronological list of dicts with keys: open, high, low, close
    """
    n = len(candles)
    out = [{"adx": 0.0, "plus_di": 0.0, "minus_di": 0.0} for _ in range(n)]

    if n < period + 1:
        return out

    # Raw TR, +DM, -DM — index j maps to candle[j+1]
    tr_raw: list[float] = []
    pdm_raw: list[float] = []
    mdm_raw: list[float] = []

    for i in range(1, n):
        h, l = candles[i]["high"], candles[i]["low"]
        ph, pl, pc = candles[i - 1]["high"], candles[i - 1]["low"], candles[i - 1]["close"]
        tr = max(h - l, abs(h - pc), abs(l - pc))
        up = h - ph
        dn = pl - l
        tr_raw.append(tr)
        pdm_raw.append(up if (up > dn and up > 0) else 0.0)
        mdm_raw.append(dn if (dn > up and dn > 0) else 0.0)

    m = len(tr_raw)  # = n - 1
    if m < period:
        return out

    # Wilder initialization: sum of first `period` raw values
    s_tr  = sum(tr_raw[:period])
    s_pdm = sum(pdm_raw[:period])
    s_mdm = sum(mdm_raw[:period])

    def _di_dx(s_tr_: float, s_pdm_: float, s_mdm_: float) -> tuple[float, float, float]:
        pdi = 100.0 * s_pdm_ / s_tr_ if s_tr_ > 0 else 0.0
        mdi = 100.0 * s_mdm_ / s_tr_ if s_tr_ > 0 else 0.0
        dsum = pdi + mdi
        dx = 100.0 * abs(pdi - mdi) / dsum if dsum > 0 else 0.0
        return pdi, mdi, dx

    # dx_values[j] and di_pairs[j] correspond to candle index (period + j)
    dx_values: list[float] = []
    di_pairs: list[tuple[float, float]] = []

    pdi, mdi, dx = _di_dx(s_tr, s_pdm, s_mdm)
    dx_values.append(dx)
    di_pairs.append((pdi, mdi))
    if period < n:
        out[period]["plus_di"]  = round(pdi, 2)
        out[period]["minus_di"] = round(mdi, 2)

    for j in range(1, m - period + 1):
        raw_idx = period - 1 + j
        s_tr  = s_tr  - s_tr  / period + tr_raw[raw_idx]
        s_pdm = s_pdm - s_pdm / period + pdm_raw[raw_idx]
        s_mdm = s_mdm - s_mdm / period + mdm_raw[raw_idx]
        pdi, mdi, dx = _di_dx(s_tr, s_pdm, s_mdm)
        dx_values.append(dx)
        di_pairs.append((pdi, mdi))
        ci = period + j
        if ci < n:
            out[ci]["plus_di"]  = round(pdi, 2)
            out[ci]["minus_di"] = round(mdi, 2)

    # ADX: Wilder-smooth DX over `period` values
    if len(dx_values) < period:
        return out

    adx_val = sum(dx_values[:period]) / period
    adx_ci = 2 * period - 1
    if adx_ci < n:
        out[adx_ci]["adx"] = round(adx_val, 2)

    for j in range(period, len(dx_values)):
        adx_val = (adx_val * (period - 1) + dx_values[j]) / period
        ci = period + j
        if ci < n:
            out[ci]["adx"] = round(adx_val, 2)

    return out


def adx_latest(candles: list[dict], period: int = 14) -> dict:
    """Return ADX, +DI, -DI for the most recent candle only."""
    series = adx_series(candles, period)
    if not series:
        return {"adx": 0.0, "plus_di": 0.0, "minus_di": 0.0}
    return series[-1]
