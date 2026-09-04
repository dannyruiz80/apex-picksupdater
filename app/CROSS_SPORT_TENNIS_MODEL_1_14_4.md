APEX PICKS 1.14.4 — CROSS-SPORT TENNIS MATCH-WINNER MODEL
==========================================================

Scope
-----
1. Tennis is no longer excluded from the Picks / Scan Slate path simply because Tennis player props are not connected.
2. Adds APEX_TENNIS_MATCH_WINNER_V1 for pregame ATP/WTA match-winner probability.
3. Raw Tennis probability is derived from completed ESPN tennis match history before the event start time.
4. Sportsbook prices remain downstream comparison inputs only: no-vig consensus, executable break-even, edge, EV, freshness and market depth.
5. The existing production gates are preserved: at least MODERATE history reliability, 2 fresh books, >=3.0 percentage-point guarded edge, >=3.0% guarded EV, positive EV and valid pregame timing.
6. Tennis spreads, totals and player props remain fail-closed. v1.14.4 only promotes verified match-winner moneylines.
7. Soccer EARLY_EVIDENCE_SHRINKAGE_ACTIVE and V2_NO_MATERIAL_ADJUSTMENT remain internal risk-control context but are no longer counted as displayed rejection blockers. Actual edge, EV, reliability and integrity failures remain visible.
8. Broad ALL SPORTS round-robin scan behavior remains intact; recommendation thresholds are not reduced to manufacture cross-sport picks.

Tennis model notes
------------------
- Uses up to 24 calendar days of prior ESPN ATP/WTA scoreboard history, cached locally in memory.
- Recent match outcomes are recency weighted and Bayesian-shrunk toward 50% for small samples.
- Same-surface history is blended only when at least 4 verified prior matches on that surface exist for a player.
- Matchup probability uses a tempered Bradley-Terry/logit transform and is bounded to avoid early-model extremes.
- Qualification remains EARLY_EVIDENCE and uses conservative decision-probability shrinkage toward multi-book no-vig consensus after the raw forecast is produced.

Verification
------------
npm run verify:cross-sport-tennis
npm run lint
npm run build
