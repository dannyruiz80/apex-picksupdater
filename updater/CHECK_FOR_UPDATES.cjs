const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const appDir = path.join(root, 'app');
const configPath = path.join(root, 'apex-update.json');
const tokenPath = path.join(root, '.update.env');

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function currentVersion() {
  const pkg = readJson(path.join(appDir, 'package.json'), {});
  return String(pkg.version || '0.0.0').replace(/^v/i, '');
}
function parseVersion(v) {
  return String(v || '0.0.0').replace(/^v/i, '').split('-')[0].split('.').map((x) => Number(x) || 0).slice(0, 3).concat([0,0,0]).slice(0,3);
}
function newer(remote, local) {
  const a = parseVersion(remote), b = parseVersion(local);
  for (let i = 0; i < 3; i++) { if (a[i] !== b[i]) return a[i] > b[i]; }
  return false;
}
function readToken() {
  if (!fs.existsSync(tokenPath)) return '';
  const m = fs.readFileSync(tokenPath, 'utf8').match(/^GITHUB_TOKEN=(.+)$/m);
  return m ? m[1].trim() : '';
}
async function githubJson(url, token) {
  const headers = { 'Accept': 'application/vnd.github+json', 'User-Agent': 'ApexPicks-Updater/1.0', 'X-GitHub-Api-Version': '2022-11-28' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`GitHub update check returned HTTP ${res.status}`);
  return res.json();
}
async function download(url, dest, token) {
  const headers = { 'Accept': 'application/octet-stream', 'User-Agent': 'ApexPicks-Updater/1.0' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(url, { headers, redirect: 'follow' });
  if (!res.ok) throw new Error(`Update download returned HTTP ${res.status}`);
  const arr = new Uint8Array(await res.arrayBuffer());
  fs.writeFileSync(dest, arr);
  return crypto.createHash('sha256').update(arr).digest('hex');
}
function quotePs(s) { return `'${String(s).replace(/'/g, "''")}'`; }
function applyZip(zipPath) {
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-update-'));
  const ps = `
$ErrorActionPreference='Stop'
$zip=${quotePs(zipPath)}
$stage=${quotePs(stage)}
$app=${quotePs(appDir)}
Expand-Archive -LiteralPath $zip -DestinationPath $stage -Force
$source = Join-Path $stage 'app'
if (-not (Test-Path (Join-Path $source 'package.json'))) {
  # Some release builders zip the contents of app/ at the archive root.
  if (Test-Path (Join-Path $stage 'package.json')) {
    $source = $stage
  } else {
    $dirs = Get-ChildItem -LiteralPath $stage -Directory
    if ($dirs.Count -eq 1) {
      if (Test-Path (Join-Path $dirs[0].FullName 'app\package.json')) {
        $source = Join-Path $dirs[0].FullName 'app'
      } elseif (Test-Path (Join-Path $dirs[0].FullName 'package.json')) {
        $source = $dirs[0].FullName
      }
    }
  }
}
if (-not (Test-Path (Join-Path $source 'package.json'))) { throw 'Update asset must contain Apex app/package.json or package.json at archive root' }
Get-ChildItem -LiteralPath $source -Force | Where-Object { $_.Name -notin @('.env','data','node_modules') } | ForEach-Object {
  $dest = Join-Path $app $_.Name
  if (Test-Path $dest) { Remove-Item -LiteralPath $dest -Recurse -Force }
  Copy-Item -LiteralPath $_.FullName -Destination $dest -Recurse -Force
}
if (Test-Path (Join-Path $app 'node_modules')) { Remove-Item -LiteralPath (Join-Path $app 'node_modules') -Recurse -Force }
Remove-Item -LiteralPath $stage -Recurse -Force
`;
  const r = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error('PowerShell could not apply the Apex update.');
}

(async () => {
  const config = readJson(configPath, {});
  if (!config.enabled || !config.repo) {
    console.log('Auto-update source is not configured yet. Installed version will start.');
    process.exit(0);
  }
  try {
    const token = readToken();
    const release = await githubJson(`https://api.github.com/repos/${config.repo}/releases/latest`, token);
    const remoteVersion = String(release.tag_name || release.name || '').replace(/^v/i, '');
    const localVersion = currentVersion();
    if (!remoteVersion || !newer(remoteVersion, localVersion)) {
      console.log(`Apex Picks ${localVersion} is current.`);
      process.exit(0);
    }
    const asset = (release.assets || []).find((a) => a.name === (config.assetName || 'apex-picks-windows-app.zip'));
    if (!asset) throw new Error(`Release ${release.tag_name} does not contain ${config.assetName || 'apex-picks-windows-app.zip'}`);
    console.log(`New Apex version ${remoteVersion} found. Updating ${localVersion} -> ${remoteVersion}...`);
    const updateDir = path.join(root, '.update-cache');
    fs.mkdirSync(updateDir, { recursive: true });
    const zipPath = path.join(updateDir, 'apex-update.zip');
    const downloadUrl = token ? asset.url : asset.browser_download_url;
    const sha = await download(downloadUrl, zipPath, token);
    console.log(`Downloaded update (${sha.slice(0, 12)}...). Applying while preserving API key and learning data...`);
    applyZip(zipPath);
    try { fs.rmSync(updateDir, { recursive: true, force: true }); } catch {}
    console.log(`Apex Picks updated successfully to ${remoteVersion}.`);
    process.exit(0);
  } catch (err) {
    console.error(`Update check warning: ${err.message}`);
    process.exitCode = 2;
  }
})();
