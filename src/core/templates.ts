/**
 * Built-in ADR templates, custom-template placeholder substitution and file naming.
 */

export type AdrFormat = 'nygard' | 'madr' | 'rfc' | 'y-statement' | 'tyree-akerman' | 'custom';

export const FORMATS: readonly { id: AdrFormat; label: string; detail: string }[] = [
  { id: 'nygard', label: 'Nygard (Classic)', detail: 'Status / Context / Decision / Consequences' },
  { id: 'madr', label: 'MADR', detail: 'Markdown Architectural Decision Records with YAML front matter' },
  { id: 'rfc', label: 'RFC', detail: 'Summary / Motivation / Detailed Design / Drawbacks / Alternatives' },
  { id: 'y-statement', label: 'Y-Statement', detail: '"In the context of … accepting that …" in one sentence' },
  { id: 'tyree-akerman', label: 'Tyree & Akerman', detail: 'Issue / Decision / Assumptions / Constraints / Positions / Argument' },
  { id: 'custom', label: 'Custom', detail: 'Your own template file with {{placeholders}}' },
];

/** Accepts the JetBrains-style enum names (`MADR`, `Y_STATEMENT`) as well as ids. */
export function parseFormat(value: string | undefined | null): AdrFormat | null {
  if (!value) return null;
  const v = value.trim().toLowerCase().replace(/[_\s&]+/g, '-').replace(/-+/g, '-');
  const map: Record<string, AdrFormat> = {
    nygard: 'nygard',
    classic: 'nygard',
    'nygard-classic': 'nygard',
    madr: 'madr',
    rfc: 'rfc',
    'y-statement': 'y-statement',
    ystatement: 'y-statement',
    'tyree-akerman': 'tyree-akerman',
    tyree: 'tyree-akerman',
    custom: 'custom',
  };
  return map[v] ?? null;
}

export const CUSTOM_TEMPLATE_NAMES = ['.adr-template.md', 'template.md'];

export interface TemplateInput {
  number: number;
  title: string;
  /** ISO date, injected so output is deterministic. */
  date: string;
  status?: string;
}

export function slugify(title: string): string {
  const slug = title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug.slice(0, 80).replace(/-+$/, '') || 'decision';
}

export function adrFileName(number: number, title: string, width = 4): string {
  return `${String(number).padStart(width, '0')}-${slugify(title)}.md`;
}

function frontMatter(input: TemplateInput): string {
  return [
    '---',
    `number: ${input.number}`,
    `title: ${yamlScalar(input.title)}`,
    `status: ${input.status ?? 'proposed'}`,
    `date: ${input.date}`,
    '---',
  ].join('\n');
}

