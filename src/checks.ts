import * as vscode from 'vscode';
import { spawn } from 'node:child_process';
export async function findManifest(source: vscode.Uri): Promise<vscode.Uri> {
  const folder = vscode.workspace.getWorkspaceFolder(source);
  if (!folder || source.scheme !== 'file') throw new Error('Open the local Cargo project as a trusted workspace first.');
  let directory = vscode.Uri.joinPath(source, '..');
  while (directory.fsPath.startsWith(folder.uri.fsPath)) {
    const candidate = vscode.Uri.joinPath(directory, 'Cargo.toml');
    try { await vscode.workspace.fs.stat(candidate); return candidate; } catch { /* continue to workspace root */ }
    if (directory.fsPath === folder.uri.fsPath) break;
    directory = vscode.Uri.joinPath(directory, '..');
  }
  throw new Error('No Cargo.toml found within the source workspace folder.');
}
export async function runRustChecks(manifest: vscode.Uri, output: vscode.OutputChannel, signal: AbortSignal): Promise<boolean> {
  if (!vscode.workspace.isTrusted) throw new Error('Trust the workspace before running Cargo.');
  for (const args of [['check', '--locked'], ['test', '--locked']]) {
    signal.throwIfAborted();
    output.appendLine(`cargo ${args.join(' ')} --manifest-path ${manifest.fsPath}`);
    const success = await new Promise<boolean>((resolve, reject) => {
      const child = spawn('cargo', [...args, '--manifest-path', manifest.fsPath], { cwd: vscode.Uri.joinPath(manifest, '..').fsPath, shell: false, signal, timeout: 120000 });
      child.stdout.on('data', data => output.append(data.toString()));
      child.stderr.on('data', data => output.append(data.toString()));
      child.once('error', reject); child.once('close', code => resolve(code === 0));
    });
    if (!success) return false;
  }
  return true;
}
