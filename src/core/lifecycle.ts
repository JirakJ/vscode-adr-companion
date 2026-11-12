/**
 * Status changes and supersede links, as pure text transformations.
 *
 * A record may carry its status in YAML front matter, in a `## Status`
 * section, or both (the RFC and Y-Statement templates do) — every place that
 * declares it is updated so the two can never disagree.
 */
import { parseFrontMatter, parseSections, splitLines } from './parser';
import { AdrStatus, statusDisplayName } from './status';

export interface SupersedeTarget {
  id: number;
  /** File name of the successor, used to write a relative Markdown link. */
  fileName?: string;
  title?: string;
}

function eol(content: string): string {
  return content.includes('\r\n') ? '\r\n' : '\n';
}

function label(id: number): string {
  return `ADR-${String(id).padStart(4, '0')}`;
}

function link(target: SupersedeTarget): string {
  return target.fileName ? `[${label(target.id)}](${target.fileName})` : label(target.id);
}

const SUPERSEDED_LINE = /^\s*(?:[-*+]\s*)?\**\s*superseded\s*[-_]?\s*by\b/i;

export function setStatus(content: string, status: AdrStatus, supersededBy?: SupersedeTarget): string {
  const nl = eol(content);
  const lines = splitLines(content);
  const fm = parseFrontMatter(lines);
  const bodyStart = fm ? fm.endLine + 1 : 0;
  const sections = parseSections(lines, bodyStart);
  const display = statusDisplayName(status);
  const successor = status === 'superseded' && supersededBy ? supersededBy : undefined;
  const statusSection = sections.find((s) => s.level >= 2 && /^status$/i.test(s.title.replace(/[*_`]/g, '').trim()));
  const fmStatus = fm?.entries.get('status');

  // 1. Status section (below the front matter, so edit it first).
  if (statusSection) {
    let end = lines.length;
    for (const s of sections) {
      if (s.line > statusSection.line && s.level <= statusSection.level) {
        end = s.line;
        break;
      }
    }
    const body = lines.slice(statusSection.line + 1, end);
    const first = body.findIndex((l) => l.trim().length > 0);
    const rest = (first >= 0 ? body.slice(first + 1) : []).filter((l) => !SUPERSEDED_LINE.test(l));
    while (rest.length > 0 && !rest[0]!.trim()) rest.shift();
    while (rest.length > 0 && !rest[rest.length - 1]!.trim()) rest.pop();
    const replacement = ['', display];
    if (successor) replacement.push('', `Superseded by ${link(successor)}`);
    if (rest.length > 0) replacement.push('', ...rest);
    replacement.push('');
    lines.splice(statusSection.line + 1, end - statusSection.line - 1, ...replacement);
  } else if (!fmStatus) {
    const h1 = sections.find((s) => s.level === 1);
    const at = h1 ? h1.line + 1 : bodyStart;
    const block = ['', '## Status', '', display];
    if (successor) block.push('', `Superseded by ${link(successor)}`);
    if (lines[at] !== undefined && lines[at]!.trim()) block.push('');
    lines.splice(at, 0, ...block);
  }

  // 2. Front matter.
  if (fm) {
    if (fmStatus) lines[fmStatus.line] = lines[fmStatus.line]!.replace(/^(\s*status\s*:\s*).*$/i, `$1${status}`);
    if (successor) {
      const existing = fm.entries.get('supersededby');
      const value = `superseded-by: ${successor.id}`;
      if (existing && !Array.isArray(existing.value)) {
        lines[existing.line] = lines[existing.line]!.replace(/^(\s*[A-Za-z_-]+\s*:\s*).*$/, `$1${successor.id}`);
      } else if (!existing) {
        lines.splice(fm.endLine, 0, value);
      }
    }
  }
  return lines.join(nl);
}

export function hasSupersedesReference(content: string, supersededId: number): boolean {
  const prose = new RegExp(`\\bsupersedes\\s*[:=]?\\s*\\**\\s*\\[?\\s*(?:ADR[-#\\s]?)?0*${supersededId}(?![0-9])`, 'i');
  if (prose.test(content)) return true;
  const fm = parseFrontMatter(splitLines(content));
  const entry = fm?.entries.get('supersedes');
  if (!entry) return false;
  const values = Array.isArray(entry.value) ? entry.value : [entry.value];
  return values.some((v) => (/(\d+)/.exec(v)?.[1] ?? '') !== '' && Number(/(\d+)/.exec(v)![1]) === supersededId);
}

/**
 * Write "Supersedes ADR-N" into the successor. Idempotent; maintains a
 * `supersedes: [..]` list when the successor uses front matter.
 */
export function addSupersedesBacklink(content: string, superseded: SupersedeTarget): string {
  if (hasSupersedesReference(content, superseded.id)) return content;
  const nl = eol(content);
  const lines = splitLines(content);
  const fm = parseFrontMatter(lines);
  const bodyStart = fm ? fm.endLine + 1 : 0;
  const sections = parseSections(lines, bodyStart);
  const statusSection = sections.find((s) => s.level >= 2 && /^status$/i.test(s.title.replace(/[*_`]/g, '').trim()));
  const backlink = `Supersedes ${link(superseded)}`;

  if (statusSection) {
    let end = lines.length;
    for (const s of sections) {
      if (s.line > statusSection.line && s.level <= statusSection.level) {
        end = s.line;
        break;
      }
    }
    let last = end - 1;
    while (last > statusSection.line && !lines[last]!.trim()) last--;
    lines.splice(last + 1, 0, '', backlink);
  } else if (!fm) {
    const h1 = sections.find((s) => s.level === 1);
    const at = h1 ? h1.line + 1 : 0;
    lines.splice(at, 0, '', '## Status', '', backlink);
  }

  if (fm) {
    const existing = fm.entries.get('supersedes');
    if (existing && Array.isArray(existing.value)) {
      const ids = existing.value.map((v) => v.trim()).filter(Boolean);
      ids.push(String(superseded.id));
      // Inline lists sit on the key line; block lists are rewritten inline.
      let blockEnd = existing.line + 1;
      while (blockEnd < fm.endLine && /^\s*-\s*/.test(lines[blockEnd]!)) blockEnd++;
      lines.splice(existing.line, blockEnd - existing.line, `supersedes: [${ids.join(', ')}]`);
    } else if (existing) {
      const ids = String(existing.value).trim() ? [String(existing.value).trim(), String(superseded.id)] : [String(superseded.id)];
      lines[existing.line] = `supersedes: [${ids.join(', ')}]`;
    } else {
      lines.splice(fm.endLine, 0, `supersedes: [${superseded.id}]`);
    }
  }
  return lines.join(nl);
}
