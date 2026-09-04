# Apex Picks 1.13.0 — Calibration Learning + Parlay Lab

## Prospective game-market calibration learning

Apex now learns calibration separately for every supported **sport + market type** (MONEYLINE, SPREAD, TOTAL). It scores only the earliest graded pregame snapshot per event/market/side/line so repeated refreshes cannot inflate the evidence sample.

Metrics include independent decisive outcomes, calibration gap, 5-bucket ECE, Brier score, log loss, and evidence tier (EARLY / DEVELOPING / MODERATE / MATURE).

The raw independent sports-model probability remains immutable. After at least 30 decisive outcomes, a bounded prospective calibration correction may adjust only the guarded decision probability. The correction grows gradually with sample size and is capped at 5 percentage points. Poor ECE/Brier/calibration reduces model trust weight rather than increasing it.

Automatic final-score grading remains active through the existing hourly public-score learning cycle and consumes zero keyed Odds API requests.

## Parlay Lab V1.13

The Parlay tab is now active. Recommended tickets are generated only from production-qualified legs and require:

- current point-in-time-valid pregame leg;
- fresh price (10 minutes or less);
- GAME_MARKET integrity status QUALIFIED for ML/spread/total legs;
- one common sportsbook offering the exact side/line for every leg;
- distinct events only (same-event parlays fail closed);
- no integer push-sensitive spread/total/prop lines in auto-generated tickets;
- positive ticket EV under the explicitly labeled independence baseline.

Apex does not claim a precise correlated fair probability without a validated joint model. Same-event parlays are blocked, and distinct-event combined probability is labeled an independence baseline.

Suggested ticket stake uses quarter-Kelly converted to units and is capped at 0.25u if any early-evidence game-market leg is present, otherwise 0.50u. Extreme combined EV is REVIEW, not an automatic recommendation.

## Verification

- Central Recommendation Gate: 6/6 PASS
- ML Engine V2: 7/7 PASS
- MLB Pitcher K V3: 11/11 PASS
- Champion/Challenger: 8/8 PASS
- MLB K V5: 10/10 PASS
- Game Market Integrity + Calibration: 12/12 PASS
- Game Calibration Repository: 6/6 PASS
- Parlay Engine: 7/7 PASS
- Probability Engine: 10/10 PASS
- Value Engine: 16/16 PASS
- Backtest Engine: 16/16 PASS
- Persistence: 15/15 PASS
- Keyed provider calls in deterministic verification: 0
- Historical prop ledger SHA-256 unchanged: 45d20f30716e5f5ef2efa92c431d2b5712f2fba64208df5d1da1965525a2ff94
