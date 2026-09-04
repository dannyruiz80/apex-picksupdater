# Apex Picks v1.16.0 — Context Learning V2 + Decision UX

## Purpose
This milestone turns the v1.15.0 context-learning shadow lane into a universal, deduplicated, walk-forward totals-learning framework while simplifying the main user experience around actionable betting decisions.

## Context Learning V2
Supported totals-learning sports:
- MLB
- Soccer
- WNBA
- NFL
- NCAAF

### Immutable learning identity
- Only the first pregame context snapshot for a canonical event can become context-learning evidence.
- Learning identity is canonical event + TOTAL + FIRST_PREGAME.
- Later quote refreshes can still be stored for market auditing but cannot increase the learning sample.
- Only real completed games count as evidence. Simulations never inflate sample size.

### Chronological / no-look-ahead learning
- Feature multipliers for a prediction may use only games that started and were graded before the target event.
- Future outcomes cannot teach earlier predictions.
- Learned multipliers are bounded from 0.65x to 1.35x and remain shadow-only.

### Promotion gate
A sport's context challenger can become promotion-eligible only when all are true:
- >=30 unique graded events
- >=3% full-sample total MAE improvement
- >=52% of games improved
- non-negative recent-window MAE improvement

Promotion eligibility does not automatically change production betting logic.

## Sport-specific totals features
### MLB
- starter ERA / WHIP run-prevention signal
- starter K-BB suppression
- starter HR/9 risk
- recent bullpen workload
- verified pregame temperature
- point-in-time empirical home-venue scoring factor
- starter x venue interaction
- HR-risk x venue interaction
- wind is captured but stays observe-only until direction is reliably structured

### Soccer
- recent xG total when genuinely available
- shots-on-target volume
- goalkeeper xG suppression
- shot-volume / transition proxy
- xG x shots-on-target interaction
- possession shape is observe-only until directional value is proven
- missing xG stays missing; it is never fabricated

### WNBA
- pace x offensive/defensive efficiency projected total
- recent total form
- fast-break / transition scoring context
- pace x transition interaction
- rest/back-to-back is frozen for audit but stays observe-only until validated

### NFL / NCAAF
- offensive pace / plays
- red-zone touchdown efficiency
- recent total scoring
- verified pregame wind suppression
- pace x red-zone interaction
- pressure/pass-rush remains UNAVAILABLE until an authentic verified source exists; no proxy is relabeled as pressure

## Postgame feature attribution
Each graded context snapshot records whether every active feature would have HELPED, HURT, or been NEUTRAL versus the frozen production total. That attribution becomes evidence only for later games.

## Decision UX pass
### Picks
- removes the misleading persistent Tennis stage badge and makes the mode sport-aware
- moves sport/date/slate controls ahead of the decision board
- adds persistent Sport / Slate / Data state in the desktop header
- qualified cards now show Pick / Probability / Price / Edge / EV / Data / suggested Stake context
- straight-bet stake previews use the existing bankroll risk guardrails; bankroll dollars are shown only when configured
- Coverage & Integrity is collapsed by default and expandable for development/audit detail

### Props
- default decision view shows the top 5 ranked quotes per market category
- users can expand to all props
- search/category/book/recommendation filters automatically expose all matching rows

### Parlays
- review-only tickets now explain the specific ticket-level reason in plain language
- unmodeled joint correlation remains fail-closed

### Sims / AI Learning
- Context Learning V2 dashboard shows all five supported sports
- unique evidence vs duplicate-suppressed counts are visible
- full-sample and recent-window gain are visible
- feature-level evidence, help rate, error gain, and learned multiplier are visible

## Integrity invariants
- 3 pp edge / 3% EV production thresholds are unchanged.
- No sportsbook price is allowed to enter the raw context score forecast.
- No historical -110 prices are invented.
- No missing xG, pressure, wind direction, lineup, or other unavailable feature is fabricated.
- Context Learning V2 is shadow-only in v1.16.0.
