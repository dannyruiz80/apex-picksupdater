# Apex Picks v1.14.8 — WNBA Historical Backtest + Monte Carlo Revision

## Purpose
This revision strengthens the WNBA production model with real historical evidence without treating simulation trials as new observations.

## Historical walk-forward replay
- Uses completed WNBA team schedule history from ESPN public endpoints.
- Replays games chronologically with a prior-season warm-up window.
- Every prediction uses only games completed strictly before the target event.
- Requires at least six prior completed games for both teams.
- Reports Brier score, log loss, expected calibration error, home-win calibration gap, score/margin/total errors, and season breakdowns.
- Persists the latest report to `data/wnbaHistoricalBacktest.json`.

## Evidence rules
- One completed historical WNBA game = one independent moneyline calibration observation.
- Monte Carlo trials do **not** increase the evidence sample size.
- At least 30 leakage-free historical games are required before historical moneyline evidence can affect live decision shrinkage.
- Historical moneyline evidence may adjust only the WNBA MONEYLINE evidence weight.
- Spread/total betting calibration remains prospective until authentic archived sportsbook lines are available.
- Historical EV/ROI is explicitly unavailable when authentic archived lines/prices are absent. Apex never inserts synthetic -110 prices.

## Monte Carlo
- `APEX_WNBA_MONTE_CARLO_V1`
- Uses the same production expected-score, margin, total, and uncertainty projection used by Picks.
- Default current-game simulation: 25,000 trials.
- Historical replay uses a bounded 2,000 trials per game for scenario-probability verification.
- Deterministic seeded random generator for reproducible results.
- Sportsbook prices never enter score simulation.

## Coverage semantics
`EARLY_EVIDENCE_SHRINKAGE_ACTIVE` remains an internal risk-control diagnostic for WNBA but is no longer displayed as a blocking rejection reason. Actual edge, EV, market-depth, reliability and integrity failures remain visible.

## Production thresholds
No recommendation thresholds were lowered. Existing 3 pp edge, 3% EV, market depth, pregame state and integrity gates remain authoritative.
