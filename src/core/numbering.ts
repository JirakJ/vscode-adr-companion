/**
 * Numbering analysis (duplicates, gaps, next free number) and the pure text
 * transformations behind "Renumber ADR".
 */

export interface NumberedFile {
  fileName: string;
  id: number | null;
}

export interface NumberingReport {
  /** Number → every file claiming it, only for numbers claimed more than once. */
  duplicates: Map<number, string[]>;
  /** Missing numbers between 1 and the highest number in use. */
  gaps: number[];
  unnumbered: string[];
  next: number;
}

export function analyzeNumbering(files: NumberedFile[]): NumberingReport {
  const byId = new Map<number, string[]>();
  const unnumbered: string[] = [];
  for (const f of files) {
    if (f.id == null) {
      unnumbered.push(f.fileName);
      continue;
    }
    const list = byId.get(f.id) ?? [];
    list.push(f.fileName);
    byId.set(f.id, list);
  }
  const duplicates = new Map<number, string[]>();
  for (const [id, names] of [...byId.entries()].sort((a, b) => a[0] - b[0])) {
    if (names.length > 1) duplicates.set(id, [...names].sort());
  }
  const max = byId.size > 0 ? Math.max(...byId.keys()) : 0;
  const gaps: number[] = [];
  for (let i = 1; i < max; i++) if (!byId.has(i)) gaps.push(i);
  return { duplicates, gaps, unnumbered: unnumbered.sort(), next: max + 1 };
}

/**
 * `ADR-42`, `ADR 42`, `ADR42`, `@adr:42`, `@adr#42` — case, separator and
 * digits captured. Shared by the reference finder and the renumber planner so
 * what is found and what is rewritten can never drift apart.
 */
export const REFERENCE_PATTERN = /(?<![A-Za-z0-9_])(ADR)([-:#(]?\s?)(\d{1,5})(?![A-Za-z0-9_])/gi;

const FILE_NUMBER = /^(\d+)([-_])(.*)$/;
const TITLE_HEADING = /^(#\s+(?:(?:ADR|RFC)[-\s#]?)?)(\d+)(\s*[.:\-–—]\s+)/gim;
const FRONT_MATTER_NUMBER = /^(\s*(?:number|id)\s*:\s*)(\d+)(\s*)$/gim;

export const MAX_ADR_NUMBER = 99_999;

/** Keep the original zero padding unless the new number needs more digits. */
export function repad(originalDigits: string, newId: number): string {
  const plain = String(newId);
  return originalDigits.startsWith('0') && originalDigits.length > plain.length
    ? plain.padStart(originalDigits.length, '0')
    : plain;
}

export function renamedFileName(oldName: string, newId: number): string {
  const m = FILE_NUMBER.exec(oldName);
  if (!m) return oldName;
  return `${repad(m[1]!, newId)}${m[2]}${m[3]}`;
}

/** Rewrite references to `oldId` (and links to the renamed file) in any text. */
export function rewriteReferences(
  content: string,
  oldId: number,
  newId: number,
  oldFileName?: string,
  newFileName?: string,
): string {
  let text = content;
  if (oldFileName && newFileName && oldFileName !== newFileName) {
    text = text.split(oldFileName).join(newFileName);
  }
  return text.replace(REFERENCE_PATTERN, (match, prefix: string, sep: string, digits: string) =>
    Number(digits) === oldId ? `${prefix}${sep}${repad(digits, newId)}` : match,
  );
}

/** Rewrite the record itself: title heading, front-matter number and self-references. */
export function rewriteAdrDocument(content: string, oldId: number, newId: number): string {
  const headed = content.replace(TITLE_HEADING, (match, a: string, digits: string, b: string) =>
    Number(digits) === oldId ? `${a}${repad(digits, newId)}${b}` : match,
  );
  const fronted = headed.replace(FRONT_MATTER_NUMBER, (match, a: string, digits: string, b: string) =>
    Number(digits) === oldId ? `${a}${repad(digits, newId)}${b}` : match,
  );
  return rewriteReferences(fronted, oldId, newId);
}

export function countReferences(content: string, id: number): number {
  let n = 0;
  for (const m of content.matchAll(REFERENCE_PATTERN)) if (Number(m[3]) === id) n++;
  return n;
}

/** Why a renumber cannot proceed, or null when it can. */
export function validateRenumber(oldId: number, newId: number, taken: Set<number>): string | null {
  if (!Number.isInteger(newId) || newId <= 0) return 'ADR numbers start at 1.';
  if (newId > MAX_ADR_NUMBER) return `ADR numbers above ${MAX_ADR_NUMBER} are not recognised as references.`;
  if (newId === oldId) return `ADR-${String(newId).padStart(4, '0')} is already this record's number.`;
  if (taken.has(newId)) return `ADR-${String(newId).padStart(4, '0')} is already taken by another decision record.`;
  return null;
}
