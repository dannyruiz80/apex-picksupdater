# Apex Picks 1.10.1 — Odds API Runtime Load Fix

## Root cause
The Windows setup script correctly wrote `ODDS_API_KEY` into `app/.env`, but `server.ts` never loaded `.env` before the market/quota singleton services evaluated `process.env.ODDS_API_KEY`. As a result, the launcher could say the key was configured while the Decision Board returned `NOT_CONFIGURED`.

## Fix
- Load `dotenv/config` before server-side market services initialize.
- `/api/health` now exposes `oddsProviderConfigured` and `oddsProviderStatus` for explicit diagnostics.
- Decision Board shows configuration failure as an error state, not as a misleading no-pick result.
- App version bumped to 1.10.1.
- GitHub release workflow now stamps `app/package.json` with the requested release version before packaging, preventing repeated downloads of the same update.

## Expected verification
After restart, open `http://localhost:3000/api/health`. With a valid locally saved key, it should include:

```json
{
  "status": "ok",
  "app": "Apex Picks",
  "version": "1.10.1",
  "oddsProviderConfigured": true
}
```
