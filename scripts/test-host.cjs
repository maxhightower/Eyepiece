process.env.TAR_OPTIONS = '--no-same-owner';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runTests } = require('@vscode/test-electron');
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'eyepiece-workspace-'));
fs.cpSync(path.resolve(__dirname, '../fixtures/rust'), workspace, {recursive:true, filter: p => !p.includes('/target')});
runTests({
  version: process.env.VSCODE_VERSION || '1.95.3',
  extensionDevelopmentPath: process.env.EYE_EXTENSION_PATH || path.resolve(__dirname, '..'),
  extensionTestsPath: path.resolve(__dirname, '../out/test/host/index.js'),
  launchArgs: [workspace, '--no-sandbox', '--disable-gpu', '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes'],
}).catch(error => { console.error(error); process.exitCode = 1; }).finally(() => fs.rmSync(workspace, {recursive:true, force:true}));
