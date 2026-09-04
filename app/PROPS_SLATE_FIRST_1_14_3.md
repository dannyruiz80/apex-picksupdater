APEX PICKS 1.14.3 — SLATE-FIRST PLAYER PROPS

WHY
The Player Props page was event-first. A user could see dozens of scheduled
events but had to open them one at a time to discover whether any usable prop
markets existed.

NEW DISCOVERY FLOW
- Today / Tomorrow / custom date remains global and date-aware.
- All Sports or a sport filter now feeds a slate-wide prop scanner.
- Click "Scan Slate for Best Props" once.
- Apex scans up to 8 upcoming prop-capable events per request.
- ALL uses round-robin sport selection so MLB cannot consume every scan slot.
- Returned props from all scanned events are deduplicated and ranked together.
- Event dropdown remains available only for optional drill-down.
- Each slate prop shows the source event and sport.

QUOTA PROTECTION
- Maximum 8 events per normal slate scan.
- Existing normalized/raw caches are reused.
- Event requests remain sequential and pass through the existing quota guard.
- Verification itself uses 0 keyed Odds API requests.

TENNIS
- Tennis schedule coverage remains visible.
- This build does not claim a validated tennis PLAYER-PROP connector.
- A Tennis slate scan fails closed immediately with 0 provider prop requests.
- Users no longer need to inspect every tennis event in the dropdown merely to
  discover that player props are unsupported.

SLATE TELEMETRY
The Props screen now displays:
- scheduled events
- prop-capable events
- events scanned
- distinct props returned
- qualified props
- per-sport scanned / props / qualified counts
- unsupported player-prop sports

VERIFICATION
- New slate-first scanner: 5/5 PASS
- Existing prop identity verification: 4/4 PASS
- ML Engine V2: 7/7 PASS
- MLB Pitcher K V3: 11/11 PASS
- Champion/Challenger: 8/8 PASS
- MLB Pitcher K V5: 10/10 PASS
- Changed TypeScript/TSX unexpected diagnostics: 0 after filtering absent
  sandbox third-party declarations.
- Keyed Odds API requests used by deterministic verification: 0
