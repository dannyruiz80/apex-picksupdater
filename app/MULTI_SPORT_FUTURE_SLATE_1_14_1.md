# Apex Picks 1.14.1 — Multi-Sport / Future Slate Coverage

## Fixed
- Legacy Find Best Picks scan was hardcoded to 3 events.
- Future-date scans now request 10 events in ALL SPORTS and 8 in a single sport.
- Same-day scans use 8 events in ALL SPORTS and 6 in a single sport.
- Server supports up to 12 events per explicit scan.
- ALL SPORTS uses round-robin sport selection before repeating a sport.
- Decision Board now reports per-sport coverage: scheduled, scanned, model-ready and qualified picks.
- Filter state is shown explicitly so an MLB-only scan cannot be confused with All Sports.
- Game-market picks render their actual selection label instead of player-style formatting.
- Liga MX resolves to The Odds API sport key `soccer_mexico_ligamx`.

## Integrity
No recommendation thresholds were lowered. A sport can show model-ready with 0 picks when prices fail the active gates.
Future-date player props may legitimately be unavailable before sportsbooks post them; game markets remain independently evaluated.
