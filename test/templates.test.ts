import { describe, expect, it } from 'vitest';
import { parseAdr } from '../src/core/parser';
import { FORMATS, adrFileName, parseFormat, renderFilled, renderTemplate, slugify, substitutePlaceholders, todayIso, yamlScalar } from '../src/core/templates';

const input = { number: 5, title: 'Use gRPC: internal APIs', date: '2026-03-01' };

describe('templates', () => {
  it.each(['nygard', 'madr', 'rfc', 'y-statement', 'tyree-akerman'] as const)('%s round-trips through the parser', (format) => {
    const r = parseAdr(renderTemplate(format, input), `0005-${slugify(input.title)}.md`);
    expect(r.id).toBe(5);
    expect(r.title).toBe('Use gRPC: internal APIs');
    expect(r.status).toBe('proposed');
    expect(r.date).toBe('2026-03-01');
  });

  it('renders the requested status', () => {
    expect(parseAdr(renderTemplate('nygard', { ...input, status: 'accepted' }), 'x.md').status).toBe('accepted');
  });

  it('substitutes placeholders including zero padding and spaces', () => {
    const out = substitutePlaceholders('# {{number:0000}} {{ title }} ({{number}}) {{date}} {{status}}', input);
    expect(out).toBe('# 0005 Use gRPC: internal APIs (5) 2026-03-01 proposed');
  });

  it('slugifies and names files', () => {
    expect(slugify('Use Žluťoučký kůň & PostgreSQL!')).toBe('use-zlutoucky-kun-postgresql');
    expect(slugify('!!!')).toBe('decision');
    expect(adrFileName(12, 'Use Kafka')).toBe('0012-use-kafka.md');
    expect(adrFileName(12, 'Use Kafka', 3)).toBe('012-use-kafka.md');
  });

  it('parses JetBrains-style format names', () => {
    expect(parseFormat('Y_STATEMENT')).toBe('y-statement');
    expect(parseFormat('TYREE_AKERMAN')).toBe('tyree-akerman');
    expect(parseFormat('MADR')).toBe('madr');
    expect(parseFormat('nope')).toBeNull();
    expect(FORMATS).toHaveLength(6);
  });

  it('quotes YAML scalars only when needed', () => {
    expect(yamlScalar('Use Kafka')).toBe('Use Kafka');
    expect(yamlScalar('a: b')).toBe('"a: b"');
    expect(yamlScalar('say "hi"')).toBe('"say \\"hi\\""');
  });

  it('renders filled records for PR-derived ADRs', () => {
    const nygard = renderFilled('nygard', input, { context: 'Ctx', decision: '', consequences: 'Cons', source: 'Source: PR #9' });
    const r = parseAdr(nygard, '0005-x.md');
    expect(r.context).toBe('Ctx');
    expect(r.decision).toContain('TODO');
    expect(nygard).toContain('Source: PR #9');
    const madr = parseAdr(renderFilled('madr', input, { context: 'C', decision: 'D', consequences: 'E' }), 'x.md');
    expect(madr.id).toBe(5);
    expect(madr.decision).toBe('D');
  });

  it('formats today in local time', () => {
    expect(todayIso(new Date(2026, 0, 9))).toBe('2026-01-09');
  });
});
