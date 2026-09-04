# Apex Picks v1.14.7 — Rare-Event Prop / Longshot Integrity Revision

## Problem isolated during live verification
Provider-first MLB prop cards exposed false-positive OVER recommendations on rare batter home-run markets such as OVER 1.5 HR at extremely long prices (+27500 to +42500). The cards showed 0% recent over rates and very low season averages, but APEX_BASELINE_V1 repeatedly displayed exactly 12.0% P(Over).

## Root cause
1. `APEX_BASELINE_V1` used a global 12%-88% probability clamp for every prop market. For genuine sub-1% rare-event tails, the 12% minimum floor inflated the model probability by orders of magnitude.
2. Batter-home-run tails were estimated with a normal approximation, which is inappropriate for rare non-negative count outcomes such as 2+ HR.
3. Single-sided sportsbook quotes were being labeled as "no-vig" even though no-vig normalization is impossible without the opposite side.
4. The inflated 12% floor combined with a +30000/+40000 price created huge artificial edge/EV and could pass the production gate.

## Integrity changes
- `batter_home_runs` uses a Poisson tail distribution for count probabilities.
- Rare batter-HR probabilities use near-open bounds (0.01%-99.99%) instead of the legacy 12%-88% clamp.
- Single-sided quotes retain raw implied probability for audit only; no-vig probabilities are null and the price is excluded from model blending.
- Two-sided over/under count markets are required for production auto-qualification. Naturally one-sided markets (e.g. anytime TD / anytime goalscorer) remain exempt.
- A selected side cannot auto-qualify if its probability was artificially increased by a model bound (`MODEL_BOUND_DRIVEN`).
- UI displays the actual market-specific probability bounds and clearly marks single-sided no-vig anchoring as unavailable.

## Unchanged
- 3 pp minimum edge threshold.
- 3% minimum EV threshold.
- Player identity, provenance, freshness, point-in-time and pregame gates.
- Best-execution-only provider-first recommendation logic.
- No synthetic/fallback recommendations.
