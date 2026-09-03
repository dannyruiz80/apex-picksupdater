# Apex Picks — Sports Intelligence & Predictive Analytics

Current engine version: **1.10.0**

This build contains the hardened ML architecture developed across V1–V5:

- **Prediction Contract V1 + Central Recommendation Gate** — immutable recommendation identity, provenance, price/event integrity, and fail-closed BET/PASS decisions.
- **ML Engine V2** — point-in-time feature proof, leakage rejection, chronological walk-forward validation, and evidence-gated probability calibration.
- **MLB Pitcher Strikeouts V3 Shadow** — workload/BF modeling, Negative-Binomial strikeout distribution, authentic MLB/Statcast context, and chronological boosted challenger.
- **V4 Champion / Challenger Model Arena** — prospective production-vs-V3 monitoring, CLV, calibration, cohorts, and manual-only promotion gates.
- **V5 Fast Learning / Evidence Engine** — exact-count scoring, cluster-weighted multi-line learning, paired sequential evidence, public-MLB all-starter shadow capture, and historical date-censored replay.
- **Decision Board V1.10** — home-screen and Picks-page ranked production-qualified recommendations, zero-credit saved-pick lookup, capped explicit slate scans, and one-click event analysis.

## Integrity rule

V5 learns faster by extracting more information from each verified pitcher start. It does **not** make one game count as several independent outcomes.

Automatic production promotion remains disabled.

## Documentation

- `ML_ENGINE_HARDENING_V1.md`
- `ML_ENGINE_V2.md`
- `ML_ENGINE_V3_MLB_PITCHER_K.md`
- `ML_ENGINE_V4_CHAMPION_CHALLENGER.md`
- `ML_ENGINE_V5_FAST_LEARNING.md`
- `DECISION_BOARD_V1_10.md`
- `DECISION_BOARD_VERIFICATION_1_10.md`

## Run locally

Prerequisite: Node.js

```bash
npm install
npm run dev
```

V5 automatically captures and grades confirmed MLB probable-starter forecasts using public MLB data while the server is running. It never uses the keyed Odds API for this learning loop.

To disable it:

```env
APEX_V5_AUTO_STARTER_LEARNING=false
```

## Verification

```bash
npm run verify:recommendation-gate
npm run verify:ml-v2
npm run verify:mlb-k-v3
npm run verify:champion-challenger
npm run verify:mlb-k-v5
```

## Model Arena

Open **Audit → MODEL ARENA: CHAMPION / CHALLENGER**.

The V5 panel adds:

- independent-start count;
- number of legitimate line thresholds evaluated;
- paired probability V3 is better;
- evidence ladder;
- exact-count NLL and CRPS;
- all-starter capture/grade status;
- historical point-in-time replay controls.

Historical replay is research-only and cannot satisfy prospective promotion or CLV gates.
