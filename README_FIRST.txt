APEX PICKS 1.10 — RANKED DECISION BOARD + VERIFIED SIMS + SELF-UPDATE READY
=================================================================

NORMAL LAUNCH
1. Extract this folder once.
2. Double-click START_APEX.cmd.
3. Enter the Odds API key only if asked on first launch.
4. Apex opens in your browser.

WHAT CHANGED
- The Home screen and Picks page now open with an Apex Decision Board that ranks production-qualified picks.
- Find Best Picks scans a maximum of 3 model-supported upcoming events at a time and respects the existing quota guard.
- Saved fresh recommendations load without consuming provider credits.
- Each upcoming team-sport card has Analyze for Best Pick as the primary action; raw sportsbook markets are secondary.
- The #1 qualified pick shows probability, EV, edge, sportsbook, odds and why it qualified.
- If nothing passes, Apex says PASS instead of forcing a pick.
- Sims is no longer a generic placeholder for MLB pitcher strikeouts.
- Sims can run 10,000 deterministic trials from verified V3 Negative-Binomial pitcher-K inputs.
- Simulation evidence cannot bypass the production recommendation gate.
- Full team/game simulations remain locked until independent team models are validated.

FUTURE IN-PLACE UPDATES
This folder now has a permanent launcher and updater outside the replaceable app code.
The updater preserves:
- app\.env
- app\data\

To turn on automatic update checks, double-click CONFIGURE_AUTO_UPDATES.cmd once and enter the GitHub repo that publishes Apex releases.
After that, START_APEX.cmd checks the latest GitHub Release and updates app code in place before launch.

For a private GitHub repo, the setup asks for a read-only token locally. Do not paste that token into ChatGPT.
