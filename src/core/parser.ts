/**
 * Parses Architecture Decision Record Markdown into a structured record.
 *
 * Understands the common conventions side by side: YAML front matter (MADR,
 * RFC, Y-Statement), Nygard / adr-tools headings (`# 7. Use Kafka`,
 * `## Status`, `Date: …`), `ADR-0007:` style titles and plain file-name
 * numbering (`0007-use-kafka.md`). Every position is reported as a 0-based
 * line so the editor can attach diagnostics to it.
 */
import { AdrStatus, parseStatus } from './status';

export interface Section {
  level: number;
  title: string;
  /** 0-based line of the heading. */
  line: number;
  /** Text under the heading up to the next heading of the same or higher level. */
  body: string;
}

export interface FrontMatterEntry {
  value: string | string[];
  line: number;
}

export interface FrontMatter {
  /** Keys normalised to lower case without `-`/`_` (`superseded-by` → `supersededby`). */
  entries: Map<string, FrontMatterEntry>;
  /** Line of the closing `---`. */
  endLine: number;
}

export interface AdrRecord {
  filePath: string;
  fileName: string;
  /** Resolved number: front matter, then title heading, then file name. */
  id: number | null;
  fileNumber: number | null;
  headingNumber: number | null;
  frontMatterNumber: number | null;
  title: string;
  titleLine: number;
  status: AdrStatus;
  statusRaw: string | null;
  statusLine: number;
  /** ISO `yyyy-mm-dd` when the declared date is valid. */
  date: string | null;
  dateRaw: string | null;
  dateLine: number;
  context: string;
  decision: string;
  consequences: string;
  notes: string;
  supersededBy: number[];
  supersedes: number[];
  hasFrontMatter: boolean;
  sections: Section[];
  lineCount: number;
}

