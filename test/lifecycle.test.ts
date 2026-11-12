import { describe, expect, it } from 'vitest';
import { addSupersedesBacklink, hasSupersedesReference, setStatus } from '../src/core/lifecycle';
import { parseAdr } from '../src/core/parser';
import { renderTemplate } from '../src/core/templates';

const input = { number: 3, title: 'Use X', date: '2026-01-01' };

describe('setStatus', () => {
  it('updates a Nygard Status section and keeps other lines', () => {
    const src = '# 3. Use X\n\n## Status\n\nProposed\n\nAmends ADR-0001\n\n## Context\n\nc\n';
    const out = setStatus(src, 'accepted');
    expect(out).toBe('# 3. Use X\n\n## Status\n\nAccepted\n\nAmends ADR-0001\n\n## Context\n\nc\n');
  });

  it('writes a successor link and replaces an old one', () => {
    const src = renderTemplate('nygard', input);
    const once = setStatus(src, 'superseded', { id: 9, fileName: '0009-use-y.md' });
    const r = parseAdr(once, '0003-use-x.md');
    expect(r.status).toBe('superseded');
    expect(r.supersededBy).toEqual([9]);
    const twice = setStatus(once, 'superseded', { id: 10 });
    expect(parseAdr(twice, 'x.md').supersededBy).toEqual([10]);
    expect(twice).not.toContain('0009');
  });

  it('updates front matter and the Status section together', () => {
    const out = setStatus(renderTemplate('rfc', input), 'superseded', { id: 4 });
    expect(out).toContain('status: superseded');
    expect(out).toContain('superseded-by: 4');
    expect(out).toContain('\nSuperseded\n');
    expect(parseAdr(out, 'x.md').supersededBy).toEqual([4]);
  });

  it('updates MADR front matter only', () => {
    const out = setStatus(renderTemplate('madr', input), 'deprecated');
    expect(out).toContain('status: deprecated');
    expect(out).not.toContain('## Status');
  });

  it('inserts a Status section when none exists', () => {
    const out = setStatus('# 3. Use X\n\n## Context\n\nc\n', 'accepted');
    expect(out).toBe('# 3. Use X\n\n## Status\n\nAccepted\n\n## Context\n\nc\n');
  });

  it('preserves CRLF line endings', () => {
    expect(setStatus('# 1. A\r\n\r\n## Status\r\n\r\nProposed\r\n', 'accepted')).toContain('\r\nAccepted\r\n');
  });
});

describe('supersede backlinks', () => {
  it('adds a backlink once', () => {
    const src = renderTemplate('nygard', { ...input, number: 9 });
    const out = addSupersedesBacklink(src, { id: 3, fileName: '0003-use-x.md' });
    expect(out).toContain('Supersedes [ADR-0003](0003-use-x.md)');
    expect(parseAdr(out, '0009-x.md').supersedes).toEqual([3]);
    expect(addSupersedesBacklink(out, { id: 3 })).toBe(out);
    expect(hasSupersedesReference(out, 30)).toBe(false);
  });

  it('maintains a front-matter supersedes list', () => {
    const madr = renderTemplate('madr', { ...input, number: 9 });
    const one = addSupersedesBacklink(madr, { id: 3 });
    expect(one).toContain('supersedes: [3]');
    const two = addSupersedesBacklink(one, { id: 5 });
    expect(two).toContain('supersedes: [3, 5]');
    expect(addSupersedesBacklink(two, { id: 5 })).toBe(two);
    const block = addSupersedesBacklink('---\nsupersedes:\n  - 1\n---\n# x\n', { id: 2 });
    expect(block).toBe('---\nsupersedes: [1, 2]\n---\n# x\n');
  });
});
