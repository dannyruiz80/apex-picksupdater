# ML Engine Hardening V1

This build adds the first foundation layer for a reliable, auditable sports prediction engine.

## Added

- `APEX_PREDICTION_CONTRACT_V1`
  - Deterministic prediction IDs
  - Event/player/market/price/model identity
  - Provider and model timestamps
  - Provenance metadata
  - Raw model probability separated from calibration status
  - No false calibration claim: `calibratedProbability` remains `null` until a real calibrator is connected
  - Immutable top-level prediction contract

- Central Recommendation Gate
  - Market identity verification
  - Player identity verification
  - Historical-stat verification
  - Model availability check
  - Probability range validation
  - Provenance completeness
  - Provider-timestamp price freshness
  - Pregame-only eligibility
  - Reliability threshold
  - Positive EV threshold
  - Minimum EV threshold
  - Minimum edge threshold

- New fail-closed reason codes
  - `INVALID_PROBABILITY`
  - `PROVENANCE_INCOMPLETE`
  - `STALE_PRICE`
  - `EVENT_NOT_PREGAME`

- Quote event context
  - Normalized prop quotes now carry event status and event start time into the value layer.

- Historical linkage
  - Existing immutable historical snapshots now retain the selected `predictionId` and prediction-contract version.
  - Snapshot model/value versions are sourced from the actual evaluated model instead of hard-coded constants.

## Freshness rule

Price freshness is anchored to `providerTimestamp`, not `retrievedAt`. Re-fetching an old payload cannot make an old sportsbook price appear current.

Default maximum provider quote age: **10 minutes**.

## Regression verification

`src/server/recommendationGate.verify.ts` contains focused checks for:

1. Healthy verified pregame quote qualifies.
2. Stale provider price fails even with a fresh server retrieval timestamp.
3. Live event fails.
4. Missing provenance fails.
5. Probability outside `[0, 1]` fails.
6. Prediction contract has deterministic ID, immutable top-level structure, and does not claim calibration before calibration exists.

Verification result during build: **6 / 6 PASS**.

## Next ML phases

1. Point-in-time feature snapshot contract and leakage tests.
2. Real calibration layer with walk-forward fitted calibrators.
3. Walk-forward backtester and calibration/Brier/log-loss reporting.
4. Champion/challenger/shadow model registry.
5. Sport/market-specific feature pipelines beginning with MLB pitcher strikeouts, then WNBA, then NFL.
6. Uncertainty/abstention engine and price-to-bet thresholds.
7. Correlation-aware parlay simulation.
