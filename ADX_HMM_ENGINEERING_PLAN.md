# ADX / HMM Engineering Plan

## 1. Background

The current project already has a clear analysis stack:

- Price structure: swing detection and swing validity
- Force analysis: `force_ratio`, `count_ratio`, `quality_ratio`
- Path efficiency: `displacement_efficiency`
- Context tools: ranges, replay, marks, side-panel inspection, sub-chart

What is missing is a reusable "trend strength / market regime" layer.

`ADX` is the correct next step because it is deterministic, interpretable, and easy to integrate into the existing architecture.
`HMM` should come later as a regime-classification layer built on top of stable features, not as the first addition.

## 2. Project Goals

### Primary Goal

Add `ADX +DI -DI` to the current project as a formal feature that can be used in:

- chart visualization
- context interpretation
- replay analysis
- optional filtering for existing range / swing logic

### Secondary Goal

Prepare the codebase and analysis flow so a later `HMM` module can be added as a research feature without forcing a major rewrite.

## 3. Non-Goals

This plan does not aim to:

- use `ADX` alone as an entry or exit signal
- replace existing `force_ratio` or `displacement_efficiency`
- push `HMM` directly into the main decision flow on first release
- train a model on every API request

## 4. Product Direction

### ADX Positioning

`ADX` is a trend-strength and context filter.

It should answer:

- Is the market trending or ranging?
- Is the current directional move strong enough to matter?
- Does an existing swing / range interpretation happen inside a weak or strong trend backdrop?

### HMM Positioning

`HMM` is a regime layer, not a classic indicator.

It should answer:

- What hidden market state is the current sequence most likely in?
- Is the market behaving more like `bull trend`, `bear trend`, `range`, or `transition`?

## 5. Guiding Principles

1. Add deterministic indicators before probabilistic models.
2. Ship `ADX` as a usable chart feature before coupling it to core logic.
3. Keep `HMM` in research mode until its outputs are stable and interpretable.
4. Prefer reusable backend feature series over one-off UI-only calculations.
5. Every new layer must support replay mode and inspection workflows.

## 6. Current Integration Points

The most relevant existing files are:

- `backend/core/atr.py`
- `backend/core/force_analysis.py`
- `backend/core/displacement.py`
- `backend/routes/indicators.py`
- `backend/routes/series.py`
- `backend/routes/ranges.py`
- `backend/routes/marks.py`
- `frontend/src/types.ts`
- `frontend/src/api/client.ts`
- `frontend/src/App.tsx`
- `frontend/src/components/SubChart.tsx`
- `frontend/src/components/MarkPanel.tsx`
- `frontend/src/components/Toolbar.tsx`

These files already define the project pattern for:

- indicator computation
- rolling series endpoints
- chart toggles
- side-panel inspection
- mark snapshots
- replay compatibility

## 7. Execution Strategy

The work should be split into two major phases.

---

## Phase A: ADX Formalization

### A0. Scope Definition

Define `ADX` as an official project indicator with these outputs:

- `adx`
- `plus_di`
- `minus_di`

Recommended default period:

- `14`

Decide early that first release will support:

- single-candle context display
- rolling series display
- replay compatibility

Decide early that first release will not yet require:

- mandatory integration into swing scoring
- mandatory integration into range detection

### A1. Backend Indicator Core

Create a dedicated backend indicator module.

Recommended new file:

- `backend/core/adx.py`

Responsibilities:

- compute `+DM`
- compute `-DM`
- compute smoothed `TR`
- compute `+DI`
- compute `-DI`
- compute `DX`
- compute `ADX`

Design requirements:

- deterministic output
- consistent warmup handling
- clear behavior when candle count is insufficient
- no dependency on external TA libraries for first implementation

Acceptance criteria:

- output is numerically stable
- results are reproducible
- edge cases return safe values instead of crashing

### A2. Backend API Integration

Integrate ADX into the existing API surface.

Likely touch points:

- `backend/routes/indicators.py`
- `backend/routes/series.py`
- `backend/routes/marks.py`

Expected additions:

- selected-candle snapshot can expose current `adx`, `plus_di`, `minus_di`
- rolling series endpoint can expose ADX series for chart usage
- mark snapshots can optionally persist ADX context for later review

Recommended API behavior:

- keep current endpoints backward-compatible
- extend payloads instead of replacing shapes
- avoid creating too many overlapping routes unless the response shape becomes unclear

