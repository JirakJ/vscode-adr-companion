import { describe, expect, it } from 'vitest';
import { githubAnnotation, escapeData, escapeProperty, relativeTo, shouldFail } from '../src/core/annotations';
import { ciWorkflow, cliDownloadUrl } from '../src/core/ciWorkflow';
import { parseAdr } from '../src/core/parser';
import {
  containsDecisionContent,
  extractBranchName,
  extractDecision,
  extractPrNumber,
  mergeLogArgs,
  parseMergeLog,
  suggestTitle,
} from '../src/core/pullRequest';
import { annotationLine, checkReference, commentFor, findAnnotations, findMentions } from '../src/core/references';
import type { Issue } from '../src/core/validator';

describe('merge log', () => {
  it('parses records separated by control characters', () => {
    const out = 'abc123\x1fJane\x1f2026-01-02T10:00:00+01:00\x1fMerge pull request #42 from acme/feature/kafka-events\x1fUse Kafka\n\n## Context\nx\x1e\n' +
      'def456\x1fBob\x1f2026-01-01T09:00:00Z\x1fMerge branch \'fix-x\'\x1f\x1e';
    const commits = parseMergeLog(out);
    expect(commits).toHaveLength(2);
    expect(commits[0]).toMatchObject({ hash: 'abc123', author: 'Jane', subject: 'Merge pull request #42 from acme/feature/kafka-events' });
    expect(commits[0]!.body).toContain('## Context');
    expect(commits[1]!.body).toBe('');
    expect(parseMergeLog('')).toEqual([]);
  });

  it('builds git arguments without a shell', () => {
    expect(mergeLogArgs(9999)).toEqual(['log', '--merges', '-n', '500', '--pretty=format:%H%x1f%an%x1f%aI%x1f%s%x1f%b%x1e']);
  });

  it('extracts PR numbers and branches', () => {
    expect(extractPrNumber('Merge pull request #42 from a/b')).toBe(42);
    expect(extractPrNumber("Merge branch 'x' into 'main'\n\nSee merge request !17")).toBe(17);
    expect(extractPrNumber('Add cache (#88)')).toBe(88);
    expect(extractPrNumber('nothing')).toBeNull();
    expect(extractBranchName('Merge pull request #1 from acme/feature/kafka-events')).toBe('feature/kafka-events');
    expect(extractBranchName("Merge branch 'feat/x'")).toBe('feat/x');
    expect(extractBranchName('Random')).toBe('');
  });

  it('suggests titles', () => {
    expect(suggestTitle('Merge pull request #1 from a/feature/kafka-events', '# Adopt Kafka\n\nbody')).toBe('Adopt Kafka');
    expect(suggestTitle('Merge pull request #1 from a/feature/kafka-events', 'Move to Kafka for events\n\n## Context\nx')).toBe('Move to Kafka for events');
    expect(suggestTitle("Merge branch 'feature/use-redis_cache'")).toBe('Use Redis Cache');
    expect(suggestTitle('Use caching layer (#12)')).toBe('Use caching layer');
    expect(suggestTitle('')).toBe('Untitled Decision');
  });

  it('extracts sections from a description', () => {
    const body = 'Use Kafka\n\n## Context\nLegacy queue drops messages.\n\n## Decision\nKafka.\n### Details\nthree brokers\n\n## Impact\nOps work.';
    const d = extractDecision(body, 'Merge pull request #7 from a/b');
    expect(d).toEqual({ title: 'Use Kafka', context: 'Legacy queue drops messages.', decision: 'Kafka.\n### Details\nthree brokers', consequences: 'Ops work.', prNumber: 7 });
    expect(containsDecisionContent(body)).toBe(true);
    const plain = extractDecision('Title line\nWe switched because reasons.', 'Merge pull request #8 from a/b');
    expect(plain.context).toBe('We switched because reasons.');
    expect(containsDecisionContent('nothing here')).toBe(false);
  });
});

describe('references', () => {
  it('finds annotations in all forms', () => {
    const refs = findAnnotations('// @adr:0007 Kafka\n# @ADR(12)\n/* @adr-3 @adr#4 @adrx @adr:5x */');
    expect(refs.map((r) => [r.id, r.line, r.start])).toEqual([
      [7, 0, 3],
      [12, 1, 2],
      [3, 2, 3],
      [4, 2, 10],
    ]);
  });

  it('finds prose mentions', () => {
    expect(findMentions('See ADR-0007 and adr 2, not adr-companion.').map((m) => m.id)).toEqual([7, 2]);
  });

  it('checks references against the log', () => {
    const map = new Map([
      [1, parseAdr('# 1. Old\n\n## Status\n\nSuperseded by ADR-0002\n', '0001-old.md')],
      [2, parseAdr('# 2. New\n\n## Status\n\nAccepted\n', '0002-new.md')],
    ]);
    expect(checkReference(2, map)).toBeNull();
    expect(checkReference(9, map)).toEqual({ kind: 'missing', message: 'ADR-0009 does not exist in the decision log.' });
    expect(checkReference(1, map)).toMatchObject({ kind: 'inactive', successor: 2 });
  });

  it('writes annotations in the language comment syntax', () => {
    expect(annotationLine('python', 7, 'Use Kafka', '    ')).toBe('    # @adr:0007 Use Kafka');
    expect(annotationLine('html', 7, 'X')).toBe('<!-- @adr:0007 X -->');
    expect(annotationLine('typescript', 7, 'X')).toBe('// @adr:0007 X');
    expect(commentFor('sql')).toEqual(['-- ', '']);
  });
});

describe('annotations', () => {
  const issue: Issue = { filePath: '/repo/docs/adr/0001-a.md', line: 4, severity: 'error', code: 'missing-title', message: '50% done\nnext', adrId: 1 };

  it('escapes workflow commands', () => {
    expect(escapeData('a%b\r\nc')).toBe('a%25b%0D%0Ac');
    expect(escapeProperty('C:\\x,y')).toBe('C%3A\\x%2Cy');
    expect(githubAnnotation(issue, '/repo')).toBe('::error file=docs/adr/0001-a.md,line=5,title=ADR missing-title::50%25 done%0Anext');
    expect(githubAnnotation({ ...issue, severity: 'info' }, '/repo')).toMatch(/^::notice /);
  });

  it('relativises paths only inside the root', () => {
    expect(relativeTo('/repo/', '/repo/a/b.md')).toBe('a/b.md');
    expect(relativeTo('/repo', '/other/a.md')).toBe('/other/a.md');
    expect(relativeTo('C:\\Repo', 'c:\\repo\\a.md')).toBe('a.md');
  });

  it('applies the fail-on threshold', () => {
    const warn = { ...issue, severity: 'warning' as const };
    expect(shouldFail([warn], 'error')).toBe(false);
    expect(shouldFail([warn], 'warning')).toBe(true);
    expect(shouldFail([issue], 'never')).toBe(false);
    expect(shouldFail([], 'info')).toBe(false);
  });

  it('pins the CLI version in the generated workflow', () => {
    expect(cliDownloadUrl('1.2.3')).toBe('https://github.com/JirakJ/vscode-adr-companion/releases/download/v1.2.3/adr-companion-cli.cjs');
    const wf = ciWorkflow('1.2.3');
    expect(wf).toContain('/v1.2.3/adr-companion-cli.cjs');
    expect(wf).toContain('fetch-depth: 0');
    expect(wf).toContain('governance --format github');
  });
});
