# Apex Picks ML Engine V4 — Prospective Champion / Challenger Monitor

## Purpose

V4 adds a prospective model-governance layer for MLB pitcher strikeouts. The current production model remains the **champion** and `APEX_PITCHER_K_V3_SHADOW` remains a **challenger**. The monitor measures both models from immutable point-in-time snapshots and can only return `REVIEW_ELIGIBLE`; it cannot switch the production model automatically.

## Evidence rules

1. Only `REAL_PREGAME`, point-in-time-valid, graded MLB `pitcher_strikeouts` snapshots containing the V3 shadow payload are scored.
2. Only the **earliest V3 snapshot per event + pitcher + market + line** is counted as a prediction outcome. Repeated refreshes do not inflate the sample.
3. Later valid V3 quotes from the same sportsbook and proposition may be used only as **latest-observed-pregame price evidence** for CLV. The ordering uses `sportsbookQuoteTimestamp`, not server retrieval time.
4. Historical Apex snapshots that predate V3 are preserved but are never retroactively treated as prospective challenger evidence.
5. Pushes are excluded from binary probability scoring. Over probability is normalized over decisive Over/Under probability mass before Log Loss, Brier, calibration, and directional accuracy are calculated.
6. Hypothetical Champion and Challenger bets use the same production value thresholds: minimum reliability, +3 percentage-point edge, positive EV, and at least +3% EV.

## Metrics

For champion and challenger the Model Arena reports:

- Prospective observations and decisive outcomes
- Log Loss
- Brier Score
- Mean calibration gap
- Five-bin Expected Calibration Error (ECE)
- Directional accuracy
- Hypothetical qualified plays and W-L-P record
- Flat-stake net units and ROI
- Latest-observed-pregame CLV probability points

ROI is diagnostic. It cannot promote a model by itself.

## Cohort stability

V4 reports challenger-vs-champion Log Loss and Brier performance by:

- Strikeout line range
- Opponent strikeout-rate bucket
- Expected batters-faced workload bucket
- V3 data quality
- Pitcher team HOME / AWAY role (captured prospectively; never guessed for older rows)

## Promotion review gates

The challenger may become `REVIEW_ELIGIBLE` only after all blocking gates pass:

- >= 120 prospective V3 observations
- >= 100 decisive graded outcomes
- Challenger Log Loss improves by >= 0.005
- Challenger Brier improves by >= 0.002
- Challenger ECE <= 0.060 and mean calibration gap <= 0.030
- >= 30 challenger hypothetical actionable plays
- >= 20 observed-close CLV samples
- Average challenger observed-close CLV >= 0.000 probability points
- >= 3 mature cohorts with at least 20 observations
- Zero mature cohorts with Log Loss degradation > 0.03

Flat-stake ROI >= 0% is displayed as a non-blocking financial diagnostic because ROI is noisier than proper probability scores and CLV.

### Important governance rule

`automaticPromotionAllowed` is permanently `false` in `APEX_CHAMPION_CHALLENGER_V1`.

`REVIEW_ELIGIBLE` means only that a manual model review may begin. It does not modify `APEX_BASELINE_V1`, the recommendation gate, historical predictions, or previously stored outcomes.

## New server endpoints

```text
GET /api/ml/mlb/pitcher-k/champion-challenger
GET /api/ml/mlb/pitcher-k/champion-challenger/verify
```

The verification endpoint is deterministic and consumes zero keyed Odds API requests.

## UI

Audit now opens to:

```text
MODEL ARENA: CHAMPION / CHALLENGER
```

The panel shows:

- Current promotion state
- Champion and Challenger scorecards
- Proper-score deltas
- ROI / CLV diagnostics
- Every promotion gate with actual vs required evidence
- Cohort stability table
- Recent prospective comparisons
- Explicit `AUTO PROMOTION: DISABLED` protection

## Current preserved-ledger state

At packaging time the existing historical ledger contains **0 graded V3 prospective observations**, so V4 correctly reports:

```text
COLLECTING_EVIDENCE
```

It does not backfill V1/V2 history into V3 evidence.

## Verification completed

- Prediction Contract / Central Gate: 6 / 6 PASS
- ML Engine V2: 7 / 7 PASS
- MLB Pitcher K V3: 11 / 11 PASS
- Champion / Challenger V4: 8 / 8 PASS
- Probability Engine: 10 / 10 PASS
- Value Engine: 16 / 16 PASS
- Backtest Engine: 16 / 16 PASS
- Persistence Engine: 15 / 15 PASS
- Changed backend TypeScript target compile: PASS
- New/modified TSX syntax transpile: PASS
- Keyed Odds API requests consumed by verification: 0

Historical ledger SHA-256 remained:

```text
45d20f30716e5f5ef2efa92c431d2b5712f2fba64208df5d1da1965525a2ff94
```

The sandbox did not contain installed npm dependencies, so a full Vite production bundle was not run here. Backend TypeScript was type-checked with dependency shims, and changed TSX files were syntax-transpiled successfully. The existing dependency manifest remains intact for normal `npm install && npm run build` execution.
