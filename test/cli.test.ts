import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CliIO, parseArgs, runCli } from '../src/cli/cli';
import { detectAdrDirectory, loadRecords, readProjectConfig } from '../src/node/workspace';
import { assertSafeRef } from '../src/node/git';

let root: string;

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), 'adr-cli-'));
  mkdirSync(path.join(root, 'decisions'));
  writeFileSync(path.join(root, '.adr-config.yaml'), 'directory: decisions\nrequireAdrForPaths:\n  - "**/api/**"\n');
  writeFileSync(
    path.join(root, 'decisions', '0001-use-x.md'),
    '# 1. Use X\n\nDate: 2026-01-01\n\n## Status\n\nAccepted\n\n## Context\n\nC\n\n## Decision\n\nD\n\n## Consequences\n\nE\n',
  );
  writeFileSync(path.join(root, 'decisions', '0002-use-y.md'), '# 2. Use Y\n\nDate: 2026-01-02\n\n## Status\n\nSuperseded\n');
  writeFileSync(path.join(root, 'decisions', 'README.md'), '# Decisions\n');
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

function io(extra: Partial<CliIO> = {}): CliIO & { stdout: string; stderr: string } {
  const r = {
    stdout: '',
    stderr: '',
    cwd: root,
    env: {},
    today: '2026-02-01',
    out: (t: string) => {
      r.stdout += t;
    },
    err: (t: string) => {
      r.stderr += t;
    },
    ...extra,
  };
  return r;
}

describe('workspace loading', () => {
  it('reads config, detects the directory and skips README', async () => {
    expect((await readProjectConfig(root))?.config.directory).toBe('decisions');
    expect(await detectAdrDirectory(root)).toEqual({ dir: 'decisions', exists: true });
    expect(await detectAdrDirectory(root, 'docs/adr')).toEqual({ dir: 'docs/adr', exists: false });
    expect((await loadRecords(path.join(root, 'decisions'))).map((r) => r.fileName)).toEqual(['0001-use-x.md', '0002-use-y.md']);
    expect(await loadRecords(path.join(root, 'missing'))).toEqual([]);
  });

  it('refuses refs that look like options', () => {
    expect(() => assertSafeRef('--output=/tmp/x')).toThrow();
    expect(() => assertSafeRef('a b')).toThrow();
    expect(assertSafeRef('origin/main')).toBe('origin/main');
  });
});

describe('cli', () => {
  it('parses arguments', () => {
    expect(parseArgs(['lint', '--format', 'json', '--cluster', '--dir=x'])).toEqual({
      command: 'lint',
      flags: new Map<string, string | true>([['format', 'json'], ['cluster', true], ['dir', 'x']]),
    });
    expect(() => parseArgs(['lint', '--format'])).toThrow();
  });

  it('lints and fails on errors', async () => {
    const o = io();
    expect(await runCli(['lint'], o)).toBe(1);
    expect(o.stdout).toContain('decisions/0002-use-y.md:7');
    expect(o.stdout).toContain('missing-supersede-link');
    expect(o.stdout).toContain('2 decision record(s) in decisions: 1 error(s)');
    expect(await runCli(['lint', '--fail-on', 'never'], io())).toBe(0);
  });

  it('emits GitHub annotations and JSON', async () => {
    const gh = io();
    await runCli(['lint', '--format', 'github'], gh);
    expect(gh.stdout).toContain('::error file=decisions/0002-use-y.md,line=7,title=ADR missing-supersede-link::');
    const js = io();
    await runCli(['lint', '--format=json'], js);
    const parsed = JSON.parse(js.stdout);
    expect(parsed.records).toBe(2);
    expect(parsed.issues[0].filePath).toBe('decisions/0002-use-y.md');
  });

  it('enforces governance', async () => {
    const bad = io();
    expect(await runCli(['governance', '--files', 'src/api/a.ts,README.md', '--format', 'github'], bad)).toBe(1);
    expect(bad.stdout).toContain('::error file=src/api/a.ts,title=ADR required::');
    expect(await runCli(['governance', '--files', 'src/api/a.ts,decisions/0003-new.md'], io())).toBe(0);
    expect(await runCli(['governance', '--files', 'src/api/a.ts', '--warn-only'], io())).toBe(0);
  });

  it('asks git for changed files with the PR base', async () => {
    const calls: string[][] = [];
    const o = io({
      env: { GITHUB_BASE_REF: 'main' },
      changedFiles: async (r, base, head) => {
        calls.push([r, base, head]);
        return ['docs/readme.md'];
      },
    });
    expect(await runCli(['governance'], o)).toBe(0);
    expect(calls).toEqual([[root, 'origin/main', 'HEAD']]);
  });

  it('prints graph, index and summary, and writes files', async () => {
    const g = io();
    await runCli(['graph', '--format', 'dot'], g);
    expect(g.stdout).toContain('digraph adr');
    const s = io();
    await runCli(['summary'], s);
    expect(s.stdout).toContain('**2 ADRs**');
    await runCli(['index', '--group', 'status', '--out', 'decisions/index.md'], io());
    expect(readFileSync(path.join(root, 'decisions', 'index.md'), 'utf8')).toContain('## Accepted (1)');
    expect((await loadRecords(path.join(root, 'decisions'))).length).toBe(2);
  });

  it('handles usage errors', async () => {
    expect(await runCli([], io())).toBe(64);
    expect(await runCli(['--help'], io())).toBe(0);
    expect(await runCli(['nope'], io())).toBe(64);
    expect(await runCli(['graph', '--format', 'svg'], io())).toBe(2);
    const missing = io({ cwd: tmpdir() });
    expect(await runCli(['lint', '--dir', 'definitely-missing-dir'], missing)).toBe(2);
  });
});
