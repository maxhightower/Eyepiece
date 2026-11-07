// Starts live acceptance inside a normal Extension Development Host. VS Code rejects --extensionTestsPath while another instance runs.
const fs = require('node:fs');
const path = require('node:path');
const vscode = require('vscode');
exports.activate = async context => {
  const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!folder || !path.basename(folder).startsWith('live-')) return;
  const close = () => vscode.commands.executeCommand('workbench.action.closeWindow');
  // VS Code reuses the single development window, which can still point at a deleted run.
  const marker = path.join(folder, 'live.marker');
  if (!fs.existsSync(marker)) return close();
  const log = (step, detail = '') => fs.appendFileSync(path.join(folder, 'live-log.jsonl'), JSON.stringify({ at: new Date().toISOString(), step, detail }) + '\n');
  log('driver', { trusted: vscode.workspace.isTrusted, version: vscode.version });
  try { await require(path.resolve(__dirname, '../../../out/test/live/index.js')).run(vscode.Uri.joinPath(context.globalStorageUri, 'drafts'), fs.readFileSync(marker, 'utf8').trim()); }
  catch (error) { log('failed', String(error)); log('exit'); }
  await close();
};
