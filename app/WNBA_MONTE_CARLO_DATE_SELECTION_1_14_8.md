# Apex Picks v1.14.8 — WNBA Monte Carlo Date Selection Revision

## Purpose
The WNBA 25,000-trial simulator previously depended on the globally loaded/current application slate. During the September World Cup break this left the simulator disabled even though verified future WNBA games existed on September 17.

## Revision
- Sims → WNBA Game Model now has its own `YYYY-MM-DD` simulation-slate date selector.
- `Load Date` retrieves the verified public WNBA schedule for that exact date independently of Picks.
- The lookup uses the public schedule and consumes zero keyed Odds API credits.
- Only `UPCOMING`, pregame-bet-eligible WNBA events are selectable for simulation.
- LIVE, FINAL, postponed/ineligible, non-WNBA, or identity-incomplete events remain excluded.
- Selecting a date never fabricates sportsbook lines and never changes the Monte Carlo scoring distribution.
- The 25,000-trial button enables only after a verified eligible game has been selected.

## Integrity
This fixes slate/date handoff only. Historical calibration, no-look-ahead logic, production probability gates, edge/EV thresholds, sportsbook market integrity, and all existing fail-closed rules are unchanged.
