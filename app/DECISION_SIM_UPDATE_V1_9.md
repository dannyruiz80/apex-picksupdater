# Apex Picks 1.9 — Decision-First / Verified Sims / Update Architecture

## Decision-first UI
The Player Props module now places the production recommendation decision before the long-form analytics. Qualified opportunities are ranked by production model probability, with expected value as the tie-breaker. A NO BET slate is surfaced explicitly as PASS.

## Verified Monte Carlo coverage
The Sims module is active for MLB pitcher strikeouts when APEX_PITCHER_K_V3_SHADOW has a point-in-time-valid Negative-Binomial distribution. Each quote uses 10,000 deterministic pseudo-random draws from that validated distribution. The simulation is reproducible and labeled shadow corroboration. It cannot promote or override a production NO BET.

Full game moneyline/spread/total simulations remain fail-closed until independent team-strength and game-environment models are connected. Sportsbook probabilities are not relabeled as an independent simulation model.

## In-place updater
The distribution separates permanent launcher/updater files from the replaceable `app/` directory. GitHub Releases are the supported update source. The updater preserves `.env`, `data/`, and local secrets/history while replacing application code. `node_modules` is refreshed after a successful update.

The expected release asset is `apex-picks-windows-app.zip`. A GitHub Actions workflow is included to create/upload that asset on tagged releases or manual workflow runs.
