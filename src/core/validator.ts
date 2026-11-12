/**
 * Decision-log lint: per-record structure and lifecycle checks plus the
 * cross-file checks (duplicate numbers, dangling supersede links).
 *
 * Pure — the caller supplies parsed records and "today", so the same rules run
 * in the editor (as diagnostics), in the CLI and in tests.
 */
import { AdrRecord, formatId } from './parser';
import { analyzeNumbering } from './numbering';
import { statusDisplayName } from './status';

export type Severity = 'error' | 'warning' | 'info';

export type IssueCode =
  | 'missing-title'
  | 'missing-number'
  | 'missing-status'
  | 'unknown-status'
  | 'invalid-date'
  | 'missing-required-field'
  | 'missing-supersede-link'
  | 'dangling-supersede-link'
  | 'rejected-without-rationale'
  | 'stale-proposed'
  | 'review-due'
  | 'duplicate-number'
  | 'number-mismatch'
  | 'template-placeholder';

export interface Issue {
  filePath: string;
  /** 0-based line; 0 when the problem is about the whole file. */
  line: number;
  severity: Severity;
  code: IssueCode;
  message: string;
  adrId: number | null;
}

export interface LintOptions {
  /** ISO date treated as today. */
  today: string;
  maxProposedAgeDays: number;
  /** 0 disables the review reminder for old accepted records. */
  stalenessThresholdDays: number;
}

export const DEFAULT_LINT_OPTIONS: Omit<LintOptions, 'today'> = {
  maxProposedAgeDays: 30,
  stalenessThresholdDays: 0,
};

