# Apex Picks ML Engine V3 — MLB Pitcher Strikeouts Shadow Challenger

Build: `1.6.0 / mlb-pitcher-k-v3-shadow`

## Purpose

V3 adds a materially richer MLB pitcher-strikeout model without allowing an unproven challenger to alter production BET/PASS decisions. `APEX_BASELINE_V1` remains the production model. V3 runs in shadow, writes immutable feature/model evidence into new V3-grade snapshots, and can only become promotion-eligible after chronological holdout validation.

## Architecture

### 1. Point-in-time feature vector

Each MLB `pitcher_strikeouts` evaluation can build `APEX_MLB_K_FEATURES_V3` containing:

- Expected batters faced from verified workload history
- Expected innings
- Season / L10 / L5 strikeouts per batter faced
- Workload trend
- Strikeout mean and variance
- Opponent strikeout rate using MLB team batting data only through the prior date
- Pitcher handedness
- Recent swinging-strike rate
- Recent CSW rate
- Fastball velocity and velocity trend
- Dominant pitch share
- Days rest
- Pregame temperature and wind when safely observable
- Venue and home-plate umpire identity when safely observable
- Park factor and umpire strikeout factor remain `null` until a validated source/model is connected

Missing advanced data remains `null`; there is no synthetic league-average fallback.

The feature vector includes a deterministic SHA-256-derived `featureVectorId`, an `asOf` timestamp, and `latestFeatureObservedAt` so later audits can identify the exact feature state used.

### 2. Workload provenance

V3 prefers official MLB `battersFaced` game-log values. If official BF history is unavailable, it may transparently derive BF from verified box-score components. The feature vector records:

- `officialBattersFacedStarts`
- `derivedBattersFacedStarts`
- `workloadSource = OFFICIAL_BF | MIXED | DERIVED | UNAVAILABLE`

Derived workload is never labeled official.

### 3. Negative-Binomial count model

`APEX_MLB_K_NB_V3` models strikeouts as a count distribution rather than turning a point estimate directly into a probability.

Expected strikeouts are based on verified expected workload multiplied by a bounded nested K/BF estimate. The dispersion parameter is estimated from verified historical strikeout variance; when the observed count history is not overdispersed the model approaches Poisson behavior.

The model returns separate Over, Under, and Push probabilities and checks that they normalize to 1.

### 4. Boosted challenger

`APEX_MLB_K_GB_STUMPS_V3` is a regularized gradient-boosted decision-stump challenger layered on the Negative-Binomial foundation.

Important safeguards:

- Minimum 80 graded V3 point-in-time rows
- Minimum 20-row chronological validation set
- Training outcomes must be known before the current prediction time
- No random train/test shuffle
- Must improve held-out log loss by at least 0.003
- Must not worsen held-out Brier score
- Otherwise status is `INSUFFICIENT_EVIDENCE` or `REJECTED_VALIDATION`

For integer strikeout lines, the boosted model learns `P(OVER | NO PUSH)`. The result is converted back to unconditional Over/Under probabilities while preserving the Negative-Binomial push mass.

### 5. Shadow-only integration

`APEX_PITCHER_K_V3_SHADOW` is attached to the production probability result for MLB pitcher strikeout markets, but the existing production probability continues to drive the value engine and Central Recommendation Gate.

The UI labels the V3 block `MLB K V3 SHADOW — AUDIT ONLY` and shows production vs. shadow probability, expected strikeouts, expected batters faced, workload source, K/BF, opponent K%, CSW%, SwStr%, velocity delta, official BF coverage, and feature ID.

## Point-in-time protections

V3 rejects or suppresses evidence that cannot be proven available at prediction time:

- Future-dated game logs are rejected.
- Future context timestamps are rejected.
- Opponent K rate is requested only through the prior calendar date, not as a full-season total.
- Statcast queries exclude the current calendar day.
- Live MLB game feeds are used for weather/umpire context only for current pregame evaluation. They are not used to reconstruct old predictions, because a postgame feed is not a historical as-of archive.
- Existing V2 point-in-time checks remain active underneath V3.

## Immutable V3 evidence

New V3-grade snapshots persist:

- V3 feature vector and feature ID
- Negative-Binomial Over probability
- Negative-Binomial Under probability
- Negative-Binomial Push probability
- Boosted conditional Over probability
- Final V3 shadow Over probability

This allows future challenger training to use the probability components that were actually recorded at prediction time rather than recomputing old predictions with newer code.

## Promotion policy

V3 does **not** automatically replace the production model.

A current evaluation may be marked `promotionEligible` only when:

1. The boosted challenger has `ACTIVE_SHADOW` status.
2. Feature quality is `ENRICHED`.
3. At least five official MLB batters-faced workload starts are available for the current pitcher.
4. The chronological validation sample contains at least 20 rows.
5. Held-out boosted log loss beats the V3 Negative-Binomial baseline.

That flag means eligible for continued review, not automatic deployment. Production promotion should additionally require a meaningful prospective sample, calibration review, subgroup stability, CLV/ROI review, and no integrity regressions.

## Verification completed

- Prediction Contract / Central Recommendation Gate: **6 / 6 PASS**
- ML Engine V2: **7 / 7 PASS**
- MLB Pitcher K V3: **11 / 11 PASS**
- Probability Engine: **10 / 10 PASS**
- Value Engine: **16 / 16 PASS**
- Backtest Engine: **16 / 16 PASS**
- Persistence Engine: **15 / 15 PASS**
- Frontend V3 PropsView targeted TypeScript compile: **PASS**
- Keyed Odds API requests consumed by the deterministic verification suites: **0**
- Historical snapshot file remained byte-identical after final verification: SHA-256 `45d20f30716e5f5ef2efa92c431d2b5712f2fba64208df5d1da1965525a2ff94`

The separate player-stat verification includes a live ESPN connectivity check. In the build sandbox, DNS access to `site.web.api.espn.com` was unavailable; its deterministic checks passed, but that external connectivity assertion could not be completed in this environment.

## New endpoints / commands

- `GET /api/ml/mlb/pitcher-k/v3/verify`
- `POST /api/ml/mlb/pitcher-k/v3/context`
- `npm run verify:mlb-k-v3`

## Data-cost behavior

V3 public-context enrichment uses MLB Stats API and Baseball Savant/Statcast data and does not consume the keyed Odds API quota. Public enrichment is cached and concurrency-limited to four pitchers at a time to reduce feed pressure and refresh fragility.
