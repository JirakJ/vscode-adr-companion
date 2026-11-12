import { describe, expect, it } from 'vitest';
import { parseAdr } from '../src/core/parser';
import { renderTemplate } from '../src/core/templates';
import { lintAll, lintRecord } from '../src/core/validator';

const opts = { today: '2026-06-01', maxProposedAgeDays: 30, stalenessThresholdDays: 0 };
const codes = (content: string, file = '0001-x.md') => lintRecord(parseAdr(content, file), opts).map((i) => i.code);

const accepted = `# 1. Use X

Date: 2026-01-01

## Status

Accepted

## Context

Because.

## Decision

Do X.

## Consequences

Y.
`;

describe('lintRecord', () => {
  it('passes a complete accepted record', () => {
    expect(codes(accepted)).toEqual([]);
  });

  it('requires decision, consequences and date for accepted records', () => {
    const issues = lintRecord(parseAdr('# 1. X\n\n## Status\n\nAccepted\n', '0001-x.md'), opts);
    expect(issues.filter((i) => i.code === 'missing-required-field').map((i) => i.message)).toEqual([
      expect.stringContaining('Decision'),
      expect.stringContaining('Consequences'),
      expect.stringContaining('Date'),
    ]);
    expect(issues.every((i) => i.severity === 'error')).toBe(true);
    expect(issues[0]!.line).toBe(4);
  });

  it('flags superseded records without a successor and dangling links', () => {
    expect(codes('# 1. X\n\nDate: 2026-01-01\n\n## Status\n\nSuperseded\n')).toContain('missing-supersede-link');
    const r = parseAdr('# 1. X\n\nDate: 2026-01-01\n\n## Status\n\nSuperseded by ADR-0009\n', '0001-x.md');
    expect(lintRecord(r, opts, new Set([1, 2])).map((i) => i.code)).toEqual(['dangling-supersede-link']);
    expect(lintRecord(r, opts, new Set([1, 9]))).toEqual([]);
  });

  it('flags stale proposals, unknown statuses, bad dates and placeholders', () => {
    expect(codes(renderTemplate('nygard', { number: 1, title: 'x', date: '2026-01-01' }))).toEqual(['stale-proposed']);
    expect(codes(renderTemplate('nygard', { number: 1, title: 'x', date: '2026-05-20' }))).toEqual([]);
    expect(codes('# 1. X\n\n## Status\n\nBanana\n')).toEqual(['unknown-status']);
    expect(codes('# 1. X\n\n')).toEqual(['missing-status']);
    expect(codes(accepted.replace('2026-01-01', '01/02/2026'))).toEqual(['invalid-date', 'missing-required-field']);
    expect(codes(renderTemplate('nygard', { number: 1, title: 'x', date: '2026-05-01', status: 'accepted' }))).toEqual(['template-placeholder']);
  });

  it('flags rejected records without rationale', () => {
    expect(codes('# 1. X\n\n## Status\n\nRejected\n')).toEqual(['rejected-without-rationale']);
  });

  it('flags conflicting numbers and missing numbers/titles', () => {
    expect(codes(accepted, '0002-x.md')).toEqual(['number-mismatch']);
    expect(codes('Just text\n', 'notes.md')).toEqual(['missing-title', 'missing-number', 'missing-status']);
  });

  it('adds review reminders only when enabled', () => {
    const r = parseAdr(accepted, '0001-x.md');
    expect(lintRecord(r, { ...opts, stalenessThresholdDays: 90 }).map((i) => [i.code, i.severity])).toEqual([['review-due', 'info']]);
  });
});

describe('lintAll', () => {
  it('reports duplicate numbers on every claimant, sorted', () => {
    const a = parseAdr(accepted, '/r/0001-a.md');
    const b = parseAdr(accepted.replace('Use X', 'Use Y'), '/r/0001-b.md');
    const issues = lintAll([b, a], opts);
    expect(issues.map((i) => [i.filePath, i.code])).toEqual([
      ['/r/0001-a.md', 'duplicate-number'],
      ['/r/0001-b.md', 'duplicate-number'],
    ]);
    expect(issues[0]!.message).toContain('0001-b.md');
  });
});
