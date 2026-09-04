# Apex Picks 1.14.7 — Parlay Handoff + Provider-First Prop Execution Integrity

## Parlay fixes
- Parlay Lab no longer hard-codes a 10-event request. Server default is 24 events with a 36-event ceiling.
- The complete production-qualified Picks-board slate is cached briefly and handed directly to Parlay Lab at zero provider credits.
- Recent qualified events are prioritized inside the cross-sport round-robin scan.
- A bounded alternative-leg fallback considers up to two strong legs per event across up to 16 events so common-book compatibility can recover without combinatorial explosion.
- 2-, 3-, and 4-leg requests still require distinct events, one common executable sportsbook, production QUALIFIED legs, at least 3% combined EV, and fail-closed correlation guardrails.

## Provider-first prop fixes
- A production-qualified prop recommendation is emitted only on the best available price for the exact player / market / line / side.
- Worse sportsbook quotes can remain visible as raw market evidence but are marked NO BET with `BETTER_PRICE_AVAILABLE` instead of appearing as separate qualified recommendations.
- The Decision Center deduplicates exact qualified recommendation identities so the same prop is not counted repeatedly across equivalent bookmaker quotes.
- Existing 3 pp edge, 3% EV, provenance, freshness, pregame, point-in-time, and reliability gates remain unchanged.
