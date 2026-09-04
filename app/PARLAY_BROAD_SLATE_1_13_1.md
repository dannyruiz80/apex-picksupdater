# Apex Picks 1.13.1 — Broad Slate Parlay Discovery

## What changed

### Broader discovery window
- Parlay scans now target 10 upcoming events by default and allow up to 12.
- If the selected date is late or sparse, the server checks forward up to 7 schedule days until enough upcoming events are available.
- ALL SPORTS uses round-robin sport selection before repeating one sport.

### Provider-credit protection
- Fresh saved qualified recommendations seed the scan first at zero provider credits.
- A 5-minute in-memory slate cache prevents repeated clicks and 2-leg/3-leg/4-leg changes from refetching the same live slate.
- Cached quotes are rechecked for freshness before they can remain eligible.
- Live evaluations remain sequential and behind the existing quota guard.

### Better parlay construction
- The first construction pass uses only the strongest qualified leg from each event.
- Alternative legs from an event are considered only when the preferred one-leg-per-event pool cannot produce a qualified ticket.
- Same-event tickets remain fail-closed.
- One common sportsbook must offer every exact leg.

### Decision funnel
The Parlay Lab now reports:
- events considered
- events seeded from saved/cache data
- live events evaluated
- distinct eligible events
- possible independent combinations
- common-sportsbook combinations
- qualified tickets
- review tickets

### Straight-bet fallback
When no parlay qualifies, Apex now shows the three strongest distinct-event straight alternatives rather than ending at a blank PASS result.

## Integrity rules preserved
- only production-qualified legs
- no same-event parlays without a validated joint model
- stale prices rejected
- push-sensitive integer lines excluded from auto parlays
- independence probability clearly labeled
- quarter-Kelly ticket sizing with 0.25u early-model cap / 0.50u normal cap
