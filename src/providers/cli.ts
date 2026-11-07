import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PromptedProvider } from './prompted';

export interface CliCommand {
  id: string; label: string; command: string; args: string[];
  /** Windows needs a shell to start npm-installed .cmd programs. Arguments are fixed; the prompt only goes through stdin. */
  shell: boolean;
  missing: string;
  parse(stdout: string): string;
}
/** Runs the user's installed Codex with their own sign-in. Read-only, in an empty folder, ignoring their Codex config. */
export const codexCommand = (): CliCommand => ({
  id: 'codex', label: 'Codex', command: 'codex', shell: process.platform === 'win32',
  args: ['exec', '--skip-git-repo-check', '--ephemeral', '--sandbox', 'read-only', '--ignore-user-config', '-'],
  missing: 'Codex is not installed. Install the Codex CLI and run codex login, or choose another provider.',
  parse: stdout => stdout,
});
/** Runs the user's installed Claude Code for personal use, with every tool, MCP server, and project setting off. */
export const claudeCommand = (command: string): CliCommand => ({
  id: 'claudeCode', label: 'Claude Code', command, shell: false,
  args: ['-p', '--tools', '', '--strict-mcp-config', '--setting-sources', '', '--disable-slash-commands', '--no-session-persistence', '--output-format', 'json'],
  missing: 'Claude Code was not found. Install it, or choose another provider.',
  parse(stdout) {
    const result = JSON.parse(stdout) as { is_error?: boolean; result?: unknown };
    if (result.is_error || typeof result.result !== 'string') throw new Error(`Claude Code failed: ${String(result.result ?? 'no result')}`);
    return result.result;
  },
});
export class CliProvider extends PromptedProvider {
  readonly id: string;
  constructor(private readonly cli: CliCommand, private readonly timeoutMs = 300000) { super(); this.id = cli.id; }
  protected async complete(prompt: string, signal: AbortSignal): Promise<string> {
    // An empty folder keeps the agent away from the project, including any instructions planted in it.
    const cwd = await mkdtemp(join(tmpdir(), 'eyepiece-cli-'));
    try {
      const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
      const stdout = await new Promise<string>((resolve, reject) => {
        const child = spawn(this.cli.command, this.cli.args, { cwd, env, shell: this.cli.shell, signal, timeout: this.timeoutMs, windowsHide: true });
        let out = '', err = '';
        child.stdout.on('data', data => { out += data; if (out.length > 2000000) child.kill(); });
        child.stderr.on('data', data => { err = (err + data).slice(-2000); });
        child.stdin.on('error', () => undefined);
        child.stdin.end(prompt);
        let failure: Error | undefined;
        child.once('error', error => {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') return reject(new Error(this.cli.missing));
          // A cancelled process still holds its folder on Windows, so finish on close. The timer covers a close that never comes.
          failure = error; setTimeout(() => reject(error), 3000).unref();
        });
        child.once('close', code => {
          if (failure) return reject(failure);
          if (code === 0) return resolve(out);
          // A shell reports a missing program through its exit code rather than an error event.
          if (this.cli.shell && (code === 1 || code === 9009) && /not recognized|not found/i.test(err)) return reject(new Error(this.cli.missing));
          reject(new Error(`${this.cli.label} failed (exit ${code}). ${err.trim() || out.trim().slice(-400)}`));
        });
      });
      return this.cli.parse(stdout);
    } finally { await rm(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(() => undefined); }
  }
}
