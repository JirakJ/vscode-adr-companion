// @adr:0004 Run git without a shell
/**
 * Git access. Always `execFile` with an argument array — never a shell — so
 * branch names, refs and paths are passed verbatim and cannot be interpreted.
 */
import { execFile } from 'node:child_process';
import { MergeCommit, mergeLogArgs, parseMergeLog } from '../core/pullRequest';

export interface GitResult {
  stdout: string;
  stderr: string;
}

export function runGit(cwd: string, args: string[], timeoutMs = 30_000): Promise<GitResult> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      args,
      { cwd, timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024, windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } },
      (error, stdout, stderr) => {
        if (error) {
          const detail = String(stderr || error.message).trim().split('\n')[0];
          reject(new Error(`git ${args[0]} failed: ${detail}`));
        } else {
          resolve({ stdout: String(stdout), stderr: String(stderr) });
        }
      },
    );
  });
}

/** Refs are user input — refuse anything that could be read as an option. */
export function assertSafeRef(ref: string): string {
  if (!ref || ref.startsWith('-') || /[\s\0]/.test(ref)) throw new Error(`Invalid git ref: ${JSON.stringify(ref)}`);
  return ref;
}

export async function repoRoot(cwd: string): Promise<string> {
  return (await runGit(cwd, ['rev-parse', '--show-toplevel'])).stdout.trim();
}

export async function readMergeCommits(cwd: string, limit = 30): Promise<MergeCommit[]> {
  return parseMergeLog((await runGit(cwd, mergeLogArgs(limit))).stdout);
}

function lines(out: string): string[] {
  return out
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}

/** Files changed between `base` and `head` (merge-base diff, like a pull request). */
export async function changedFilesBetween(cwd: string, base: string, head = 'HEAD'): Promise<string[]> {
  const range = `${assertSafeRef(base)}...${assertSafeRef(head)}`;
  return lines((await runGit(cwd, ['diff', '--name-only', '--no-renames', range, '--'])).stdout);
}

/** Committed + uncommitted + untracked changes relative to `base`. */
export async function changedFilesIncludingWorkingTree(cwd: string, base: string): Promise<string[]> {
  const mergeBase = (await runGit(cwd, ['merge-base', assertSafeRef(base), 'HEAD'])).stdout.trim();
  const tracked = lines((await runGit(cwd, ['diff', '--name-only', '--no-renames', mergeBase, '--'])).stdout);
  const untracked = lines((await runGit(cwd, ['ls-files', '--others', '--exclude-standard'])).stdout);
  return [...new Set([...tracked, ...untracked])];
}

/** `origin/HEAD` target when known, else the first of origin/main, origin/master, main, master. */
export async function defaultBaseRef(cwd: string): Promise<string | null> {
  try {
    const head = (await runGit(cwd, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'])).stdout.trim();
    if (head) return head;
  } catch {
    // no origin/HEAD
  }
  for (const ref of ['origin/main', 'origin/master', 'main', 'master']) {
    try {
      await runGit(cwd, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
      return ref;
    } catch {
      // try next
    }
  }
  return null;
}
