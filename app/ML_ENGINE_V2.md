# Apex Picks ML Engine V2

## Scope

This build adds three reliability layers on top of ML Engine Hardening V1:

1. **Point-in-Time Feature Engine** (`APEX_FEATURE_SNAPSHOT_V1`)
2. **Chronological Probability Calibration** (`APEX_PLATT_V1`)
3. **Walk-Forward Validation Planning**

The objective is to prevent future information leakage, prevent stale feature-cache reuse, and calibrate model probabilities only when real prospective evidence supports doing so.

## 1. Point-in-Time Feature Engine

File: `src/server/pointInTimeFeatureEngine.ts`

Every prop probability evaluation now creates an immutable feature audit containing:

- prediction `asOf` timestamp
- feature snapshot ID and version
- sportsbook quote timestamp
- roster/source observation timestamp
- historical-stat retrieval timestamp
- event start timestamp
- recent game-log dates
- exact feature observations used by the model
- explicit point-in-time failure reasons

The model fails closed if any required observation is future-dated, if a historical game log occurs after the prediction instant, if the event has already started, if the status is not pregame, or if the event start timestamp is unavailable.

The probability cache key now includes the sportsbook observation timestamp and historical-stat retrieval timestamp so a refreshed source state cannot reuse an older cached probability.

## 2. Probability Calibration

File: `src/server/probabilityCalibrationService.ts`

Calibration uses a regularized two-parameter Platt model on the logit of the raw model probability.

Important safeguards:

- Only `REAL_PREGAME` snapshots are eligible.
- Only `GRADED` snapshots are eligible.
- The outcome must have been graded **on or before the prediction `asOf` time**.
- The snapshot must pass V2 point-in-time proof and contain a feature snapshot ID.
- Calibration trains on **raw model probabilities**, never previously calibrated probabilities.
- Push outcomes are excluded from binary calibration.
- Training is scoped by sport, market, and model version.
- A chronological held-out validation set is required.
- Calibration activates only if held-out Log Loss / Brier quality is non-worse and meaningfully improves at least one metric.
- If evidence is insufficient or validation does not improve, the raw probability remains the decision probability and the reason is exposed.

Activation thresholds in this build require at least 30 chronological training snapshots plus 10 validation snapshots for the exact sport/market/model combination.

Current legacy snapshots are intentionally **not** treated as V2 calibration evidence because they were captured before `APEX_FEATURE_SNAPSHOT_V1` existed.

## 3. Decision Probability Semantics

`ApexProbabilityResult` now exposes:

- `rawOverProbability`
- `rawUnderProbability`
- `calibratedOverProbability`
- `calibratedUnderProbability`
- `apexOverProbability`
- `apexUnderProbability`
- `calibration`
- `pointInTimeAudit`

`apexOverProbability` / `apexUnderProbability` are the probabilities used by the value engine:

- calibration ACTIVE -> calibrated probability
- calibration unavailable / rejected -> raw baseline probability

The Prediction Contract records both raw and calibrated probability plus calibration status and feature snapshot identity.

## 4. Central Recommendation Gate

The gate now adds `POINT_IN_TIME_INVALID` as a hard fail-closed reason.

A recommendation cannot qualify unless all of the following pass:

- market identity
- player identity
- verified historical statistics
- model availability
- valid probability
- complete provenance
- fresh provider quote
- pregame eligibility
- point-in-time feature integrity
- reliability threshold
- edge threshold
- EV threshold
- positive EV requirement

## 5. Historical Snapshot Hardening

New snapshots persist:

- prediction ID / contract version
- feature snapshot ID / version / as-of time
- point-in-time validation state
- calibration version / status
- raw probabilities
- calibrated probabilities
- final decision probabilities

Temporal proof is no longer manufactured from the snapshot-write time. The snapshot requires explicit source timestamps from the sportsbook and historical-stat observation.

A provider-event identity bug was also corrected: historical snapshots now persist `quote.providerEventId` rather than incorrectly storing `providerMarketKey` in that field.

## 6. Walk-Forward Validation

File: `src/server/walkForwardValidationService.ts`

Validation uses chronological expanding windows only. Random train/test shuffling is not allowed.

Each fold guarantees:

`latest training event < earliest test event`

Snapshots without V2 point-in-time proof are excluded from V2 walk-forward evidence.

## 7. Diagnostic API Endpoints

- `GET /api/ml/v2/verify`
- `GET /api/ml/walk-forward/plan?minTrain=30&testSize=10`
- `GET /api/ml/calibration/status?sport=MLB&market=pitcher_strikeouts&modelVersion=APEX_BASELINE_V1`

`/api/version` reports build `ml-engine-v2-point-in-time-calibration` and version `1.5.0`.

## 8. Verification Results

Verified during build:

- Prediction Contract / Central Gate: **6 / 6 PASS**
- ML Engine V2 integrity suite: **7 / 7 PASS**
- Existing Probability Model suite: **10 / 10 PASS**
- Existing Value / Recommendation suite: **16 / 16 PASS**
- Existing Persistence suite: **15 / 15 PASS**
- Existing Backtest suite: **16 / 16 PASS**
- Targeted TypeScript compile for all changed backend modules: **PASS**
- Historical snapshot JSON restored byte-for-byte after persistence testing: **PASS**

## 9. Current Calibration State

With the included historical dataset, `APEX_PLATT_V1` correctly reports `INSUFFICIENT_EVIDENCE` for MLB pitcher strikeouts because the old records do not contain V2 point-in-time feature proof.

This is intentional. New V2 prospective snapshots accumulate calibration-grade evidence. Once the exact sport/market/model reaches the minimum evidence threshold, the calibrator performs chronological validation and activates only if it improves held-out probability quality.

## Next Recommended Phase

The next model-quality step should be **sport/market-specific feature expansion + challenger models**, beginning with MLB pitcher strikeouts as the reference implementation:

- expected batters faced / workload
- opponent K% and handedness split
- pitch mix / swinging-strike / CSW
- velocity trend
- park / weather / umpire
- starter-role confirmation
- distributional forecast (Poisson / Negative Binomial)
- gradient-boosted challenger model
- champion-vs-challenger walk-forward comparison

The existing V2 infrastructure is designed so those models can plug into the same immutable feature, calibration, EV, and recommendation pipeline.
