# Apex Picks v1.15.0 — Full Football Coverage + Context Learning

This milestone intentionally combines the remaining v1.14.9 football coverage fix with the next modeling workstream so development does not fragment into tiny patches.

## Football coverage
- NFL-only Picks scans evaluate the full selected NFL slate (up to 20 games), so a normal 14–16 game Sunday cannot silently leave games unevaluated.
- NCAAF single-sport scan budget is raised to 24 while ALL SPORTS retains the quota-controlled 48-event round-robin budget.
- v1.14.9 exact football date identity remains enforced.

## Immutable context-learning architecture
- MLB and Soccer game-market snapshots freeze verified context at prediction time.
- Postgame grading attaches the actual total and compares production total MAE with an audit-only context challenger.
- Only the earliest immutable snapshot per event counts toward context evidence; refreshes cannot inflate the sample.
- Context remains shadow-only until at least 30 graded events exist and challenger total MAE improves by at least 3%.

## MLB totals challenger
Pregame-only signals include probable-starter ERA/WHIP, recent bullpen workload, temperature, lineup/venue identity. Starter/bullpen/weather adjustments are strictly bounded and cannot directly qualify a wager in v1.15.0.

## Soccer totals challenger
Recent point-in-time scoring totals are always available when history is sufficient. For ESPN competitions exposing it, recent xG and shots-on-target are captured from completed prior match summaries and frozen pregame. Missing xG remains null; Apex never fabricates it.

## Visibility
Sims now includes a Context Learning panel showing frozen snapshots, graded events, production total MAE, challenger total MAE, improvement percentage and evidence status for MLB/Soccer.

## Safety
- Existing 3 pp edge / 3% EV gates are unchanged.
- Context cannot override production recommendations yet.
- Sportsbook prices never enter the raw score challenger.
- No synthetic context or historical prices are introduced.
