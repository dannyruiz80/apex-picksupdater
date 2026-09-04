# Apex Picks v1.14.9 — NFL + NCAAF Production Expansion

## Purpose
Promote NFL game markets to a hardened production path and add NCAA FBS football as a first-class Apex schedule/live/game-market sport without weakening recommendation gates or fabricating college player-prop coverage.

## NFL production hardening
- NFL schedule/live state now exposes explicit `pregameBetEligible` and `eventVisibleInLive` flags.
- Current/live NFL scoreboard polling requests ESPN without a forced date first, with an America/Chicago dated fallback only when needed.
- Live/final/suspended NFL events stay visible where appropriate but remain fail-closed for pregame recommendations.
- NFL production score projections use point-in-time team history plus a bounded recent-five scoring contribution (maximum 16%).
- Sportsbook prices never enter the independent expected-score or raw win-probability calculation.

## NCAAF / FBS production path
- Adds `NCAAF` as an Apex sport across Picks, Win Probability, Live, Props filters, Parlays, Audit, and ALL SPORTS coverage.
- Schedule/live ingestion uses ESPN college-football scoreboard data restricted to FBS (`groups=80`) with a broad event limit for Saturday slates.
- Game-market provider mapping uses `americanfootball_ncaaf`.
- Historical team results use ESPN college-football team schedules with point-in-time filtering.
- NCAAF score projections use a more conservative recent-five contribution (maximum 12%) and wider uncertainty floors to reflect college-football variance and roster/coaching turnover.
- Moneyline, spread, and total markets use the existing production identity, freshness, market-depth, probability, edge, EV, disagreement, and pregame-state gates.

## Player-prop integrity
NCAAF player props remain explicitly fail-closed in v1.14.9. Apex does not expose synthetic or unverified college player-prop recommendations. Player props will be enabled only after roster identity, historical stat provenance, current market line, and executable price support are independently verified.

## Coverage semantics
- NFL/NCAAF `EARLY_EVIDENCE_SHRINKAGE_ACTIVE` remains an internal confidence-control diagnostic and is not displayed as a standalone rejection blocker.
- NCAAF can show `PARTIAL` production coverage because game markets are connected while player props remain intentionally unsupported.

## Guardrails preserved
- 3 percentage-point edge minimum unchanged.
- 3% EV minimum unchanged.
- No synthetic schedules, scores, historical team results, sportsbook prices, or recommendation probabilities are introduced.
- Current sportsbook prices remain economic/decision inputs only and do not create the underlying score forecast.
- Live/final games cannot become pregame recommendations.

## Verification
`npm run verify:football-1-14-9`

The fixture verifies:
1. NFL upcoming/live state separation.
2. NCAAF FBS identity and live-state normalization.
3. Fail-closed pregame state after kickoff.
4. Point-in-time NFL/NCAAF historical score projections.
5. Bounded recent-five contributions.
6. Wider NCAAF uncertainty floors.
7. Two-way probability complements.
8. NFL/NCAAF sportsbook game-market keys.
9. NCAAF player-prop fail-closed behavior.
10. NCAAF inclusion in ALL SPORTS coverage.
11. Football shrinkage diagnostics remain informational rather than false blockers.
