// Live Copilot acceptance through the running VS Code, using its signed-in session. Spends Copilot quota.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
fs.mkdirSync(path.join(root, '.vscode-test'), { recursive: true });
const workspace = fs.mkdtempSync(path.join(root, '.vscode-test', 'live-'));
fs.cpSync(path.join(root, 'fixtures/rust'), workspace, { recursive: true, filter: p => path.basename(p) !== 'target' });
fs.writeFileSync(path.join(workspace, 'live.marker'), process.env.EYE_LIVE_MODEL || '');
fs.mkdirSync(path.join(workspace, '.vscode'), { recursive: true });
fs.writeFileSync(path.join(workspace, '.vscode/settings.json'), JSON.stringify({ 'eyepiece.provider': 'copilot' }));
const log = path.join(workspace, 'live-log.jsonl');
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
console.log(`workspace ${workspace}`);
spawn('code', [`--extensionDevelopmentPath=${root}`, `--extensionDevelopmentPath=${path.join(root, 'test/live/driver')}`, '--disable-workspace-trust', workspace], { env, shell: true, stdio: 'ignore' });
const deadline = Date.now() + Number(process.env.EYE_LIVE_TIMEOUT_MS || 420000);
let seen = 0;
const timer = setInterval(() => {
  const lines = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n') : [];
  for (const line of lines.slice(seen)) console.log(line);
  seen = lines.length;
  const finished = lines.some(line => JSON.parse(line).step === 'exit');
  if (finished || Date.now() > deadline) { clearInterval(timer); if (!finished) { console.log('TIMED OUT'); process.exitCode = 2; } else if (lines.some(line => JSON.parse(line).step === 'failed')) process.exitCode = 1; }
}, 1000);