const PLACEHOLDER = /(TODO: describe the|What is the issue that motivates|What is the change that we are proposing|What becomes easier or more difficult to do|Describe the context and the problem in two|<use case \/ user story>|\[Describe the )/;

function daysBetween(fromIso: string, toIso: string): number {
  const a = Date.parse(`${fromIso}T00:00:00Z`);
  const b = Date.parse(`${toIso}T00:00:00Z`);
  return Math.floor((b - a) / 86_400_000);
}

export function lintRecord(record: AdrRecord, options: LintOptions, knownIds?: Set<number>): Issue[] {
  const issues: Issue[] = [];
  const add = (code: IssueCode, severity: Severity, message: string, line: number) =>
    issues.push({ filePath: record.filePath, line: Math.max(line, 0), severity, code, message, adrId: record.id });
  const statusAt = record.statusLine >= 0 ? record.statusLine : Math.max(record.titleLine, 0);

  if (!record.title) add('missing-title', 'error', 'Decision record has no title (front-matter `title:` or a `# heading`).', 0);
  if (record.id == null) {
    add('missing-number', 'warning', 'Decision record has no number — name the file `0001-title.md` or add `number:` to the front matter.', 0);
  }
  if (record.statusRaw == null) {
    add('missing-status', 'warning', 'No status declared — add a `## Status` section or a `status:` front-matter key.', Math.max(record.titleLine, 0));
  } else if (record.status === 'unknown') {
    add('unknown-status', 'warning', `Unknown status "${record.statusRaw}". Use Draft, Proposed, Accepted, Rejected, Deprecated or Superseded.`, statusAt);
  }
  if (record.dateRaw && !record.date) {
    add('invalid-date', 'warning', `Date "${record.dateRaw}" is not a valid ISO date (yyyy-mm-dd).`, record.dateLine);
  }

  // Numbers declared in different places must agree.
  const declared = [
    ['front matter', record.frontMatterNumber],
    ['title heading', record.headingNumber],
    ['file name', record.fileNumber],
  ].filter((p): p is [string, number] => p[1] != null);
  const distinct = new Set(declared.map((p) => p[1]));
  if (distinct.size > 1) {
    add(
      'number-mismatch',
      'warning',
      `Conflicting numbers: ${declared.map(([where, n]) => `${where} says ${n}`).join(', ')}.`,
      Math.max(record.titleLine, 0),
    );
  }

  const status = record.status;
  const name = statusDisplayName(status);
  const missing = (field: string, severity: Severity, line: number) =>
    add('missing-required-field', severity, `Record is ${name} but its ${field} is missing or empty.`, line);
  if (status === 'accepted') {
    if (!record.decision) missing('Decision', 'error', statusAt);
    if (!record.consequences) missing('Consequences', 'error', statusAt);
    if (!record.date) missing('Date', 'error', record.dateLine >= 0 ? record.dateLine : statusAt);
  } else if (status === 'deprecated') {
    if (!record.date) missing('Date', 'error', statusAt);
  } else if (status === 'superseded') {
    if (!record.date) missing('Date', 'warning', statusAt);
  }

  if (status === 'superseded') {
    if (record.supersededBy.length === 0) {
      add('missing-supersede-link', 'error', 'Record is Superseded but names no successor ("Superseded by ADR-NNNN").', statusAt);
    } else if (knownIds && knownIds.size > 0) {
      const dangling = record.supersededBy.filter((id) => !knownIds.has(id));
      if (dangling.length > 0) {
        add(
          'dangling-supersede-link',
          'error',
          `"Superseded by" points at ${dangling.map((d) => `ADR-${formatId(d)}`).join(', ')}, which does not exist.`,
          statusAt,
        );
      }
    }
  }
  if (knownIds && knownIds.size > 0) {
    const dangling = record.supersedes.filter((id) => !knownIds.has(id));
    if (dangling.length > 0) {
      add(
        'dangling-supersede-link',
        'warning',
        `"Supersedes" points at ${dangling.map((d) => `ADR-${formatId(d)}`).join(', ')}, which does not exist.`,
        statusAt,
      );
    }
  }

  if (status === 'rejected' && !record.decision && !record.consequences && !record.notes && !record.context) {
    add('rejected-without-rationale', 'error', 'Record is Rejected but gives no rationale (Context, Decision, Consequences or Notes).', statusAt);
  }

  if (status === 'proposed' && record.date) {
    const age = daysBetween(record.date, options.today);
    if (age > options.maxProposedAgeDays) {
      add('stale-proposed', 'warning', `Proposed for ${age} days (threshold ${options.maxProposedAgeDays}). Accept it, reject it or move it back to Draft.`, statusAt);
    }
  }
  if (status === 'accepted' && record.date && options.stalenessThresholdDays > 0) {
    const age = daysBetween(record.date, options.today);
    if (age > options.stalenessThresholdDays) {
      add('review-due', 'info', `Accepted ${age} days ago — consider reviewing whether this decision still holds.`, statusAt);
    }
  }

  if (status === 'accepted') {
    const section = record.sections.find((s) => PLACEHOLDER.test(s.body));
    if (section) {
      add('template-placeholder', 'warning', `Section "${section.title}" still contains template placeholder text.`, section.line);
    }
  }
  return issues;
}

/** Lint the whole decision log, including cross-file checks. */
export function lintAll(records: AdrRecord[], options: LintOptions): Issue[] {
  const knownIds = new Set(records.map((r) => r.id).filter((id): id is number => id != null));
  const issues = records.flatMap((r) => lintRecord(r, options, knownIds));
  const numbering = analyzeNumbering(records.map((r) => ({ fileName: r.fileName, id: r.id })));
  for (const record of records) {
    if (record.id == null) continue;
    const claimants = numbering.duplicates.get(record.id);
    if (!claimants) continue;
    const others = claimants.filter((c) => c !== record.fileName);
    issues.push({
      filePath: record.filePath,
      line: Math.max(record.titleLine, 0),
      severity: 'error',
      code: 'duplicate-number',
      message: `ADR number ${record.id} is also claimed by ${others.map((o) => `\`${o}\``).join(', ')}. Renumber one of them ("ADR: Renumber ADR…").`,
      adrId: record.id,
    });
  }
  return issues.sort(
    (a, b) => a.filePath.localeCompare(b.filePath) || a.line - b.line || a.code.localeCompare(b.code),
  );
}
