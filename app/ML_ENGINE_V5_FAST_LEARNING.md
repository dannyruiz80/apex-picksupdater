# Apex Picks — ML Engine V5 Fast Learning / Evidence Acceleration

## Purpose

V5 accelerates MLB Pitcher Strikeouts model learning **without lowering the V4 production-promotion standard or inflating the independent sample**.

The core principle is:

> Extract more information from each verified pitcher start, but still count one pitcher start as one independent sports outcome.

V3 remains shadow-only. V4 remains the manual-only promotion authority. V5 adds richer research and comparison evidence.

## What V5 adds

### 1. Exact strikeout-count scoring

The Negative-Binomial challenger is now evaluated against the exact final strikeout count, not only an Over/Under result.

Metrics:

- Negative Log Likelihood (NLL)
- Discrete CRPS
- Mean Absolute Error (MAE)
- Root Mean Squared Error (RMSE)
- Mean Error / directional bias
- Mean predicted strikeouts vs. mean actual strikeouts

This evaluates whether the **whole predicted count distribution** was plausible.

### 2. Clustered multi-line learning

If the same pitcher start legitimately has lines such as 5.5, 6.5 and 7.5, V5 evaluates all of them because each threshold contains useful calibration information.

However:

- repeated refreshes do not create new training rows;
- the first observed point-in-time row for each legitimate line is retained;
- every pitcher start has total booster weight **1.0**, divided across its observed lines;
- promotion evidence counts independent pitcher starts, not line rows.

Therefore three lines from one start provide richer threshold information but do not become three independent games.

### 3. Paired Champion vs. Challenger evidence

Production and V3 are compared on the exact same pitcher starts.

V5 reports:

- paired mean Log Loss delta;
- paired Log Loss standard error;
- approximate 95% confidence interval;
- paired Brier delta and confidence interval;
- normal-approximation probability that V3 is better on paired Log Loss.

The comparison is clustered at pitcher-start level before the confidence calculation.

### 4. Evidence ladder

V5 surfaces useful information before the full V4 promotion sample is reached:

- 0–24 independent starts: `EARLY_EVIDENCE`
- 25–49: `DEVELOPING_SIGNAL`
- 50–79: `MODERATE_EVIDENCE`
- 80–119: `STRONG_EVIDENCE`
- 120+: `PROMOTION_TEST`

This ladder is informational. It does not promote the model.

### 5. All-eligible-starter shadow capture

Apex can create a sports forecast for every confirmed MLB probable starter that has sufficient verified workload history, even if no sportsbook prop qualifies as a bet.

Stored separately in:

`data/mlbPitcherKStarterShadow.json`

Guarantees:

- source: public MLB data;
- zero keyed Odds API calls;
- no invented sportsbook line or price;
- first valid pregame forecast is immutable;
- later refreshes cannot rewrite its feature vector or captured time;
- grading can append the verified final strikeout count;
- rejected early attempts can be replaced only by the first later valid pregame forecast.

### Automatic learning cycle

While the Apex server is running, all-starter learning is enabled by default.

The cycle:

1. Grades eligible completed starter forecasts from the public MLB box score.
2. Captures currently confirmed probable starters that have not started.
3. Preserves the first valid forecast.

Default interval: 60 minutes.

Environment controls:

```env
APEX_V5_AUTO_STARTER_LEARNING=true
APEX_V5_STARTER_LEARNING_INTERVAL_MINUTES=60
```

The interval has a 30-minute minimum to avoid aggressive public-feed polling.

### 6. Historical date-censored MLB replay

V5 can reconstruct prior pitcher starts using official MLB game logs and team hitting data with an `asOf` timestamp three hours before first pitch.

Stored separately in:

`data/mlbPitcherKHistoricalReplay.json`

The replay uses:

- prior pitcher game logs only;
- official batters faced;
- prior-date opponent strikeout rate;
- pitcher handedness;
- no future games;
- no sportsbook prices;
- no historical weather/umpire data that cannot be proven pregame.

Important limitation: MLB's current API can contain later official corrections to old box scores. Therefore this is a **date-censored historical reconstruction**, not a guaranteed archival copy of exactly what the API returned on that historical day. V5 consequently treats it as research/training evidence only.

Historical replay **cannot** satisfy:

- prospective promotion count;
- CLV coverage;
- live production promotion gates.

Each replay request is limited to 31 days to protect public MLB endpoints. Larger periods should be run in chunks.


## Final V5 acceleration hardening

The completed V5 build adds three operational safeguards around the public-learning loop:

### Public-response reuse

