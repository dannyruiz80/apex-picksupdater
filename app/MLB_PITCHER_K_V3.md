# Apex Picks — MLB Pitcher Strikeouts V3 Shadow Challenger

Version: **1.6.0**  
Shadow model: **APEX_PITCHER_K_V3_SHADOW**  
Count model: **APEX_MLB_K_NB_V3**

## Purpose

V3 is a challenger model for MLB pitcher strikeout props. It is intentionally **shadow-only**. The current production probability remains the authority for BET/PASS decisions until V3 accumulates enough authentic, point-in-time graded evidence and demonstrates superior held-out probability quality.

No V3 model is automatically promoted.

## Architecture

### 1. Point-in-time feature vector

`mlbPitcherKFeatureService.ts` creates an immutable, deterministic feature vector for each evaluation. The vector records:

- Event, player, line, side, and evaluation timestamps
- A deterministic `featureVectorId`
- Expected batters faced and innings
- Official vs derived workload provenance
- Season/L10/L5 strikeouts-per-batter-faced
- Workload trend and strikeout variance
- Opponent strikeout rate when authentically available
- Pitcher handedness
- Swinging-strike rate
- CSW rate
- Fastball velocity and recent velocity delta
- Dominant pitch share
- Days rest
- Venue, temperature, and wind context
- Umpire identity when available
- Park/umpire adjustment slots without synthetic fallback

Every timestamp is checked against the prediction `asOf` and event start time. Future observations fail closed.

### 2. Workload model

The feature builder prefers official MLB batters-faced game logs. If official BF history is insufficient but verified box-score components are available, BF can be transparently derived from outs, hits, walks, and hit-by-pitches. The feature vector explicitly records whether workload is:

- `OFFICIAL_BF`
- `MIXED`
- `DERIVED`
- `UNAVAILABLE`

Recent starts receive greater weight when projecting expected BF and expected innings.

### 3. Negative-Binomial strikeout distribution

`mlbPitcherKNegativeBinomialService.ts` converts expected workload and verified K/BF history into a full strikeout count distribution.

The distribution produces:

- Expected strikeouts
- Over probability
- Under probability
- Push probability for integer lines
- Dispersion parameter

Half-point lines must sum to Over + Under = 1. Integer lines preserve explicit push mass instead of forcing it into one side.

Advanced context is **not hand-weighted into this baseline**. That is deliberate: opponent profile, pitch quality, velocity, weather, park, and umpire effects are reserved for the data-trained challenger rather than being assigned arbitrary manual coefficients.

### 4. Gradient-boosted shadow challenger

`mlbPitcherKBoostedShadowService.ts` implements a chronological gradient-boosted decision-stump logistic residual model. It uses the Negative-Binomial probability as its offset/baseline and learns residual signal from verified V3 features.

Activation requirements include:

- At least 80 eligible graded V3 point-in-time rows
- Both outcomes represented
- Chronological train/validation split
- Training outcomes known before the evaluated prediction
- Feature snapshot created before event start
- Held-out Log Loss improvement of at least 0.003 over the NB baseline
- Held-out Brier Score not worse than the NB baseline

Until those conditions are met, status remains fail-closed/collecting evidence.

### 5. Promotion rules

Even an active shadow challenger is **not** automatically a production model. Promotion eligibility additionally requires enriched data quality, official workload coverage, adequate validation sample size, and held-out improvement.

Production promotion must remain an explicit model-governance decision.

## Authentic public context

`mlbPitcherKContextService.ts` enriches MLB K candidates using public MLB/Statcast sources without consuming keyed Odds API credits. Requests are cached and deduplicated per pitcher.

Connected context includes official workload history, opponent team strikeout profile, Statcast pitch outcomes/velocity, days rest, venue/weather, and umpire identity when available.

`parkFactor` and `umpireStrikeoutFactor` intentionally remain `null` unless a validated quantitative feed/model is connected. Missing values are not replaced with fabricated league-average values.

## Production isolation

The existing production probability is passed to V3 only as a comparison value. V3 returns a shadow result and cannot modify the production BET/PASS recommendation.

The UI displays a **MLB K V3 SHADOW — AUDIT ONLY** panel with production vs shadow probability, projected Ks/BF, workload provenance, selected advanced features, and feature-vector ID.

## Immutable evidence

New V3 snapshot fields are persisted alongside the normal historical record:

- Feature vector and `featureVectorId`
- NB probability
- Boosted probability/status
- Final V3 shadow probability

This creates the prospective dataset required for future chronological champion/challenger evaluation.

Existing historical records are preserved and are not retroactively treated as V3-grade evidence.

## Verification

Final V3 deterministic verification: **11 / 11 PASS**

Coverage includes:

1. Verified workload feature construction
2. Negative-Binomial half-line normalization
3. Integer-line push handling
4. Rejection of future advanced context
5. Transparent BF derivation
6. Fail-closed boosted challenger without evidence
7. Chronological challenger activation when it genuinely beats the baseline
8. Preservation of integer-line push mass in shadow probabilities
9. Production probability isolation
10. No synthetic advanced-feature fallback
11. Zero keyed Odds API requests during verification

Regression verification after V3 integration:

- Prediction probability engine: **10 / 10 PASS**
- Value/recommendation engine: **16 / 16 PASS**
- Durable snapshot persistence: **15 / 15 PASS**
- Backtest framework: **16 / 16 PASS**
- ML Engine V2: **7 / 7 PASS**
- Prediction Contract / Central Gate: **6 / 6 PASS**
- Server integration TypeScript check: **PASS**
- V3 Props audit-panel TypeScript check: **PASS**
- Keyed Odds API requests consumed by deterministic verification: **0**

Historical snapshot SHA-256 remained unchanged from V2:

`45d20f30716e5f5ef2efa92c431d2b5712f2fba64208df5d1da1965525a2ff94`

## Run the V3 verification

After dependencies are installed:

```bash
npm run verify:mlb-k-v3
```

For normal development:

```bash
npm install
npm run dev
```

## Current model-governance state

At initial deployment, historical rows do not contain V3 feature vectors, so the boosted challenger correctly begins in **evidence collection** rather than treating legacy records as training data. New authentic pregame V3 snapshots will build the dataset prospectively.