Acceptance criteria:

- existing consumers keep working
- ADX values are available in live and replay views
- marks created after rollout can carry ADX context

### A3. Frontend Type and API Wiring

Extend frontend data types and client methods.

Likely touch points:

- `frontend/src/types.ts`
- `frontend/src/api/client.ts`

Add support for:

- ADX fields in indicator payloads
- ADX fields in rolling series payloads
- optional ADX fields in mark snapshots

Acceptance criteria:

- types remain coherent
- old screens still compile
- no fragile `any` fallback is introduced

### A4. Chart Productization

Make ADX visible and usable inside the chart workflow.

Likely touch points:

- `frontend/src/App.tsx`
- `frontend/src/components/SubChart.tsx`
- `frontend/src/components/Toolbar.tsx`

Recommended first-release UI:

- toggle to show ADX
- ADX line in sub-chart
- optional `+DI` and `-DI` lines in same sub-chart or alternate mode
- reference levels such as `20` and `25`

Recommended UX behavior:

- keep the current force / displacement sub-chart readable
- do not overload one panel with too many unrelated series without a clear mode switch
- preserve replay synchronization with the main chart

Acceptance criteria:

- user can enable or disable ADX cleanly
- chart remains legible on desktop and mobile
- sub-chart stays aligned during scroll and replay

### A5. Side-Panel Context

Expose ADX context in the side panel for selected candles and ranges.

Likely touch point:

- `frontend/src/components/MarkPanel.tsx`

Recommended display:

- current `ADX`
- `+DI`
- `-DI`
- simple textual interpretation

Examples:

- `ADX low: likely range or weak trend`
- `+DI above -DI: bullish directional dominance`
- `-DI above +DI: bearish directional dominance`

Acceptance criteria:

- selected candle inspection is more informative without becoming noisy
- wording remains descriptive, not prescriptive

### A6. Validation and Release Gate

Before moving beyond ADX-as-visual-feature, validate it manually.

Validation process:

- compare BTCUSDT on `15m`, `1h`, `4h`, `1d`
- compare at least two other symbols with different volatility profiles
- inspect known range periods and known trend periods
- verify replay produces identical historical readings

Questions to answer:

- Does low ADX often overlap with current range detection?
- Does rising ADX coincide with cleaner directional phases?
- Does `+DI/-DI` add useful context beyond `force_ratio`?

Release gate:

Proceed only if ADX is clearly useful as a visual and interpretive layer.

### A7. Optional Post-MVP ADX Logic Integration

Only after A6 succeeds, consider deeper integration.

Candidate uses:

- optional extra condition in `ranges.py`
- optional context tag for swing interpretation
- optional mark snapshot enrichment

Important rule:

`ADX` should first be used as a filter or context qualifier, not a hard replacement for existing logic.

Examples:

- range confidence increases if `displacement_efficiency` is low and `ADX` is below threshold
- swing commentary changes depending on whether ADX is high or low

Do not yet:

- make ADX mandatory for swing validity
- convert the current structure logic into a pure ADX-based system

---

## Phase B: HMM Research Layer

This phase should start only after ADX is stable and clearly useful.

### B0. Entry Criteria

Start HMM only when all of the following are true:

- ADX integration is complete and validated
- the indicator payload format is stable
- replay mode can already show derived indicator series reliably
- there is confidence in which features are useful and interpretable

### B1. HMM Scope Definition

Define HMM as a research feature for market regime classification.

First version should classify regimes, not generate trade signals.

Recommended initial target states:

- `bull_trend`
- `bear_trend`
- `range`

Optional later expansion:

- `transition`
- `high_volatility_breakout`

### B2. Feature Set Design

Build HMM on top of engineered features instead of raw candles alone.

Recommended initial features:

- log return or normalized return
- ATR-normalized range or volatility
- `force_ratio`
- `count_ratio`
- `displacement_efficiency`
- volume abnormality
- `adx`
- `plus_di - minus_di` directional spread

Feature design goals:

- interpretable
- stable across symbols and intervals
- not too redundant

### B3. Model Training Architecture

Do not train HMM inside normal UI request flow.

Recommended design:

- offline or scheduled fit step
- persisted model artifact or persisted state series
- lightweight inference path for UI consumption

Recommended implementation pattern:

- one research script or pipeline for model fitting
- one backend route for reading fitted regime series
- optional storage table for per-candle regime outputs

