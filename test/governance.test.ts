import { describe, expect, it } from 'vitest';
import { evaluateGovernance, globToRegExp, isAdrPath, matchesAny, normalizePath } from '../src/core/governance';

describe('globToRegExp', () => {
  it('supports **, *, ? and classes', () => {
    expect(matchesAny('src/api/v1/user.ts', ['**/api/**'])).toBe(true);
    expect(matchesAny('api/x.ts', ['**/api/**'])).toBe(true);
    expect(matchesAny('src/apix/x.ts', ['**/api/**'])).toBe(false);
    expect(matchesAny('proto/a/b.proto', ['**/*.proto'])).toBe(true);
    expect(matchesAny('a/b.ts', ['*.ts'])).toBe(false);
    expect(matchesAny('b.ts', ['*.ts'])).toBe(true);
    expect(matchesAny('v1.ts', ['v?.ts'])).toBe(true);
    expect(matchesAny('v1.ts', ['v[0-9].ts'])).toBe(true);
    expect(matchesAny('a.b', ['a[.b'])).toBe(false);
    expect(matchesAny('db\\migration\\V1.sql', ['db/migration/**'])).toBe(true);
    expect(globToRegExp('  ')).toBeNull();
    expect(matchesAny('anything', [''])).toBe(false);
  });

  it('normalises paths', () => {
    expect(normalizePath('./a\\b')).toBe('a/b');
    expect(normalizePath('/x/y')).toBe('x/y');
  });
});

describe('evaluateGovernance', () => {
  const patterns = ['**/api/**', '**/*.proto'];

  it('triggers when significant files change without an ADR', () => {
    const v = evaluateGovernance(['src/api/user.ts', 'README.md', 'schema/a.proto'], patterns, 'docs/adr');
    expect(v.triggered).toBe(true);
    expect(v.matchedPaths).toEqual(['src/api/user.ts', 'schema/a.proto']);
    expect(v.message).toContain('src/api/user.ts');
  });

  it('passes when an ADR is part of the change', () => {
    const v = evaluateGovernance(['src/api/user.ts', 'docs/adr/0004-x.md'], patterns, 'docs/adr');
    expect(v.triggered).toBe(false);
    expect(v.adrPaths).toEqual(['docs/adr/0004-x.md']);
  });

  it('ignores the index and README in the ADR directory', () => {
    expect(evaluateGovernance(['src/api/a.ts', 'docs/adr/index.md'], patterns, 'docs/adr').triggered).toBe(true);
    expect(isAdrPath('docs/adr/README.md', 'docs/adr')).toBe(false);
    expect(isAdrPath('docs/adr/sub/0001.md', 'docs/adr/')).toBe(true);
    expect(isAdrPath('0001-x.md', '')).toBe(true);
  });

  it('does nothing without patterns or changes', () => {
    expect(evaluateGovernance(['src/api/a.ts'], [], 'docs/adr').triggered).toBe(false);
    expect(evaluateGovernance([], patterns, 'docs/adr').triggered).toBe(false);
    expect(evaluateGovernance(['src/x.ts'], patterns, 'docs/adr').triggered).toBe(false);
  });

  it('collapses long lists', () => {
    const many = Array.from({ length: 13 }, (_, i) => `api/f${i}.ts`);
    expect(evaluateGovernance(many, patterns, 'docs/adr').message).toContain('…and 3 more.');
  });
});
