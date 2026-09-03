# Apex Picks 1.10 — Decision Board Verification

## New workflow

- Home screen Decision Board: PASS
- Picks page Decision Board: PASS
- Zero-credit saved-board lookup: implemented
- Explicit capped slate scan: maximum 3 events from UI, backend hard cap 5
- ALL SPORTS diversification: distinct model-supported sports sampled first
- Per-event Analyze for Best Pick: server re-verifies event identity against public schedule
- Deep link from ranked pick to full Props analysis: implemented
- Raw sportsbook markets demoted to secondary evidence
- Tennis explicitly labeled as independent pick model pending

## Recommendation safety

A ranked pick must already be a production `QUALIFIES` recommendation. The Decision Board does not create a new probability or lower any threshold.

Saved picks additionally require:

- `REAL_PREGAME`
- `ELIGIBLE`
- `VERIFIED`
- `PENDING`
- point-in-time proof = true
- future event start
- quote age <= 10 minutes

## Ranking

Within already-qualified picks:

1. sample reliability
2. model probability
3. expected value
4. edge

Latest identical proposition state is deduplicated before ranking.

Decision Board ranking/dedup verification: **3 / 3 PASS**.

## Existing regression suites

- Prediction Contract / Central Gate: **6 / 6 PASS**
- ML Engine V2: **7 / 7 PASS**
- MLB Pitcher K V3: **11 / 11 PASS**
- Champion / Challenger V4: **8 / 8 PASS**
- V5 Fast Learning: **10 / 10 PASS**
- Probability Engine: **10 / 10 PASS**
- Value Engine: **16 / 16 PASS**
- Backtest Engine: **16 / 16 PASS**
- Persistence Engine: **15 / 15 PASS**

Keyed Odds API requests used by deterministic verification: **0**.

Production historical ledger remained unchanged:

`45d20f30716e5f5ef2efa92c431d2b5712f2fba64208df5d1da1965525a2ff94`

## Self-update hardening

The updater now accepts both common GitHub release layouts:

- `app/package.json` inside the archive; or
- `package.json` at the archive root.

Updates continue to preserve local `.env`, `data/`, and reinstall dependencies only when required.