Possible future files:

- `backend/core/regime_features.py`
- `backend/core/hmm_regime.py`
- `backend/routes/regime.py`
- `scripts/train_hmm_regime.py`

### B4. State Naming and Stability

This is the hardest product problem in HMM, and it must be handled explicitly.

Core issue:

HMM state indices are arbitrary. `state_0` after one training run may not mean the same thing after the next run.

Required solution:

- compute summary statistics per fitted state
- map anonymous states to semantic labels
- define deterministic labeling rules

Example mapping rules:

- highest ADX and positive average return -> `bull_trend`
- highest ADX and negative average return -> `bear_trend`
- lowest ADX and low displacement efficiency -> `range`

Acceptance criteria:

- the same semantic labels remain stable across retraining
- state meaning can be explained in plain language

### B5. Research Validation

Run HMM as a research workflow before productizing it.

Validation goals:

- see whether regimes align with visual market structure
- compare HMM range state with current `ranges.py`
- compare HMM trend states with ADX and directional context
- identify whether HMM catches transitions earlier or more usefully than threshold-based logic

Failure conditions:

- states are unstable across retraining
- labels cannot be explained cleanly
- outputs do not add value beyond ADX + existing features

If any failure condition holds, HMM should remain a research tool and not be promoted to the main UI.

### B6. HMM Product Prototype

Only after B5 succeeds, add a lightweight UI prototype.

Recommended first UI shape:

- regime background bands on main chart
- current regime box in side panel
- optional confidence display

Recommended wording:

- descriptive and probabilistic
- not framed as a direct trade order

Examples:

- `Current regime: range`
- `Confidence: 0.74`
- `State duration: 18 bars`

Do not lead with:

- `buy`
- `sell`
- `enter now`

### B7. HMM Promotion Gate

Promote HMM from research to formal feature only if:

- regimes are stable
- labels are interpretable
- replay validation is convincing
- the output materially improves analysis over ADX alone

If not, keep HMM behind a research flag and continue using ADX as the production-grade regime context tool.

---

## 8. Recommended Delivery Order

### Stage 1

- implement backend ADX core
- expose ADX through existing indicator APIs
- extend frontend types and API client

### Stage 2

- add ADX chart toggle and sub-chart display
- add ADX context to side panel
- validate replay and manual inspection behavior

### Stage 3

- optionally enrich marks with ADX snapshot
- optionally add ADX-assisted range filter
- document what ADX is actually useful for in this project

### Stage 4

- define HMM feature set
- build research-only training and inference pipeline
- validate state labeling and output stability

### Stage 5

- prototype regime overlay UI
- decide whether HMM stays research-only or becomes a formal feature

## 9. Acceptance Criteria Summary

### ADX MVP is complete when:

- backend can compute `adx`, `plus_di`, `minus_di`
- frontend can render ADX-derived chart context
- replay mode shows the same indicator behavior as live mode
- side panel can inspect ADX context on a selected candle
- the feature is useful without changing existing core logic

### HMM research phase is complete when:

- regime outputs are stable enough to label semantically
- research evidence shows value beyond threshold-only tools
- results are explainable in plain language
- the team can decide with confidence whether to productize it

## 10. Risks and Mitigations

### Risk 1: ADX overlaps too much with current tools

Mitigation:

- validate against `force_ratio` and `displacement_efficiency`
- keep it as a context layer unless it proves additive

### Risk 2: UI clutter in sub-chart

Mitigation:

- use view modes or clear toggles
- avoid showing every line at once by default

### Risk 3: HMM state drift

Mitigation:

- introduce semantic label mapping rules
- compare state feature summaries across retraining runs

### Risk 4: HMM adds complexity without practical value

Mitigation:

- keep HMM in research mode first
- define promotion gates before UI formalization

### Risk 5: Replay and live paths diverge

Mitigation:

- make all derived series come from the same backend feature pipeline
- validate the same historical window in both modes

## 11. Final Recommendation

The recommended roadmap is:

1. Formalize `ADX +DI -DI` first.
2. Ship ADX as a chart and context feature.
3. Validate whether it materially improves range and structure interpretation.
4. Only then begin HMM as a research regime layer.
5. Promote HMM to product only if it proves stable, interpretable, and additive.

This sequence keeps the project aligned with its current architecture, reduces risk, and builds a clean foundation for later probabilistic regime modeling.
