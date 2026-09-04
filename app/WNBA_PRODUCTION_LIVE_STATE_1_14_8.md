# Apex Picks v1.14.8 — WNBA Production Model + Live-State Integrity

## Purpose
Move WNBA from generic team-sport support toward a first-class production path without weakening value gates or fabricating live/market data.

## Changes
- WNBA schedule normalization now emits explicit `pregameBetEligible` and `eventVisibleInLive` state.
- WNBA live polling requests ESPN's current scoreboard without a forced date first, with an America/Chicago dated fallback only when needed.
- WNBA live updates now carry verified team/event identity so the Live module can surface a current WNBA game even if the selected schedule date does not already contain it.
- The Live module merges verified live events into the displayed slate rather than requiring a pre-existing schedule-card identity match.
- WNBA game modeling now uses a bounded recent-five scoring blend on top of the existing point-in-time season/venue baseline.
- WNBA context records recent 5/10 margin and total form, rest days, back-to-back state, and venue sample counts.
- Rest/back-to-back context is audit-only in this release; it does not independently create betting edge.
- Live/final WNBA events remain ineligible for pregame recommendations even when they remain visible in the Live module.

## Guardrails preserved
- 3 percentage-point edge minimum unchanged.
- 3% EV minimum unchanged.
- Current sportsbook prices do not enter the raw WNBA expected-score forecast.
- Existing market depth, freshness, point-in-time, disagreement, EV, and calibration gates remain active.
- No synthetic schedule, score, player, or market data is introduced.

## Verification
`npm run verify:wnba-1-14-8`

The fixture verifies:
1. Upcoming/live/final WNBA state separation.
2. Live score, quarter, and clock normalization.
3. Live event visibility when the selected schedule date lacks the event.
4. Point-in-time WNBA scoring projection availability.
5. Bounded recent-five contribution.
6. Explicit fail-closed pregame eligibility.
