# AI Replay Review Guide

## Purpose

This document defines how replay trade records should be reviewed by AI in this project.
The goal is to evaluate each trade from objective market data and recorded trade facts, not from hindsight emotion or an assumed trading plan.

## Data Sources

The review should use these sources:

1. K-line database
   - Symbol
   - Interval
   - OHLCV before, during, and after the trade
   - Derived indicators already available in the project, such as ATR, ADX, force analysis, displacement efficiency, swings, and ranges

2. User replay record
   - Symbol
   - Interval
   - Entry time
   - Entry price
   - Take-profit price
   - Stop-loss price
   - Entry reason
   - Exit price
   - Exit time
   - Exit reason
   - Save/upload time
   - Direction: long or short
   - RR

3. Previous AI review records
   - Prior objective notes
   - Repeated strengths
   - Repeated weaknesses
   - Prior trade context summaries

## Required User Fields

The current Google Sheet fields are mostly sufficient. The minimum additional required field is:

- Interval: for example `15m`, `1h`, `4h`, or `1d`

Recommended but optional:

- Unique trade ID
- Timezone, if timestamps are not already normalized

## Excluded Judgement Criteria

The review must not judge the trade using these subjective or unreliable standards:

- Whether the trader followed the original plan
- Whether the trade was emotional
- Manually assigned mistake labels
- Post-trade conclusions as if they were known at entry
- Assumptions about the trader's intention beyond the recorded entry and exit reasons

These items may be stored as user notes in the future, but they should not be used as core scoring criteria.

## Objective Review Criteria

Each trade should be reviewed using objective market structure and trade outcome data.

### Entry Quality

Assess:

- Whether entry happened near a range edge, support/resistance, swing level, or middle of a range
- Whether entry followed a strong directional move or chased the late part of a move
- Whether nearby candles showed clear directional force or mixed/noisy movement
- Whether the trade direction aligned with short-term and higher-timeframe context when available
- Whether entry occurred before, during, or after a breakout/retest/reversal attempt

### Stop-Loss Quality

Assess:

- Whether SL was outside a meaningful structure level
- Whether SL was too close relative to ATR or recent volatility
- Whether SL sat inside normal candle noise
- Whether the risk distance was consistent with the entry setup

### Take-Profit Quality

Assess:

- Whether TP was near a realistic liquidity, swing, range, or trend target
- Whether TP was blocked by nearby structure
- Whether the planned RR was attractive but unrealistic in the local market context
- Whether TP matched the available momentum and volatility

### Exit Quality

Assess:

- Whether exit captured the main favorable move
- Whether exit was early relative to continuation after closing
- Whether exit was late after clear weakening or reversal
- Whether exit happened near a reasonable structure, range, or momentum change

### Outcome Metrics

Calculate when possible:

- Planned RR
- Realized R
- Realized PnL percentage
- Holding time
- MFE: maximum favorable excursion after entry
- MAE: maximum adverse excursion after entry
- MFE captured percentage
- Whether TP or SL was touched before manual exit

## Review Output Format

Each reviewed trade should produce a structured result:

```text
trade_id
review_time
symbol
interval
direction
entry_context
entry_strengths
entry_weaknesses
sl_assessment
tp_assessment
exit_assessment
objective_metrics
overall_summary
```

## Suggested AI Response Format

For a single trade:

1. Trade summary
2. What was good
3. What was weak
4. Objective metrics
5. One practical improvement for similar future trades

For multiple trades:

1. Aggregate metrics
2. Repeated strengths
3. Repeated weaknesses
4. Best-performing contexts
5. Worst-performing contexts
6. Specific examples from the reviewed trades

## Persistence Recommendation

Future implementation should persist AI reviews instead of relying on chat history.

Suggested storage fields:

```text
id
trade_id
review_time
review_version
input_snapshot_json
metrics_json
strengths_json
weaknesses_json
context_summary
created_at
```

The `input_snapshot_json` should preserve the trade record and the market context used at review time, so future reviews remain reproducible even if the database changes.

## Implementation Direction

The project should eventually support this workflow:

1. Import trade records from Google Sheet or CSV.
2. Match each trade to K-line data by symbol, interval, entry time, and exit time.
3. Compute objective metrics and market context.
4. Generate an AI review for each trade.
5. Store the review result in the project database.
6. Use stored reviews to identify repeated strengths and weaknesses across time.