const FENCE = /^\s{0,3}(```|~~~)/;
const HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const NUMBERED_TITLE = /^(\d{1,5})\.\s+(.+)$/;
const PREFIXED_TITLE = /^(?:ADR|RFC)[-\s#]?(\d{1,5})\s*[:.\-–—]\s*(.+)$/i;
const FILE_NUMBER = /^(\d{1,5})[-_]/;
const DATE_LINE = /^\s*(?:[-*]\s*)?(?:\*\*)?Date(?:\*\*)?\s*:\s*(?:\*\*)?\s*([^\s*]+)/i;
const INLINE_STATUS = /^\s*(?:[-*]\s*)?(?:\*\*)?Status(?:\*\*)?\s*:\s*(?:\*\*)?\s*(.+)$/i;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const SUPERSEDED_BY = /superseded\s*[-_]?\s*by\s*[:=]?\s*\**\s*\[?\s*(?:ADR[-#\s]?)?0*(\d{1,5})/gi;
const SUPERSEDES = /\bsupersedes\s*[:=]?\s*\**\s*\[?\s*(?:ADR[-#\s]?)?0*(\d{1,5})/gi;

const CONTEXT_TITLES = /^(context(\s+and\s+problem\s+statement)?|background|problem(\s+statement)?|issue|motivation|summary)$/i;
const DECISION_TITLES = /^(decision(\s+outcome)?|y-statement|detailed\s+design|the\s+decision)$/i;
const CONSEQUENCE_TITLES = /^(consequences|positive\s+consequences|negative\s+consequences|implications|drawbacks|pros\s+and\s+cons(\s+of\s+the\s+options)?)$/i;
const NOTES_TITLES = /^(notes|rationale|why|argument)$/i;

export function splitLines(content: string): string[] {
  return content.replace(/^﻿/, '').split(/\r?\n/);
}

export function unquote(value: string): string {
  const v = value.trim();
  if (v.length >= 2 && ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))) {
    return v.slice(1, -1);
  }
  return v;
}

export function normaliseKey(key: string): string {
  return key.toLowerCase().replace(/[-_\s]/g, '');
}

/** Parse a leading `---` block. Returns null when the document has none. */
export function parseFrontMatter(lines: string[]): FrontMatter | null {
  if (lines.length === 0 || lines[0]!.trim() !== '---') return null;
  const entries = new Map<string, FrontMatterEntry>();
  let listKey: string | null = null;
  for (let i = 1; i < lines.length; i++) {
    const raw = lines[i]!;
    if (raw.trim() === '---' || raw.trim() === '...') return { entries, endLine: i };
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    const item = /^\s*-\s*(.*)$/.exec(raw);
    if (item && listKey) {
      const entry = entries.get(listKey)!;
      const list = Array.isArray(entry.value) ? entry.value : entry.value ? [entry.value] : [];
      list.push(unquote(item[1]!));
      entry.value = list;
      continue;
    }
    const kv = /^([A-Za-z0-9_.-]+)\s*:\s*(.*)$/.exec(raw);
    if (!kv) continue;
    const key = normaliseKey(kv[1]!);
    const rawValue = kv[2]!.replace(/\s+#.*$/, '').trim();
    if (rawValue.startsWith('[') && rawValue.endsWith(']')) {
      const items = rawValue
        .slice(1, -1)
        .split(',')
        .map((s) => unquote(s))
        .filter((s) => s.length > 0);
      entries.set(key, { value: items, line: i });
      listKey = null;
    } else {
      entries.set(key, { value: unquote(rawValue), line: i });
      listKey = rawValue === '' ? key : null;
    }
  }
  return null; // unterminated — treat as no front matter
}

function scalar(fm: FrontMatter | null, ...keys: string[]): FrontMatterEntry | undefined {
  if (!fm) return undefined;
  for (const k of keys) {
    const e = fm.entries.get(k);
    if (e) return e;
  }
  return undefined;
}

function asText(value: string | string[] | undefined): string {
  if (value == null) return '';
  return Array.isArray(value) ? value.join(', ') : value;
}

/** Every ADR number mentioned in a free-form value such as `[ADR-0003, 5]`. */
export function numbersIn(value: string | string[] | undefined): number[] {
  const out: number[] = [];
  for (const piece of Array.isArray(value) ? value : [value ?? '']) {
    for (const m of piece.matchAll(/(\d{1,5})/g)) out.push(Number(m[1]));
  }
  return out;
}

export function parseSections(lines: string[], startLine = 0): Section[] {
  const headings: { level: number; title: string; line: number }[] = [];
  let inFence = false;
  for (let i = startLine; i < lines.length; i++) {
    const line = lines[i]!;
    if (FENCE.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const h = HEADING.exec(line);
    if (h) headings.push({ level: h[1]!.length, title: h[2]!.trim(), line: i });
  }
  return headings.map((h, idx) => {
    let end = lines.length;
    for (let j = idx + 1; j < headings.length; j++) {
      if (headings[j]!.level <= h.level) {
        end = headings[j]!.line;
        break;
      }
    }
    return { ...h, body: lines.slice(h.line + 1, end).join('\n').trim() };
  });
}

function sectionBody(sections: Section[], pattern: RegExp): string {
  const found = sections.filter((s) => s.level >= 2 && pattern.test(stripEmphasis(s.title)));
  return found
    .map((s) => s.body)
    .filter((b) => b.length > 0)
    .join('\n\n');
}

function stripEmphasis(text: string): string {
  return text.replace(/[*_`]/g, '').trim();
}

export function isValidIsoDate(value: string): boolean {
  const m = ISO_DATE.exec(value);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

export function fileNumber(fileName: string): number | null {
  const m = FILE_NUMBER.exec(fileName);
  return m ? Number(m[1]) : null;
}

/** Split a title heading into its number (when it carries one) and its text. */
export function parseTitleHeading(text: string): { number: number | null; title: string } {
  const clean = text.trim();
  const numbered = NUMBERED_TITLE.exec(clean) ?? PREFIXED_TITLE.exec(clean);
  if (numbered) return { number: Number(numbered[1]), title: numbered[2]!.trim() };
  return { number: null, title: clean };
}

function collect(pattern: RegExp, text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(pattern)) out.push(Number(m[1]));
  return out;
}

function unique(values: number[]): number[] {
  return [...new Set(values)];
}

