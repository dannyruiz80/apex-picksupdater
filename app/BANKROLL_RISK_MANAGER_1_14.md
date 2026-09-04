# Apex Picks 1.14.0 — Bankroll & Risk Manager

## Purpose
Convert Apex unit recommendations into dollar stakes tied to the user's current bankroll while keeping stake sizing separate from prediction qualification.

## Core rules
- Bankroll state is stored locally in `app/data/bankrollState.json`.
- `1u` defaults to 1% of current bankroll and is configurable.
- Dollar stakes are calculated from the current bankroll at recommendation time.
- A bet can be reduced or blocked by:
  - per-bet unit cap,
  - daily gross-risk cap,
  - maximum open-exposure cap.
- Bankroll size never changes whether a model pick/parlay qualifies; it only changes stake sizing.
- Open bets are tracked separately from realized bankroll.
- On settlement, wins add profit, losses subtract stake, pushes/voids leave bankroll unchanged.

## Parlay integration
Parlay cards show:
- raw model ticket units,
- exposure-adjusted units,
- dollar stake,
- current 1u dollar value,
- bankroll snapshot,
- any risk-cap reason.

`Track This Bet` records the actual exposure after rechecking risk limits at placement time.

## My Bets
The former scaffold is replaced by an active Bankroll & Bet Tracker with:
- current bankroll,
- unit percentage,
- daily-risk percentage,
- open-exposure percentage,
- max straight-bet units,
- max parlay units,
- open tracked wagers,
- settlement controls,
- realized P/L.

## Integrity
Bankroll data does not enter the probability model and cannot manufacture an edge. It is a risk-management layer only.
