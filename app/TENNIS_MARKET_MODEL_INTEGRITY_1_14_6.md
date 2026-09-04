# Apex Picks v1.14.6 — Tennis Market + Model Coverage Integrity

v1.14.6 tightens the production Tennis match-winner path without lowering recommendation thresholds or manufacturing picks.

## Changes

- Decision-board Tennis eligibility is singles-only and requires two resolved individual participants.
- Doubles and TBD bracket placeholders remain visible in Tennis schedule/live data but are excluded before model and odds requests.
- ESPN historical model input is restricted to completed singles for the correct ATP/WTA competition type.
- Historical lookback expands adaptively from 30 to at most 120 days only when needed to preserve the existing minimum-six-match evidence requirement per player.
- Tennis provider sport-key selection is tour-aware and tournament-aware using generic token matching instead of a small hardcoded tournament list.
- Abbreviated sportsbook player names are resolved with an ambiguity margin; ambiguous surname mappings remain fail-closed.
- Extreme model-vs-market disagreement remains a VERIFY/fail-closed condition.
- Existing 3 percentage-point edge and 3% EV production thresholds are unchanged.
- Tennis spreads, totals, doubles, and player props remain fail-closed.
- Existing provider quota guard, cache, and deduplication behavior is preserved.

## Installation behavior

The updater stores rollback backups outside the Git repository under `Documents\\ApexPicks Backups`, so future patch backups do not appear as Git changes.
