/**
 * "Changing this needs a decision record."
 *
 * A team lists architecturally significant globs under `requireAdrForPaths`
 * in `.adr-config.yaml`. When a change set touches one of them and adds or
 * changes no ADR, the governance check reports which files triggered it.
 */

export interface GovernanceVerdict {
  triggered: boolean;
  /** Changed files that matched a protected glob, in input order. */
  matchedPaths: string[];
  /** ADR files that are part of the change set. */
  adrPaths: string[];
  message: string;
}

/** Forward slashes, no leading `./` or `/`. */
export function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
}

function escapeRegex(c: string): string {
  return c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Translate a glob into an anchored regex: `**` crosses directories, `*` and
 * `?` stay within one segment, `[...]` classes pass through. A blank pattern
 * returns null so a stray list entry can never match everything.
 */
export function globToRegExp(glob: string): RegExp | null {
  const pattern = normalizePath(glob.trim());
  if (!pattern) return null;
  let out = '^';
  let i = 0;
  while (i < pattern.length) {
    const c = pattern[i]!;
    if (c === '*') {
      if (pattern[i + 1] === '*') {
        if (pattern[i + 2] === '/') {
          out += '(?:.*/)?';
          i += 3;
        } else {
          out += '.*';
          i += 2;
        }
      } else {
        out += '[^/]*';
        i += 1;
      }
    } else if (c === '?') {
      out += '[^/]';
      i += 1;
    } else if (c === '[') {
      const close = pattern.indexOf(']', i + 1);
      if (close < 0) {
        out += '\\[';
        i += 1;
      } else {
        out += pattern.slice(i, close + 1);
        i = close + 1;
      }
    } else {
      out += escapeRegex(c);
      i += 1;
    }
  }
  out += '$';
  try {
    return new RegExp(out);
  } catch {
    return null;
  }
}

export function matchesAny(path: string, patterns: string[]): boolean {
  const p = normalizePath(path);
  return patterns.some((g) => globToRegExp(g)?.test(p) ?? false);
}

/** Whether a repository-relative path is a decision record in `adrDirectory`. */
export function isAdrPath(path: string, adrDirectory: string): boolean {
  const p = normalizePath(path);
  const dir = normalizePath(adrDirectory).replace(/\/+$/, '');
  if (!p.toLowerCase().endsWith('.md')) return false;
  const name = p.split('/').pop()!.toLowerCase();
  if (['readme.md', 'index.md', 'template.md', '.adr-template.md'].includes(name)) return false;
  return dir === '' ? !p.includes('/') : p.startsWith(`${dir}/`);
}

const MAX_LISTED = 10;

export function evaluateGovernance(changedPaths: string[], patterns: string[], adrDirectory: string): GovernanceVerdict {
  const changed = [...new Set(changedPaths.map(normalizePath).filter(Boolean))];
  const adrPaths = changed.filter((p) => isAdrPath(p, adrDirectory));
  const regexes = patterns.map(globToRegExp).filter((r): r is RegExp => r !== null);
  if (regexes.length === 0 || changed.length === 0) {
    return { triggered: false, matchedPaths: [], adrPaths, message: regexes.length === 0 ? 'No `requireAdrForPaths` configured — nothing to check.' : 'No changed files.' };
  }
  const matchedPaths = changed.filter((p) => !adrPaths.includes(p) && regexes.some((r) => r.test(p)));
  if (matchedPaths.length === 0) {
    return { triggered: false, matchedPaths, adrPaths, message: `No architecturally significant files changed (${changed.length} file(s) checked).` };
  }
  if (adrPaths.length > 0) {
    return {
      triggered: false,
      matchedPaths,
      adrPaths,
      message: `${matchedPaths.length} architecturally significant file(s) changed and the change records a decision (${adrPaths.join(', ')}).`,
    };
  }
  const listed = matchedPaths.slice(0, MAX_LISTED).map((p) => `  • ${p}`).join('\n');
  const more = matchedPaths.length > MAX_LISTED ? `\n  …and ${matchedPaths.length - MAX_LISTED} more.` : '';
  return {
    triggered: true,
    matchedPaths,
    adrPaths,
    message:
      `This change touches ${matchedPaths.length} architecturally significant file(s) but adds or updates no ADR in ${adrDirectory || '.'}:\n` +
      `${listed}${more}\n` +
      '`requireAdrForPaths` in .adr-config.yaml marks these paths as needing a decision record.',
  };
}
