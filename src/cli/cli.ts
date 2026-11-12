/**
 * `adr-companion` command line — the same rules as the editor, for CI.
 *
 *   adr-companion lint        [--format text|json|github] [--fail-on error|warning|info|never]
 *   adr-companion governance  [--base <ref>] [--head <ref>] [--files a,b] [--format text|github] [--warn-only]
 *   adr-companion graph       [--format mermaid|dot] [--direction TD|LR] [--cluster] [--out <file>]
 *   adr-companion index       [--group none|status|year] [--out <file>]
 *   adr-companion summary
 *
 * Common: --root <repo> (default: cwd), --dir <adr directory> (default: from
 * .adr-config.yaml, else auto-detected).
 */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { githubAnnotation, escapeData, escapeProperty, FailOn, shouldFail, textLine } from '../core/annotations';
import { evaluateGovernance } from '../core/governance';
import { buildGraph, renderDot, renderMermaid } from '../core/graph';
import { IndexGrouping, renderIndex, renderSummary } from '../core/summary';
import { todayIso } from '../core/templates';
import { DEFAULT_LINT_OPTIONS, lintAll } from '../core/validator';
import { changedFilesBetween, defaultBaseRef } from '../node/git';
import { detectAdrDirectory, loadRecords, readProjectConfig } from '../node/workspace';

export interface CliIO {
  out: (text: string) => void;
  err: (text: string) => void;
  cwd: string;
  env: Record<string, string | undefined>;
  /** Injectable for tests. */
  changedFiles?: (root: string, base: string, head: string) => Promise<string[]>;
  today?: string;
}

export const USAGE = `Usage: adr-companion <command> [options]

Commands:
  lint         Validate every decision record (structure, lifecycle, numbering)
  governance   Fail when files matching requireAdrForPaths change without an ADR
  graph        Print the relationship graph (Mermaid or Graphviz DOT)
  index        Print a Markdown index of the decision log
  summary      Print a shareable Markdown status summary

Options:
  --root <dir>         Repository root (default: current directory)
  --dir <dir>          ADR directory relative to the root (default: .adr-config.yaml, then auto-detect)
  --format <fmt>       lint: text|json|github  governance: text|github  graph: mermaid|dot
  --fail-on <level>    lint: error (default) | warning | info | never
  --base <ref>         governance: base ref (default: $GITHUB_BASE_REF, then origin/HEAD)
  --head <ref>         governance: head ref (default: HEAD)
  --files <a,b,...>    governance: check these paths instead of asking git
  --warn-only          governance: report but exit 0
  --direction TD|LR    graph layout direction
  --cluster            graph: group nodes by status
  --group <g>          index: none|status|year
  --out <file>         write output to a file instead of stdout
  -h, --help           Show this help
`;

interface Args {
  command: string;
  flags: Map<string, string | true>;
}

const BOOLEAN_FLAGS = new Set(['cluster', 'warn-only', 'help']);

export function parseArgs(argv: string[]): Args {
  const flags = new Map<string, string | true>();
  let command = '';
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '-h') {
      flags.set('help', true);
    } else if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      const name = eq > 0 ? a.slice(2, eq) : a.slice(2);
      if (eq > 0) flags.set(name, a.slice(eq + 1));
      else if (BOOLEAN_FLAGS.has(name)) flags.set(name, true);
      else {
        const value = argv[i + 1];
        if (value === undefined || value.startsWith('--')) throw new Error(`Option --${name} needs a value.`);
        flags.set(name, value);
        i++;
      }
    } else if (!command) {
      command = a;
    } else {
      throw new Error(`Unexpected argument: ${a}`);
    }
  }
  return { command, flags };
}

function str(args: Args, name: string): string | undefined {
  const v = args.flags.get(name);
  return typeof v === 'string' ? v : undefined;
}

function oneOf<T extends string>(args: Args, name: string, allowed: readonly T[], fallback: T): T {
  const v = str(args, name);
  if (v === undefined) return fallback;
  if (!(allowed as readonly string[]).includes(v)) throw new Error(`--${name} must be one of: ${allowed.join(', ')}.`);
  return v as T;
}

async function emit(args: Args, io: CliIO, root: string, text: string): Promise<void> {
  const out = str(args, 'out');
  if (out) {
    const target = path.resolve(root, out);
    await fs.mkdir(path.dirname(target), { recursive: true });
    const tmp = `${target}.${process.pid}.tmp`;
    await fs.writeFile(tmp, text, 'utf8');
    await fs.rename(tmp, target);
    io.err(`Wrote ${path.relative(root, target) || target}`);
  } else {
    io.out(text);
  }
}

