/**
 * Report formatters for the CLI: plain text, JSON and GitHub Actions workflow
 * commands (`::error file=…,line=…::message`) so findings land on the PR diff.
 */
import type { Issue, Severity } from './validator';

/** Escaping for the message part of a workflow command. */
export function escapeData(value: string): string {
  return value.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}

/** Escaping for a property value (`file=`, `title=`), where `:` and `,` are separators. */
export function escapeProperty(value: string): string {
  return escapeData(value).replace(/:/g, '%3A').replace(/,/g, '%2C');
}

/** Relativise to the repository root; a path outside it keeps its absolute form. */
export function relativeTo(root: string, path: string): string {
  const norm = (p: string) => p.replace(/\\/g, '/');
  const r = norm(root).replace(/\/+$/, '');
  const p = norm(path);
  if (r && p.toLowerCase().startsWith(`${r.toLowerCase()}/`)) return p.slice(r.length + 1);
  return p;
}

const LEVEL: Record<Severity, string> = { error: 'error', warning: 'warning', info: 'notice' };

export function githubAnnotation(issue: Issue, root: string): string {
  const file = escapeProperty(relativeTo(root, issue.filePath));
  const title = escapeProperty(`ADR ${issue.code}`);
  return `::${LEVEL[issue.severity]} file=${file},line=${issue.line + 1},title=${title}::${escapeData(issue.message)}`;
}

export function textLine(issue: Issue, root: string): string {
  return `${relativeTo(root, issue.filePath)}:${issue.line + 1}  ${issue.severity.padEnd(7)} ${issue.message}  [${issue.code}]`;
}

export function severityRank(s: Severity): number {
  return s === 'error' ? 3 : s === 'warning' ? 2 : 1;
}

export type FailOn = 'error' | 'warning' | 'info' | 'never';

export function shouldFail(issues: Issue[], failOn: FailOn): boolean {
  if (failOn === 'never') return false;
  const threshold = severityRank(failOn);
  return issues.some((i) => severityRank(i.severity) >= threshold);
}
