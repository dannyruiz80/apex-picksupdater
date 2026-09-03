const fs = require('fs');
const path = require('path');
const readline = require('readline');

const root = path.resolve(__dirname, '..');
const configPath = path.join(root, 'apex-update.json');
const tokenPath = path.join(root, '.update.env');
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function ask(q) { return new Promise((resolve) => rl.question(q, resolve)); }
function normalizeRepo(input) {
  let value = input.trim().replace(/\\/g, '/');
  value = value.replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/i, '').replace(/^\/+|\/+$/g, '');
  return /^[^/\s]+\/[^/\s]+$/.test(value) ? value : '';
}

(async () => {
  console.log('Apex Picks Auto Update Setup');
  console.log('This stores update settings only on this computer.');
  console.log('Expected GitHub release asset name: apex-picks-windows-app.zip');
  console.log('');
  const raw = await ask('GitHub repository (owner/repo or URL): ');
  const repo = normalizeRepo(raw);
  if (!repo) {
    console.error('Invalid repository. Example: danny/apex-picks');
    rl.close();
    process.exitCode = 2;
    return;
  }
  const privateAnswer = (await ask('Is the repository private? (y/N): ')).trim().toLowerCase();
  let token = '';
  if (privateAnswer === 'y' || privateAnswer === 'yes') {
    token = (await ask('Paste a GitHub token with read access (stored locally only): ')).trim();
    if (!token) {
      console.error('A token is required for private GitHub releases.');
      rl.close();
      process.exitCode = 2;
      return;
    }
  }
  const config = {
    provider: 'github-releases',
    repo,
    assetName: 'apex-picks-windows-app.zip',
    enabled: true,
    configuredAt: new Date().toISOString(),
  };
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf8');
  if (token) fs.writeFileSync(tokenPath, `GITHUB_TOKEN=${token}\n`, { encoding: 'utf8', mode: 0o600 });
  else if (fs.existsSync(tokenPath)) fs.unlinkSync(tokenPath);
  console.log('');
  console.log(`Auto updates enabled from GitHub releases: ${repo}`);
  console.log('START_APEX.cmd will check for a newer release before starting Apex.');
  console.log('Your app/.env and app/data folders are never replaced by the updater.');
  rl.close();
})();