/** Quote a YAML scalar only when it would otherwise be misread. */
export function yamlScalar(value: string): string {
  if (/^[\w][\w .,()/'+-]*$/.test(value) && !/:\s/.test(value) && !/\s#/.test(value)) return value;
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function cap(status: string | undefined): string {
  const s = status ?? 'proposed';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function renderTemplate(format: Exclude<AdrFormat, 'custom'>, input: TemplateInput): string {
  const { number, title, date } = input;
  const status = cap(input.status);
  switch (format) {
    case 'nygard':
      return [
        `# ${number}. ${title}`,
        '',
        `Date: ${date}`,
        '',
        '## Status',
        '',
        status,
        '',
        '## Context',
        '',
        'What is the issue that motivates this decision or change?',
        '',
        '## Decision',
        '',
        'What is the change that we are proposing and/or doing?',
        '',
        '## Consequences',
        '',
        'What becomes easier or more difficult to do because of this change?',
        '',
      ].join('\n');
    case 'madr':
      return [
        frontMatter(input),
        `# ${title}`,
        '',
        '## Context and Problem Statement',
        '',
        'Describe the context and the problem in two or three sentences.',
        '',
        '## Considered Options',
        '',
        '* Option 1',
        '* Option 2',
        '',
        '## Decision Outcome',
        '',
        'Chosen option: "Option 1", because it is the only option that meets the key requirement.',
        '',
        '### Positive Consequences',
        '',
        '* Improvement in quality attribute, follow-up decisions required, …',
        '',
        '### Negative Consequences',
        '',
        '* Compromising quality attribute, follow-up decisions required, …',
        '',
      ].join('\n');
    case 'rfc':
      return [
        frontMatter(input),
        `# RFC-${number}: ${title}`,
        '',
        '## Status',
        '',
        status,
        '',
        '## Summary',
        '',
        'One-paragraph explanation of the proposal.',
        '',
        '## Motivation',
        '',
        'Why are we doing this? What problem does it solve? What is the expected outcome?',
        '',
        '## Detailed Design',
        '',
        'Explain the design in enough detail for somebody familiar with the system to implement it.',
        '',
        '## Drawbacks',
        '',
        'Why should we not do this?',
        '',
        '## Alternatives',
        '',
        'What other designs were considered? What is the impact of not doing this?',
        '',
        '## Unresolved Questions',
        '',
        'What parts of the design are still to be determined?',
        '',
      ].join('\n');
    case 'y-statement':
      return [
        frontMatter(input),
        `# ${number}. ${title}`,
        '',
        '## Status',
        '',
        status,
        '',
        '## Y-Statement',
        '',
        'In the context of <use case / user story>,',
        'facing <concern / non-functional requirement>,',
        'we decided for <option chosen>',
        'and neglected <alternative options>,',
        'to achieve <quality / benefit>,',
        'accepting that <drawback / consequence>.',
        '',
      ].join('\n');
    case 'tyree-akerman':
      return [
        `# ${number}. ${title}`,
        '',
        `Date: ${date}`,
        '',
        '## Status',
        '',
        status,
        '',
        '## Issue',
        '',
        'Describe the architectural design issue being addressed.',
        '',
        '## Decision',
        '',
        'State the decision.',
        '',
        '## Assumptions',
        '',
        'List the assumptions about the environment (cost, schedule, technology).',
        '',
        '## Constraints',
        '',
        'Capture any additional constraints the decision introduces.',
        '',
        '## Positions',
        '',
        'List the positions (viable options) that were considered.',
        '',
        '## Argument',
        '',
        'Outline why the chosen position was selected.',
        '',
        '## Implications',
        '',
        'Describe what becomes easier or more difficult because of this decision.',
        '',
        '## Related Decisions',
        '',
        'List related ADRs, e.g. ADR-0001.',
        '',
        '## Notes',
        '',
        'Capture notes and issues discussed during the decision process.',
        '',
      ].join('\n');
  }
}

/**
 * Fill a user template. Supported placeholders: `{{number}}`,
 * `{{number:0000}}` (zero-padded to the width of the zeros), `{{title}}`,
 * `{{date}}`, `{{status}}` — whitespace inside the braces is allowed.
 */
export function substitutePlaceholders(template: string, input: TemplateInput): string {
  return template.replace(/\{\{\s*(number|title|date|status)\s*(?::\s*(0+)\s*)?\}\}/g, (_m, key: string, zeros?: string) => {
    switch (key) {
      case 'number':
        return zeros ? String(input.number).padStart(zeros.length, '0') : String(input.number);
      case 'title':
        return input.title;
      case 'date':
        return input.date;
      default:
        return input.status ?? 'proposed';
    }
  });
}

export interface DecisionContent {
  context: string;
  decision: string;
  consequences: string;
  /** Extra provenance line, e.g. "Source: PR #42 (abc1234) by Jane". */
  source?: string;
}

/** An ADR pre-filled with extracted content (used by "Create ADR from merged PR"). */
export function renderFilled(format: AdrFormat, input: TemplateInput, content: DecisionContent): string {
  const todo = (text: string, what: string) => (text.trim() ? text.trim() : `TODO: describe the ${what}.`);
  const source = content.source ? [content.source, ''] : [];
  if (format === 'madr' || format === 'rfc' || format === 'y-statement') {
    return [
      frontMatter(input),
      `# ${input.title}`,
      '',
      ...source,
      '## Context and Problem Statement',
      '',
      todo(content.context, 'context'),
      '',
      '## Decision Outcome',
      '',
      todo(content.decision, 'decision'),
      '',
      '## Consequences',
      '',
      todo(content.consequences, 'consequences'),
      '',
    ].join('\n');
  }
  return [
    `# ${input.number}. ${input.title}`,
    '',
    `Date: ${input.date}`,
    '',
    '## Status',
    '',
    cap(input.status),
    '',
    ...source,
    '## Context',
    '',
    todo(content.context, 'context'),
    '',
    '## Decision',
    '',
    todo(content.decision, 'decision'),
    '',
    '## Consequences',
    '',
    todo(content.consequences, 'consequences'),
    '',
  ].join('\n');
}

export function todayIso(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
