# Apex Picks 1.11.0 — Independent Game Market Model V1

## Purpose
Apex now produces independent pregame probabilities for team-game MONEYLINE, SPREAD and TOTAL markets instead of treating raw sportsbook markets as picks.

## Supported sports
- MLB
- NFL
- NBA
- WNBA
- NHL
- Soccer competitions already normalized by Apex, plus Liga MX (`mex.1` / `soccer_mexico_ligamx`)

Tennis remains on its separate player/match model path. NCAAF is not silently mapped into NFL; it needs its own normalized adapter/model before activation.

## Independence rule
`APEX_GAME_MARKET_V1` uses public ESPN completed team-game history only for forecasting. Sportsbook prices are not model features.

Odds enter only after the forecast to calculate:
- executable break-even probability
- expected value
- model edge
- best price
- multi-book market depth
- no-vig consensus for comparison only

## Point-in-time feature rules
- Only games with start timestamps strictly before the target event are used.
- Only completed historical games are accepted.
- Current-season history is preferred.
- Prior-season history is used only when the current season does not provide enough completed games.
- Future or scheduled games are ignored even if they exist in the public schedule payload.

## Forecast design
For MLB/NFL/NBA/WNBA/NHL:
- recency-weighted scoring offense
- recency-weighted scoring defense
- home/away split when sample size is adequate
- pooled shrinkage to reduce small-sample extremes
- empirical margin and total variance with conservative sport-specific uncertainty floors
- Normal-distribution probability mapping for ML/spread/total
- continuity-corrected push mass for integer spread/total lines

For Soccer:
- recency-weighted scoring and conceding rates
- home/away splits with shrinkage
- independent Poisson home/away goal distributions
- explicit home/draw/away probabilities
- exact score-grid spread/total/push probabilities

## Recommendation gate
A game-market candidate requires all of the following:
- UPCOMING verified event
- point-in-time-valid model features
- at least MODERATE team-history reliability (12+ usable games per team)
- current price no older than 10 minutes
- at least 2 fresh sportsbooks supporting the exact outcome/line
- model edge >= +3.0 percentage points
- EV >= +3.0%
- positive EV

The highest price from the fresh exact-line group is used for executable EV.

## Model maturity
Game market cards are explicitly labeled `GAME MODEL · EARLY EVIDENCE`.

This label is intentional. A model can generate mathematically qualified recommendations before it has enough prospective evidence to make a calibration/promotion claim. Existing player-prop models remain labeled separately and rank ahead on equal reliability until the game model earns prospective maturity.

## Prospective learning
Every eligible game-market evaluation is saved separately to:

`data/gameMarketPredictionSnapshots.json`

The ledger records all evaluated outcomes, not only qualifying bets. This avoids selection-bias training.

Repeated refreshes do not inflate evidence: performance reporting uses the earliest graded snapshot per event/market/side/line.

After games become FINAL, a public-data grading cycle records:
- WIN / LOSS / PUSH
- flat-stake profit
- Log Loss
- Brier score
- mean predicted probability
- actual hit rate
- calibration gap
- qualified-play flat-stake ROI

Automatic grading runs hourly and consumes **0 keyed Odds API requests**.

Status endpoint:
`GET /api/ml/game-markets/v1/learning-status`

Manual grade trigger:
`POST /api/ml/game-markets/v1/grade`

Verification endpoint:
`GET /api/ml/game-markets/v1/verify`

## Verification
Deterministic game-model suite:
- point-in-time future-game exclusion
- normal probability symmetry
- independent game candidate generation
- two-book market-depth gate
- stale-price rejection
- no-vig market consensus kept separate from model probability

Verification consumes 0 keyed provider requests.

Existing suites remain unchanged and passing, including Prediction Contract/Gate, ML V2, MLB K V3, Champion/Challenger, MLB K V5, probability, value, backtest and persistence.

## Limitations deliberately not hidden
V1 does not yet include sport-specific lineup/injury/starting-pitcher/goalie/pace/weather feature models for every team sport. Those should be added as verified feature modules and tested as challengers rather than inserted as synthetic adjustments.
