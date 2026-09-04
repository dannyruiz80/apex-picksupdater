# Apex Picks 1.12.0 — Win Probability + Game Market V2 Shadow

## User-facing change

The old scaffold-style Win Probability experience is replaced by an active dedicated game-market screen.

- **Win Probability** is now a Core navigation module.
- It scans **moneyline, spread, and total** markets only, so player props cannot crowd game recommendations out of the view.
- It always displays independent win probabilities when the team model is available, even if the current sportsbook price is a PASS.
- It shows separate **Best Moneyline**, **Best Spread**, and **Best Total** cards.
- The main Decision Board still ranks all qualified plays together; the dedicated Win Probability screen is the category-specific view.

## Production model

`APEX_GAME_MARKET_V1` remains the production game-market probability model. Sportsbook odds do not enter its forecast; prices are applied afterward for break-even, edge and EV.

## V2 context challenger (shadow only)

`APEX_GAME_MARKET_V2_SHADOW` adds verified context without being allowed to override production:

### MLB
- Confirmed/probable starting pitcher identity when published by MLB
- Point-in-time starter ERA and WHIP through the prior date
- Recent verified bullpen innings across up to three completed games
- Pregame batting-order availability when posted
- Pregame temperature, wind, condition and venue identity when available
- No synthetic park factor or umpire factor

### NFL
- Recent scoring-margin form
- Rest days
- Net yards per play from completed prior-game box scores when available
- Turnover margin per game from completed prior-game box scores when available
- True EPA is deliberately **not** claimed; EPA remains locked until a validated expected-points/play-by-play model exists

All V2 context is shadow/audit-only. Promotion requires prospective evidence.

## Game-market gates

A current game bet must still pass the existing V1 gates:

- verified pregame event
- sufficient point-in-time team history
- fresh sportsbook quote
- at least two books on the exact outcome/line
- minimum edge
- minimum EV
- moderate-or-better reliability

No qualifying price = PASS, even if one team has the higher win probability.

## Verification

Deterministic verification uses zero keyed Odds API requests and confirms:

- future/uncompleted history exclusion
- probability math symmetry
- independent best-price candidate selection
- one-book depth rejection
- stale quote rejection
- sportsbook consensus remains comparison-only
- V2 shadow probability is reported without changing production qualification

