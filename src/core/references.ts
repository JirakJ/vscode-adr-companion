/**
 * Code ↔ ADR references.
 *
 * The explicit annotation form (`@adr:42`, `@adr-42`, `@adr#42`, `@ADR(42)`)
 * drives hovers, links, completion and the missing/outdated-reference check.
 * Prose mentions such as "see ADR 7" are only counted by the broader
 * {@link REFERENCE_PATTERN} used when renumbering, so ADR documents that talk
 * about other decisions never light up as broken code links.
 */
import type { AdrRecord } from './parser';
import { REFERENCE_PATTERN } from './numbering';
import { isInactive, statusDisplayName } from './status';

export interface CodeReference {
  id: number;
  line: number;
  /** Column of the first character of the annotation. */
  start: number;
  end: number;
  text: string;
}

const ANNOTATION = /@adr(?:\s*\(\s*0*(\d{1,5})\s*\)|[:#-]\s?0*(\d{1,5}))(?![A-Za-z0-9_])/gi;

export function findAnnotations(text: string): CodeReference[] {
  const out: CodeReference[] = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((lineText, line) => {
    for (const m of lineText.matchAll(ANNOTATION)) {
      const id = Number(m[1] ?? m[2]);
      out.push({ id, line, start: m.index!, end: m.index! + m[0].length, text: m[0] });
    }
  });
  return out;
}

/** Every mention of an ADR number, annotation or prose (`ADR-7`, `ADR 7`). */
export function findMentions(text: string): CodeReference[] {
  const out: CodeReference[] = [];
  text.split(/\r?\n/).forEach((lineText, line) => {
    for (const m of lineText.matchAll(REFERENCE_PATTERN)) {
      out.push({ id: Number(m[3]), line, start: m.index!, end: m.index! + m[0].length, text: m[0] });
    }
  });
  return out;
}

export type ReferenceProblem =
  | { kind: 'missing'; message: string }
  | { kind: 'inactive'; message: string; successor?: number };

export function checkReference(id: number, records: Map<number, AdrRecord>): ReferenceProblem | null {
  const record = records.get(id);
  const label = `ADR-${String(id).padStart(4, '0')}`;
  if (!record) return { kind: 'missing', message: `${label} does not exist in the decision log.` };
  if (isInactive(record.status)) {
    const successor = record.supersededBy[0];
    const tail = successor ? ` — superseded by ADR-${String(successor).padStart(4, '0')}.` : '.';
    return {
      kind: 'inactive',
      message: `${label} "${record.title}" is ${statusDisplayName(record.status)}${tail}`,
      successor,
    };
  }
  return null;
}

/** Line-comment syntax per VS Code language id, for "Link Code to ADR". */
const COMMENT: Record<string, [string, string]> = {
  python: ['# ', ''],
  ruby: ['# ', ''],
  shellscript: ['# ', ''],
  yaml: ['# ', ''],
  toml: ['# ', ''],
  dockerfile: ['# ', ''],
  makefile: ['# ', ''],
  perl: ['# ', ''],
  r: ['# ', ''],
  powershell: ['# ', ''],
  elixir: ['# ', ''],
  coffeescript: ['# ', ''],
  terraform: ['# ', ''],
  properties: ['# ', ''],
  sql: ['-- ', ''],
  lua: ['-- ', ''],
  haskell: ['-- ', ''],
  ada: ['-- ', ''],
  html: ['<!-- ', ' -->'],
  xml: ['<!-- ', ' -->'],
  markdown: ['<!-- ', ' -->'],
  vue: ['<!-- ', ' -->'],
  css: ['/* ', ' */'],
  scss: ['// ', ''],
  less: ['// ', ''],
  bat: ['REM ', ''],
  ini: ['; ', ''],
  clojure: ['; ', ''],
  lisp: ['; ', ''],
  erlang: ['% ', ''],
  latex: ['% ', ''],
  matlab: ['% ', ''],
  vb: ["' ", ''],
};

export function commentFor(languageId: string): [string, string] {
  return COMMENT[languageId] ?? ['// ', ''];
}

export function annotationLine(languageId: string, id: number, title: string, indent = ''): string {
  const [open, close] = commentFor(languageId);
  return `${indent}${open}@adr:${String(id).padStart(4, '0')} ${title}${close}`;
}
