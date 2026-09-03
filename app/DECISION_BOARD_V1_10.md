# Apex Picks 1.10 — Decision Board

The primary app workflow is now decision-first.

## Home / Overview

The first actionable panel is **Apex Decision Board**.

- Loads fresh saved qualified recommendations with **zero provider credits**.
- `Find Best Picks` performs an explicit, sequential, quota-controlled scan.
- The scan is capped at **3 upcoming model-supported events** by default.
- In `ALL` mode it samples distinct supported sports before repeating a sport.
- Only production `QUALIFIES` recommendations are ranked.
- If nothing passes, the board explicitly returns **PASS THE SCANNED SLATE**.

## Ranking order

The board never ranks a `NO_BET` result. Among qualifying recommendations it orders by:

1. verified sample reliability;
2. model probability;
3. expected value;
4. model edge.

This prevents a high raw probability from being presented as a pick when the price or evidence is inadequate.

## Pick cards

Each ranked pick shows:

- exact player, side and line;
- production model probability;
- break-even probability context;
- model edge;
- expected value;
- best verified sportsbook / price;
- sample reliability;
- quote freshness;
- point-in-time integrity;
- MLB pitcher-K V3 shadow agreement when available.

## Schedule cards

For supported upcoming team events:

- **Analyze for Best Pick** is the primary action;
- **Full Prop Analysis** opens the detailed probability / EV page;
- **Raw Markets** is secondary and is not labeled as a recommendation.

Tennis remains market-inspection only until an independent validated tennis pick model is connected. The UI says this explicitly rather than presenting sportsbook prices as model picks.

## Saved-board safety

Saved recommendations are shown only when all of the following are true:

- `REAL_PREGAME` snapshot;
- production recommendation = `QUALIFIES`;
- point-in-time proof = true;
- verification = `VERIFIED`;
- historical eligibility = `ELIGIBLE`;
- event is still in the future;
- quote age <= 10 minutes.

Older saved prices disappear from the decision board until the event is evaluated again.

## Provider usage

Loading saved picks uses zero keyed-provider calls.

An explicit `Find Best Picks` scan can use provider calls on cache misses. It is capped, sequential, pregame-only, and remains under the existing daily/monthly quota guard.
