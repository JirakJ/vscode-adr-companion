import { describe, expect, it } from 'vitest';
import {
  analyzeNumbering,
  countReferences,
  renamedFileName,
  repad,
  rewriteAdrDocument,
  rewriteReferences,
  validateRenumber,
} from '../src/core/numbering';

describe('analyzeNumbering', () => {
  it('finds duplicates, gaps, unnumbered files and the next number', () => {
    const r = analyzeNumbering([
      { fileName: '0001-a.md', id: 1 },
      { fileName: '0004-b.md', id: 4 },
      { fileName: '0004-c.md', id: 4 },
      { fileName: 'notes.md', id: null },
    ]);
    expect([...r.duplicates.entries()]).toEqual([[4, ['0004-b.md', '0004-c.md']]]);
    expect(r.gaps).toEqual([2, 3]);
    expect(r.unnumbered).toEqual(['notes.md']);
    expect(r.next).toBe(5);
    expect(analyzeNumbering([]).next).toBe(1);
  });
});

describe('renumber', () => {
  it('keeps padding per occurrence', () => {
    expect(repad('007', 12)).toBe('012');
    expect(repad('7', 12)).toBe('12');
    expect(repad('07', 123)).toBe('123');
    expect(renamedFileName('0007-use-kafka.md', 12)).toBe('0012-use-kafka.md');
    expect(renamedFileName('use-kafka.md', 12)).toBe('use-kafka.md');
  });

  it('rewrites every reference form and leaves look-alikes alone', () => {
    const src = 'see ADR-007, ADR 7, adr7, @adr:7, @ADR(7) and [x](0007-use-kafka.md); not ADR-70, adr7x, adr-companion, ADR-8';
    const out = rewriteReferences(src, 7, 12, '0007-use-kafka.md', '0012-use-kafka.md');
    expect(out).toBe('see ADR-012, ADR 12, adr12, @adr:12, @ADR(12) and [x](0012-use-kafka.md); not ADR-70, adr7x, adr-companion, ADR-8');
    expect(countReferences(src, 7)).toBe(5);
  });

  it('rewrites the record heading and front matter', () => {
    expect(rewriteAdrDocument('# 7. Use Kafka\n\nAs ADR-0007 says.', 7, 9)).toBe('# 9. Use Kafka\n\nAs ADR-0009 says.');
    expect(rewriteAdrDocument('---\nnumber: 0007\ntitle: x\n---\n# RFC-7: x', 7, 15)).toBe('---\nnumber: 0015\ntitle: x\n---\n# RFC-15: x');
    expect(rewriteAdrDocument('# 8. Other', 7, 9)).toBe('# 8. Other');
  });

  it('validates the new number', () => {
    expect(validateRenumber(7, 0, new Set())).toMatch(/start at 1/);
    expect(validateRenumber(7, 7, new Set())).toMatch(/already this record/);
    expect(validateRenumber(7, 3, new Set([3]))).toMatch(/already taken/);
    expect(validateRenumber(7, 100000, new Set())).toMatch(/above/);
    expect(validateRenumber(7, 8, new Set([3]))).toBeNull();
  });
});
