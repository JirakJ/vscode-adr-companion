/**
 * "Create ADR from merged PR": parsing `git log --merges` output and turning a
 * pull-request description into Context / Decision / Consequences.
 */

/** ASCII unit and record separators — commit messages never contain them. */
export const FIELD_SEP = '\x1f';
export const RECORD_SEP = '\x1e';
export const MERGE_LOG_FORMAT = '%H%x1f%an%x1f%aI%x1f%s%x1f%b%x1e';

export interface MergeCommit {
  hash: string;
  author: string;
  date: string;
  subject: string;
  body: string;
}

export function mergeLogArgs(limit: number): string[] {
  return ['log', '--merges', '-n', String(Math.max(1, Math.min(limit, 500))), `--pretty=format:${MERGE_LOG_FORMAT}`];
}

export function parseMergeLog(output: string): MergeCommit[] {
  return output
    .split(RECORD_SEP)
    .map((r) => r.replace(/^[\r\n]+|[\r\n]+$/g, ''))
    .filter((r) => r.trim().length > 0)
    .map((record) => record.split(FIELD_SEP))
    .filter((f) => f.length >= 4 && f[0]!.trim().length > 0)
    .map((f) => ({
      hash: f[0]!.trim(),
      author: (f[1] ?? '').trim(),
      date: (f[2] ?? '').trim(),
      subject: (f[3] ?? '').trim(),
      body: (f[4] ?? '').trim(),
    }));
}

const PR_NUMBER_PATTERNS = [/Merge pull request #(\d+)/i, /merge request !(\d+)/i, /\(#(\d+)\)/, /#(\d+)/];

export function extractPrNumber(text: string): number | null {
  for (const p of PR_NUMBER_PATTERNS) {
    const m = p.exec(text);
    if (m) return Number(m[1]);
  }
  return null;
}

/** Source branch of a merge subject (`… from owner/feature/x`, `Merge branch 'x'`). */
export function extractBranchName(subject: string): string {
  const github = /\bfrom\s+[^/\s]+\/(\S+)/i.exec(subject);
  if (github) return github[1]!;
  const branch = /Merge (?:remote-tracking )?branch '([^']+)'/i.exec(subject);
  if (branch) return branch[1]!;
  return '';
}

function humanizeBranch(branch: string): string {
  return branch
    .split('/')
    .pop()!
    .split(/[-_.]+/)
    .filter((w) => w.length > 0 && !/^\d+$/.test(w))
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

const MAX_TITLE = 100;

/**
 * A human title for the record: the first Markdown heading of the body, the
 * PR title (first body line on GitHub merges), the humanised branch name, or
 * the cleaned subject.
 */
export function suggestTitle(subject: string, body = ''): string {
  // A leading heading that is not a section name is the title.
  const firstBody = body.split(/\r?\n/).map((l) => l.trim()).find((l) => l.length > 0);
  if (firstBody && /^#{1,6}\s+\S/.test(firstBody) && !/^#{1,6}\s+(context|background|problem|decision|consequences|impact|summary|motivation)\b/i.test(firstBody)) {
    return firstBody.replace(/^#+\s*/, '').slice(0, MAX_TITLE);
  }
  // GitHub merge commits put the PR title on the first body line.
  if (firstBody && /^Merge pull request/i.test(subject) && !firstBody.startsWith('#')) return firstBody.slice(0, MAX_TITLE);
  const branch = extractBranchName(subject);
  if (branch) {
    const human = humanizeBranch(branch);
    if (human) return human.slice(0, MAX_TITLE);
  }
  const cleaned = subject
    .replace(/^Merge (pull request|branch|remote-tracking branch)\b.*?(?:from\s+\S+|'[^']*')?\s*/i, '')
    .replace(/\s*\(#\d+\)\s*$/, '')
    .trim()
    .replace(/^['"]|['"]$/g, '');
  return (cleaned || 'Untitled Decision').slice(0, MAX_TITLE);
}

const SECTION_TITLES = {
  context: /^(context(\s+and\s+problem\s+statement)?|background|problem|motivation|why)$/i,
  decision: /^(decision(\s+outcome)?|architecture\s+decision|solution|approach|what|changes?)$/i,
  consequences: /^(consequences|impact|positive\s+consequences|trade-?offs|risks)$/i,
};

/** Body text of the first `##`/`###` section whose title matches. */
export function extractSection(description: string, pattern: RegExp): string {
  const lines = description.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const h = /^(#{1,6})\s+(.+?)\s*#*$/.exec(lines[i]!.trim());
    if (!h || !pattern.test(h[2]!.replace(/[*_`:]/g, '').trim())) continue;
    const level = h[1]!.length;
    const body: string[] = [];
    for (let j = i + 1; j < lines.length; j++) {
      const next = /^(#{1,6})\s+/.exec(lines[j]!.trim());
      if (next && next[1]!.length <= level) break;
      body.push(lines[j]!);
    }
    return body.join('\n').trim();
  }
  return '';
}

export interface PrDecision {
  title: string;
  context: string;
  decision: string;
  consequences: string;
  prNumber: number | null;
}

export function extractDecision(description: string, subject = ''): PrDecision {
  let context = extractSection(description, SECTION_TITLES.context);
  const decision = extractSection(description, SECTION_TITLES.decision);
  const consequences = extractSection(description, SECTION_TITLES.consequences);
  if (!context && !decision && !consequences) {
    // An unstructured description becomes the context, minus a title line.
    const lines = description.split(/\r?\n/);
    if (/^Merge pull request/i.test(subject) && lines.length > 0) lines.shift();
    context = lines.join('\n').trim();
  }
  return {
    title: suggestTitle(subject, description),
    context,
    decision,
    consequences,
    prNumber: extractPrNumber(`${subject}\n${description}`),
  };
}

export function containsDecisionContent(description: string): boolean {
  return Object.values(SECTION_TITLES).some((p) => extractSection(description, p).length > 0);
}
