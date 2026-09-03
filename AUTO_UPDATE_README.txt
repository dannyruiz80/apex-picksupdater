APEX PICKS AUTO UPDATE
======================

This build separates the permanent launcher/updater from the replaceable app code.

What is preserved during every update:
- app\.env (Odds API key and local settings)
- app\data\ (historical snapshots, V5 learning evidence, local ledgers)

What gets updated:
- frontend source
- backend source
- model code
- package/version files
- documentation inside app\

To enable automatic updates:
1. Put Apex Picks in a GitHub repository that publishes Releases.
2. Each release should include an asset named: apex-picks-windows-app.zip
3. Double-click CONFIGURE_AUTO_UPDATES.cmd once.
4. Enter owner/repo or the GitHub repository URL.
5. If private, enter a read-only GitHub token locally when asked.

After that, START_APEX.cmd checks for a newer release before each launch.
No API key or learning data is overwritten.

IMPORTANT:
ChatGPT cannot directly modify files already stored on your PC without a remote update source and your launcher choosing to pull it. This updater is the bridge that makes future in-place updates possible.
