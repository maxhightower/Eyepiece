import * as vscode from 'vscode';
import { spawn } from 'node:child_process';

/** Project files that show how to check a source file, by VS Code language id. */
const projectFiles: Record<string, string[]> = {
  rust: ['Cargo.toml'], go: ['go.mod'],
  javascript: ['package.json'], javascriptreact: ['package.json'], typescript: ['package.json'], typescriptreact: ['package.json'],
  python: ['pyproject.toml', 'pytest.ini', 'setup.cfg'],
};
async function hasTestScript(manifest: vscode.Uri): Promise<boolean> {
  try { return typeof JSON.parse(Buffer.from(await vscode.workspace.fs.readFile(manifest)).toString()).scripts?.test === 'string'; }
  catch { return false; }
}
/** The nearest project file that gives this source a test command, if any. */
export async function findManifest(source: vscode.Uri, language: string): Promise<vscode.Uri | undefined> {
  const folder = vscode.workspace.getWorkspaceFolder(source), names = projectFiles[language] ?? [];
  if (!folder || source.scheme !== 'file') return undefined;
  let directory = vscode.Uri.joinPath(source, '..');
  while (directory.fsPath.startsWith(folder.uri.fsPath)) {
    for (const name of names) {
      const candidate = vscode.Uri.joinPath(directory, name);
      try { await vscode.workspace.fs.stat(candidate); } catch { continue; }
      if (name !== 'package.json' || await hasTestScript(candidate)) return candidate;
    }
    if (directory.fsPath === folder.uri.fsPath) break;
    directory = vscode.Uri.joinPath(directory, '..');
  }
  return undefined;
}
function commandsFor(manifest: vscode.Uri): string[][] {
  const name = manifest.path.split('/').pop();
  if (name === 'Cargo.toml') return [['cargo', 'check', '--locked', '--manifest-path', manifest.fsPath], ['cargo', 'test', '--locked', '--manifest-path', manifest.fsPath]];
  if (name === 'go.mod') return [['go', 'test', './...']];
  if (name === 'package.json') return [['npm', 'test']];
  return [['python', '-m', 'pytest']];
}
export async function runChecks(manifest: vscode.Uri, output: vscode.OutputChannel, signal: AbortSignal): Promise<boolean> {
  if (!vscode.workspace.isTrusted) throw new Error('Trust the workspace before running project checks.');
  for (const [command, ...args] of commandsFor(manifest)) {
    signal.throwIfAborted();
    output.appendLine(`${command} ${args.join(' ')}`);
    const success = await new Promise<boolean>((resolve, reject) => {
      // npm is a .cmd file on Windows, which needs a shell. Its arguments are the fixed ones above.
      const child = spawn(command!, args, { cwd: vscode.Uri.joinPath(manifest, '..').fsPath, shell: command === 'npm' && process.platform === 'win32', signal, timeout: 120000 });
      child.stdout.on('data', data => output.append(data.toString()));
      child.stderr.on('data', data => output.append(data.toString()));
      child.once('error', reject); child.once('close', code => resolve(code === 0));
    });
    if (!success) return false;
  }
  return true;
}
export const runRustChecks = runChecks;