export async function runCli(argv: string[], io: CliIO): Promise<number> {
  let args: Args;
  try {
    args = parseArgs(argv);
  } catch (e) {
    io.err(`${(e as Error).message}\n\n${USAGE}`);
    return 64;
  }
  if (args.flags.has('help') || !args.command || args.command === 'help') {
    io.out(USAGE);
    return args.command || args.flags.has('help') ? 0 : 64;
  }
  try {
    const root = path.resolve(io.cwd, str(args, 'root') ?? '.');
    const team = await readProjectConfig(root);
    for (const w of team?.config.warnings ?? []) io.err(`.adr-config.yaml: ${w}`);
    const located = await detectAdrDirectory(root, str(args, 'dir') ?? team?.config.directory);
    const adrDir = located?.dir ?? '';

    switch (args.command) {
      case 'lint': {
        const format = oneOf(args, 'format', ['text', 'json', 'github'] as const, 'text');
        const failOn = oneOf(args, 'fail-on', ['error', 'warning', 'info', 'never'] as const, 'error') as FailOn;
        if (!located?.exists) {
          io.err(`No ADR directory found${adrDir ? ` (${adrDir} does not exist)` : ''}. Use --dir or set "directory" in .adr-config.yaml.`);
          return 2;
        }
        const records = await loadRecords(path.join(root, adrDir));
        const issues = lintAll(records, {
          ...DEFAULT_LINT_OPTIONS,
          today: io.today ?? todayIso(),
          maxProposedAgeDays: team?.config.maxProposedAgeDays ?? DEFAULT_LINT_OPTIONS.maxProposedAgeDays,
          stalenessThresholdDays: team?.config.stalenessThresholdDays ?? DEFAULT_LINT_OPTIONS.stalenessThresholdDays,
        });
        const counts = { error: 0, warning: 0, info: 0 };
        for (const i of issues) counts[i.severity]++;
        const summary = `${records.length} decision record(s) in ${adrDir}: ${counts.error} error(s), ${counts.warning} warning(s), ${counts.info} info.`;
        if (format === 'json') {
          io.out(JSON.stringify({ directory: adrDir, records: records.length, counts, issues: issues.map((i) => ({ ...i, filePath: path.relative(root, i.filePath).replace(/\\/g, '/'), line: i.line + 1 })) }, null, 2) + '\n');
        } else if (format === 'github') {
          for (const i of issues) io.out(githubAnnotation(i, root) + '\n');
          io.out(`::notice title=ADR lint::${escapeData(summary)}\n`);
        } else {
          for (const i of issues) io.out(textLine(i, root) + '\n');
          io.out(summary + '\n');
        }
        return shouldFail(issues, failOn) ? 1 : 0;
      }
      case 'governance': {
        const format = oneOf(args, 'format', ['text', 'github'] as const, 'text');
        const patterns = team?.config.requireAdrForPaths ?? [];
        let changed: string[];
        const files = str(args, 'files');
        if (files !== undefined) {
          changed = files.split(',').map((f) => f.trim()).filter(Boolean);
        } else {
          const envBase = io.env.GITHUB_BASE_REF ? `origin/${io.env.GITHUB_BASE_REF}` : undefined;
          const base = str(args, 'base') ?? envBase ?? (await defaultBaseRef(root));
          if (!base) throw new Error('Could not determine a base ref — pass --base <ref>.');
          const head = str(args, 'head') ?? 'HEAD';
          changed = await (io.changedFiles ?? changedFilesBetween)(root, base, head);
        }
        const verdict = evaluateGovernance(changed, patterns, adrDir);
        if (format === 'github' && verdict.triggered) {
          const level = args.flags.has('warn-only') ? 'warning' : 'error';
          for (const p of verdict.matchedPaths) {
            io.out(`::${level} file=${escapeProperty(p)},title=ADR required::${escapeData('Architecturally significant change without a decision record (requireAdrForPaths in .adr-config.yaml).')}\n`);
          }
        }
        io.out(verdict.message + '\n');
        return verdict.triggered && !args.flags.has('warn-only') ? 1 : 0;
      }
      case 'graph': {
        const format = oneOf(args, 'format', ['mermaid', 'dot'] as const, 'mermaid');
        const direction = oneOf(args, 'direction', ['TD', 'LR'] as const, 'TD');
        const records = located?.exists ? await loadRecords(path.join(root, adrDir)) : [];
        const model = buildGraph(records);
        const options = { direction, clusterByStatus: args.flags.has('cluster') };
        await emit(args, io, root, format === 'dot' ? renderDot(model, options) : renderMermaid(model, options));
        return 0;
      }
      case 'index': {
        const group = oneOf(args, 'group', ['none', 'status', 'year'] as const, 'none') as IndexGrouping;
        const records = located?.exists ? await loadRecords(path.join(root, adrDir)) : [];
        await emit(args, io, root, renderIndex(records, group));
        return 0;
      }
      case 'summary': {
        const records = located?.exists ? await loadRecords(path.join(root, adrDir)) : [];
        await emit(args, io, root, renderSummary(records));
        return 0;
      }
      default:
        io.err(`Unknown command: ${args.command}\n\n${USAGE}`);
        return 64;
    }
  } catch (e) {
    io.err(`adr-companion: ${(e as Error).message}`);
    return 2;
  }
}
