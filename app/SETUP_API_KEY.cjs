const fs = require('fs');
const path = require('path');
const readline = require('readline');

const root = __dirname;
const envPath = path.join(root, '.env');
const examplePath = path.join(root, '.env.example');

function ensureEnv() {
  if (!fs.existsSync(envPath)) {
    if (fs.existsSync(examplePath)) {
      fs.copyFileSync(examplePath, envPath);
    } else {
      fs.writeFileSync(
        envPath,
        'ODDS_API_KEY=""\nAPEX_V5_AUTO_STARTER_LEARNING=true\nAPEX_V5_STARTER_LEARNING_INTERVAL_MINUTES=60\n',
        'utf8'
      );
    }
  }
}

function readEnv() {
  return fs.readFileSync(envPath, 'utf8');
}

function currentKey(envText) {
  const match = envText.match(/^\s*ODDS_API_KEY\s*=\s*(.*)\s*$/m);
  if (!match) return '';
  let value = match[1].trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  }
  return value.trim();
}

function isConfigured(key) {
  if (!key) return false;
  const upper = key.toUpperCase();
  return ![
    'YOUR_KEY_HERE',
    'YOUR_ODDS_API_KEY',
    'MY_ODDS_API_KEY',
    'ODDS_API_KEY'
  ].includes(upper);
}

function quoteEnv(value) {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function saveKey(key) {
  let envText = readEnv();
  const line = `ODDS_API_KEY=${quoteEnv(key)}`;
  if (/^\s*ODDS_API_KEY\s*=.*$/m.test(envText)) {
    envText = envText.replace(/^\s*ODDS_API_KEY\s*=.*$/m, line);
  } else {
    envText = `${envText.replace(/\s*$/, '')}\n${line}\n`;
  }
  fs.writeFileSync(envPath, envText, 'utf8');
}

ensureEnv();
const existing = currentKey(readEnv());
if (isConfigured(existing)) {
  console.log('Odds API key is already configured.');
  process.exit(0);
}

console.log('First-time API setup');
console.log('Your key is saved only in the local .env file in this Apex folder.');
console.log('It is not sent anywhere by this setup tool.');
console.log('');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
rl.question('Paste your The Odds API key, then press Enter: ', (answer) => {
  const key = answer.trim();
  if (!key) {
    console.error('\nNo API key was entered. Setup was not completed.');
    rl.close();
    process.exitCode = 2;
    return;
  }
  if (/\s/.test(key)) {
    console.error('\nThe API key contains spaces. Please run the launcher again and paste only the key.');
    rl.close();
    process.exitCode = 2;
    return;
  }
  saveKey(key);
  console.log('\nAPI key saved successfully to .env.');
  console.log('Future launches will skip this setup step.');
  rl.close();
});