Official MLB JSON responses are cached in-memory for short, endpoint-appropriate windows.

This matters most during historical replay, where the same pitcher's season game log may be needed for several starts in a date range. The raw response may contain later games, but every workload row is still filtered locally to `gameDate < asOf` before it can enter a feature vector.

The cache therefore reduces repeated public requests without relaxing point-in-time filtering.

### Opening-week prior-season supplementation

If the current season has fewer than ten verified starts, V5 may supplement the rolling workload window with official prior-season starts.

The feature vector records this transparently with:

- `historySeasonsUsed`
- `priorSeasonStartsUsed`
- `strikeoutRateBasis`

When at least five current-season starts exist, the baseline K/BF rate remains current-season based. Otherwise it is explicitly labeled `ROLLING_MULTI_SEASON`.

This avoids throwing away trustworthy workload evidence in April while keeping the source basis auditable.

### Final-only grading

All-starter shadow outcomes are appended only after MLB reports the game `FINAL` or `COMPLETED`.

Elapsed time is never treated as proof that a game ended. This prevents delayed or extra-inning games from being graded from partial strikeout totals.

Repeated capture cycles also skip immutable `PENDING`/`GRADED` forecasts and apply a six-hour retry cooldown to rejected forecasts, materially reducing unnecessary public-feed requests.

## Booster hardening

`APEX_MLB_K_GB_STUMPS_V3` now learns `P(OVER | NO PUSH)` from cluster-weighted line observations.

Key changes:

- repeated refreshes are deduplicated;
- legitimate lines from a start share total weight 1.0;
- train/validation splitting is done by independent pitcher-start cluster;
- the minimum 80-row requirement now means **80 independent starts**, not 80 line rows;
- training and validation losses are weight-aware;
- integer-line push mass remains outside the boosted conditional probability and is restored afterward.

## Production promotion remains harder than research learning

V5 does **not** lower V4 promotion thresholds.

The V4 promotion gate now explicitly uses independent prospective pitcher starts for its observation requirements.

Historical replay and all-starter count forecasts can improve model research and count-distribution diagnostics, but they cannot independently replace `APEX_BASELINE_V1`.

Automatic production promotion remains disabled.

## API endpoints

### Fast-learning evidence

`GET /api/ml/mlb/pitcher-k/v5/evidence`

### V5 deterministic verification

`GET /api/ml/mlb/pitcher-k/v5/verify`

### Capture today's probable starters

`POST /api/ml/mlb/pitcher-k/v5/capture-starters`

Optional body:

```json
{ "date": "2026-09-03" }
```

### Grade completed starter forecasts

`POST /api/ml/mlb/pitcher-k/v5/grade-starters`

### Starter-learning cycle status

`GET /api/ml/mlb/pitcher-k/v5/starter-learning/status`

### Historical replay

`POST /api/ml/mlb/pitcher-k/v5/historical-replay`

Example:

```json
{
  "startDate": "2025-04-01",
  "endDate": "2025-04-30"
}
```

## Model Arena UI

Audit → Model Arena now includes a **V5 Fast Learning / Evidence Engine** section showing:

- independent prospective starts;
- legitimate line thresholds scored;
- probability V3 is better on paired Log Loss;
- evidence tier;
- paired 95% Log Loss interval;
- exact-count NLL / CRPS;
- total count-scored starts;
- all-starter captured / graded / pending counts;
- historical replay count;
- manual replay controls;
- starter capture and grading controls;
- V5 zero-quota verification.

## Verification

Final deterministic V5 suite:

- V5 Fast Learning: **10 / 10 PASS**
- Prediction Contract / Gate: **6 / 6 PASS**
- ML Engine V2: **7 / 7 PASS**
- MLB K V3: **11 / 11 PASS**
- Champion / Challenger V4: **8 / 8 PASS**
- Probability Engine: **10 / 10 PASS**
- Value Engine: **16 / 16 PASS**
- Backtest Engine: **16 / 16 PASS**
- Persistence: **15 / 15 PASS**
- Changed backend TypeScript compile: **PASS**
- Model Arena V5 TSX compile: **PASS**
- Keyed Odds API calls used by deterministic verification: **0**

The source production historical ledger remained byte-for-byte unchanged during verification:

`45d20f30716e5f5ef2efa92c431d2b5712f2fba64208df5d1da1965525a2ff94`

## External-source validation note

The deterministic and compile-time verification performed for this build does not prove live connectivity to the public MLB endpoints from every deployment environment. Public-source capture/replay code fails without fabricating data when MLB connectivity is unavailable.
