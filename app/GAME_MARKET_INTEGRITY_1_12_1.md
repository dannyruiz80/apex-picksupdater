# Apex Picks 1.12.1 — Game Market Integrity Gate

## Purpose

Version 1.12.1 hardens the independent moneyline, spread, and total model before it can promote a game-market recommendation.

The raw sports probability remains independent of sportsbook prices. Sportsbook no-vig consensus is used only as a conservative decision-risk reference while the game model is in EARLY_EVIDENCE status.

## Raw forecast vs guarded decision probability

Every game-market candidate now records both:

- `modelProbability`: raw independent sports-model probability.
- `decisionProbability`: conservative probability used for recommendation qualification.

The decision probability is shrunk toward multi-book no-vig consensus while prospective evidence is still immature. The model weight grows only as independent graded evidence accumulates. Evidence is separated by sport and market type, so MLB totals cannot mature NFL moneylines.

## Integrity states

- `QUALIFIED`: clears the standard value gate and all integrity checks.
- `REVIEW`: heightened disagreement or guarded EV; not a bet.
- `VERIFY`: extreme disagreement, extreme guarded EV, large V2 directional flip, or cross-market inconsistency; not a bet.
- `PASS`: normal recommendation requirements are not met.

## Model-vs-market disagreement

- 8 percentage points or more: REVIEW.
- 12 percentage points or more: VERIFY.

The disagreement is measured against the raw independent model, not the guarded probability, so shrinkage cannot hide a model/market conflict.

## EV sanity tiers

Using guarded decision probability:

- below +10%: NORMAL.
- +10% to below +20%: HEIGHTENED / REVIEW.
- +20% or greater: EXTREME / VERIFY.

These are integrity guardrails, not backtest-optimized profitability thresholds.

## Cross-market consistency

Apex checks the same-event distribution for:

- home/away/draw moneyline probability sum,
- monotonic spread-cover probability as the point becomes more favorable,
- monotonic over/under probability as the total line changes.

Violations are forced to VERIFY.

## V2 context audit

The MLB/NFL V2 shadow remains audit-only. Every candidate labels its V2 contribution as:

- MATERIAL,
- NO_MATERIAL_ADJUSTMENT,
- UNAVAILABLE.

A directional disagreement holds the candidate for REVIEW, and a large directional flip forces VERIFY.

## Prospective evidence

New game-market snapshots preserve raw model probability, guarded decision probability, shrinkage weight, market disagreement, raw/guarded EV, integrity status, cross-market consistency, and V2 contribution. This allows later calibration analysis without reconstructing the original decision state.
