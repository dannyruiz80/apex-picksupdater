APEX PICKS 1.14.2 — PROPS DATE/IDENTITY + CROSS-SPORT DIAGNOSTICS

PLAYER PROPS
- Props now receives the same global selectedDate used by Picks.
- Today, Tomorrow and custom-date controls are available directly on Props.
- Props event choices are explicitly filtered to the active America/Chicago slate date.
- Old-slate events cannot remain visible while a new date is loading.
- Future prop inventory is allowed to be empty when books have not published player markets yet.

PROP IDENTITY
- Player-prop recommendation labels now always include the exact market.
- Example: Shane Drohan · Pitcher Strikeouts UNDER 5.5
- Example: Nick Sogard · Total Bases OVER 0.5
- The same identity flows into Picks and Parlays through DecisionBoardPick.selectionLabel.
- Raw provider keys are humanized when an older saved snapshot lacks a friendly category.

MULTI-SPORT COVERAGE
- Coverage rows now include CONNECTED / PARTIAL / NOT_CONNECTED.
- Sports with zero picks show leading rejection reasons and counts.
- Examples: EDGE_BELOW_3PP, EV_BELOW_3_PERCENT, MARKET_DEPTH_BELOW_2_BOOKS,
  PROP_NO_PROPS, GAME_MARKET_NO_MARKETS.
- Scheduled-but-not-production-connected sports are visible rather than silently disappearing.
- Visible cards are diversified only when another sport actually has a qualified pick.
- Recommendation thresholds are unchanged.

VERIFICATION
- Prop identity functional tests: 4/4 PASS
- Props date/UI integration checks: 6/6 PASS
- Changed TypeScript/TSX unexpected diagnostics after filtering absent sandbox dependencies: 0
- Odds API requests used by deterministic verification: 0
