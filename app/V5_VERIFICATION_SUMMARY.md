# Apex Picks ML Engine V5 — Verification Summary

Build: `mlb-pitcher-k-v5-fast-learning-evidence`
App version: `1.8.0`

## Deterministic verification

- Prediction Contract / Central Recommendation Gate: **6 / 6 PASS**
- ML Engine V2 point-in-time + calibration: **7 / 7 PASS**
- MLB Pitcher K V3 shadow: **11 / 11 PASS**
- Champion / Challenger V4: **8 / 8 PASS**
- MLB Pitcher K V5 fast learning: **10 / 10 PASS**
- Probability Engine: **10 / 10 PASS**
- Value Engine: **16 / 16 PASS**
- Backtest Engine: **16 / 16 PASS**
- Persistence Engine: **15 / 15 PASS**
- Changed backend/server TypeScript compile: **PASS**
- V5 Model Arena TSX compile: **PASS**
- Keyed Odds API requests consumed by deterministic verification: **0**

## V5-specific protections verified

- Exact final strikeout count scoring with NLL / CRPS / MAE / RMSE.
- Multiple legitimate sportsbook lines are clustered to one independent pitcher-start sample.
- Booster sample threshold counts independent starts, not line rows.
- First valid all-starter forecast is immutable; grading only appends the result.
- Historical replay is research-only and cannot satisfy prospective promotion or CLV gates.
- Automatic production promotion remains disabled.
- All-starter capture uses public MLB data and invents no sportsbook line or price.
- Final-only grading prevents partial in-game strikeout totals from becoming labels.
- Short-lived public-response caching reduces repeated MLB requests while all historical feature rows remain filtered to `gameDate < asOf`.
- Early-season prior-year workload supplementation is explicitly labeled in the V3 feature vector.

## Historical ledger integrity

`data/historicalPropSnapshots.json`

SHA-256:

`45d20f30716e5f5ef2efa92c431d2b5712f2fba64208df5d1da1965525a2ff94`

This matches the preserved production backup included in the build.

## External-source limitation

The deterministic verification does not prove live connectivity to MLB public endpoints from every deployment environment. Capture and replay fail without fabricating data when those endpoints are unavailable.
