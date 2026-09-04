# Apex Picks 1.14.7 — Tennis Probability / Market Alignment Audit

## Purpose
v1.14.7 does not lower recommendation thresholds or manufacture Tennis picks. It hardens and audits the exact probability-to-market alignment path exposed by v1.14.6.

## Integrity changes
- Verifies Apex player A/player B remain aligned to the Tennis away/home adapter identity before any recommendation evaluation.
- Requires each sportsbook H2H quote to resolve to exactly one player on each side; ambiguous surname-only or duplicate outcomes are ignored/fail-closed.
- Verifies raw model probabilities form a valid two-way complement.
- Verifies aggregated no-vig market probabilities form a valid two-way complement.
- Adds an 8 percentage-point cross-book no-vig dispersion guard so internally inconsistent market snapshots cannot qualify.
- Calculates model-vs-market disagreement once at the event level. Because valid two-way probabilities are complementary, the same disagreement previously appeared once for each side and inflated coverage blocker counts.
- `MODEL_MARKET_DISAGREEMENT_EXTREME` remains VERIFY/fail-closed at 12 pp; heightened disagreement remains REVIEW/fail-closed at 8 pp.
- 3 pp edge and 3% EV recommendation thresholds are unchanged.
- Raw Tennis probability remains independent from sportsbook prices. Market consensus is still used only after forecasting as a decision guardrail.

## Expected live interpretation
If v1.14.7 shows fewer `MODEL_MARKET_DISAGREEMENT_EXTREME` counts than v1.14.6, part of that change is diagnostic correctness: disagreement is now counted once per match, not twice for both sides. Any remaining extreme-disagreement events are genuine model-vs-market calibration cases after structural side/complement checks pass.