export function parseAdr(content: string, filePath: string): AdrRecord {
  const fileName = filePath.split(/[\\/]/).pop() ?? filePath;
  const lines = splitLines(content);
  const fm = parseFrontMatter(lines);
  const bodyStart = fm ? fm.endLine + 1 : 0;
  const sections = parseSections(lines, bodyStart);

  // ---- title & number --------------------------------------------------
  const h1 = sections.find((s) => s.level === 1);
  const heading = h1 ? parseTitleHeading(h1.title) : { number: null, title: '' };
  const fmTitle = scalar(fm, 'title');
  const fmNumber = scalar(fm, 'number', 'id', 'adr');
  const frontMatterNumber = fmNumber ? (numbersIn(fmNumber.value)[0] ?? null) : null;
  const fileNo = fileNumber(fileName);
  const id = frontMatterNumber ?? heading.number ?? fileNo;
  const title = (fmTitle ? asText(fmTitle.value) : '') || heading.title;
  const titleLine = fmTitle ? fmTitle.line : h1 ? h1.line : -1;

  // ---- status ------------------------------------------------------------
  const statusSection = sections.find((s) => s.level >= 2 && /^status$/i.test(stripEmphasis(s.title)));
  let statusRaw: string | null = null;
  let statusLine = -1;
  const fmStatus = scalar(fm, 'status');
  if (fmStatus && asText(fmStatus.value)) {
    statusRaw = asText(fmStatus.value);
    statusLine = fmStatus.line;
  } else if (statusSection) {
    for (let i = statusSection.line + 1; i < lines.length; i++) {
      const l = lines[i]!.trim();
      if (!l) continue;
      if (HEADING.test(l)) break;
      statusRaw = l.replace(/^[-*+]\s+/, '');
      statusLine = i;
      break;
    }
  } else {
    const firstSection = sections.find((s) => s.level >= 2)?.line ?? lines.length;
    for (let i = bodyStart; i < firstSection; i++) {
      const m = INLINE_STATUS.exec(lines[i]!);
      if (m) {
        statusRaw = m[1]!.replace(/\*+/g, '').trim();
        statusLine = i;
        break;
      }
    }
  }
  const status = parseStatus(statusRaw);

  // ---- date -------------------------------------------------------------
  let dateRaw: string | null = null;
  let dateLine = -1;
  const fmDate = scalar(fm, 'date', 'created', 'decisiondate');
  if (fmDate && asText(fmDate.value)) {
    dateRaw = asText(fmDate.value).split(/[T\s]/)[0]!;
    dateLine = fmDate.line;
  } else {
    let inFence = false;
    for (let i = bodyStart; i < lines.length; i++) {
      if (FENCE.test(lines[i]!)) inFence = !inFence;
      if (inFence) continue;
      const m = DATE_LINE.exec(lines[i]!);
      if (m) {
        dateRaw = m[1]!;
        dateLine = i;
        break;
      }
    }
  }
  const date = dateRaw && isValidIsoDate(dateRaw) ? dateRaw : null;

  // ---- supersede links --------------------------------------------------
  // Only the front matter and the Status section count: a record discussing
  // which other decisions superseded which must not read as its own link.
  const statusText = statusSection ? statusSection.body : statusRaw ?? '';
  const fmSupersededBy = scalar(fm, 'supersededby');
  const fmSupersedes = scalar(fm, 'supersedes');
  const supersededBy = unique([
    ...(fmSupersededBy ? numbersIn(fmSupersededBy.value) : []),
    ...collect(SUPERSEDED_BY, statusText),
  ]);
  const supersedes = unique([
    ...(fmSupersedes ? numbersIn(fmSupersedes.value) : []),
    ...collect(SUPERSEDES, statusText),
  ]);

  return {
    filePath,
    fileName,
    id,
    fileNumber: fileNo,
    headingNumber: heading.number,
    frontMatterNumber,
    title,
    titleLine,
    status,
    statusRaw,
    statusLine,
    date,
    dateRaw,
    dateLine,
    context: sectionBody(sections, CONTEXT_TITLES),
    decision: sectionBody(sections, DECISION_TITLES),
    consequences: sectionBody(sections, CONSEQUENCE_TITLES),
    notes: sectionBody(sections, NOTES_TITLES),
    supersededBy,
    supersedes,
    hasFrontMatter: fm !== null,
    sections,
    lineCount: lines.length,
  };
}

/** Files that live in an ADR directory but are not decision records. */
export function isAuxiliaryFile(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return (
    !lower.endsWith('.md') ||
    lower === 'readme.md' ||
    lower === 'index.md' ||
    lower === 'template.md' ||
    lower === '.adr-template.md' ||
    lower.startsWith('_') ||
    lower.startsWith('adr-template')
  );
}

export function formatId(id: number, width = 4): string {
  return String(id).padStart(width, '0');
}
