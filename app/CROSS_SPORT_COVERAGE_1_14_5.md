# Apex Picks v1.14.5 — Cross-Sport Coverage

## Purpose
v1.14.4 proved that Tennis match winner and Soccer can reach the production decision board, but a future ALL SPORTS slate could still scan only a tiny sample (for example 3 Tennis matches out of 96 scheduled). v1.14.5 fixes scan depth without lowering recommendation standards.

## Changes
- Picks ALL SPORTS scan requests up to 48 upcoming events instead of 8–10.
- Server and decision-board service accept a hard maximum of 48 events for this path.
- Existing round-robin sport ordering is preserved so one sport cannot consume every scan slot.
- Tennis-only scans request 24 events for today and 30 for a future slate.
- Other single-sport Picks scans request 10 today / 12 future.
- Narrow callers that explicitly request a small budget remain narrow.
- Recommendation edge, EV, integrity, and market/model disagreement gates are unchanged.
- Tennis remains match-winner only; spreads, totals, and player props remain fail-closed.

## Expected example
For a slate containing 16 MLB, 8 Soccer, and 96 Tennis events, a 48-event ALL SPORTS scan selects 16 MLB, 8 Soccer, and 24 Tennis events using the existing round-robin logic.

## Provider-credit note
This expands event evaluation depth, not the provider quota ceiling. Existing market-provider sport-key caching, deduplication, and quota guardrails remain intact.
