# Apex Picks v1.14.9 — NFL/NCAAF Slate-Date Identity Revision

## Why this revision exists
NFL public scoreboard date queries can return a whole football week instead of only the exact selected calendar date. That is useful for schedule browsing but unsafe for a betting decision pipeline: a user selecting a date with no NFL game must never see a recommendation from another day in that week.

## Integrity contract
- The Picks date is authoritative in `America/Chicago`.
- NFL and NCAAF schedule results are filtered to that exact local calendar date before model or market evaluation.
- Decision-board and provider-first prop selectors independently enforce the same date identity.
- Sportsbook event linkage for NFL/NCAAF requires the provider event and canonical Apex event to resolve to the same local calendar date.
- A provider event that has already started cannot seed a new football prop recommendation.
- Saved football recommendations are read back only on the canonical local event date.

## Learning protection
The game-market prediction repository remains an immutable pregame snapshot / postgame grading ledger. This revision prevents wrong-date football events from entering that ledger through the decision path, protecting future calibration from stale-week contamination.

## Not changed
- 3 pp edge threshold
- 3% EV threshold
- NFL/NCAAF probability model formulas
- WNBA/Tennis/MLB/Soccer logic
- NCAAF player-prop fail-closed policy
- Git workflow / backups
