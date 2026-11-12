import { describe, expect, it } from 'vitest';
import { fileNumber, isAuxiliaryFile, isValidIsoDate, parseAdr, parseFrontMatter, parseTitleHeading, splitLines } from '../src/core/parser';
import { allowedTransitions, isTransitionAllowed, parseStatus } from '../src/core/status';

const NYGARD = `# 7. Use Kafka for events

Date: 2026-01-15

## Status

Superseded by [ADR-0012](0012-use-nats.md)

## Context

We need durable messaging.

## Decision

Use Kafka.

## Consequences

Operations must run a cluster.
`;

const MADR = `---
number: 3
title: "Adopt PostgreSQL: the default store"
status: accepted
date: 2025-11-02
supersedes: [1, ADR-0002]
---
# Adopt PostgreSQL

## Context and Problem Statement

Need a relational store.

## Decision Outcome

Chosen option: PostgreSQL.

### Positive Consequences

* Mature.
`;

describe('status', () => {
  it('parses aliases, emphasis and trailing words', () => {
    expect(parseStatus('Accepted')).toBe('accepted');
    expect(parseStatus('**approved**')).toBe('accepted');
    expect(parseStatus('superceded')).toBe('superseded');
    expect(parseStatus('Superseded by ADR 7')).toBe('superseded');
    expect(parseStatus('proposed (rfc-42)')).toBe('proposed');
    expect(parseStatus('work in progress')).toBe('draft');
    expect(parseStatus('in review')).toBe('proposed');
    expect(parseStatus('declined.')).toBe('rejected');
    expect(parseStatus('banana')).toBe('unknown');
    expect(parseStatus('')).toBe('unknown');
    expect(parseStatus(null)).toBe('unknown');
  });

  it('enforces the lifecycle', () => {
    expect(isTransitionAllowed('proposed', 'accepted')).toBe(true);
    expect(isTransitionAllowed('accepted', 'superseded')).toBe(true);
    expect(isTransitionAllowed('superseded', 'accepted')).toBe(false);
    expect(isTransitionAllowed('rejected', 'rejected')).toBe(true);
    expect(isTransitionAllowed('unknown', 'accepted')).toBe(true);
    expect(allowedTransitions('deprecated')).toEqual([]);
  });
});

describe('parseAdr', () => {
  it('parses a Nygard record with a supersede link', () => {
    const r = parseAdr(NYGARD, '/repo/docs/adr/0007-use-kafka.md');
    expect(r.id).toBe(7);
    expect(r.title).toBe('Use Kafka for events');
    expect(r.status).toBe('superseded');
    expect(r.statusLine).toBe(6);
    expect(r.date).toBe('2026-01-15');
    expect(r.dateLine).toBe(2);
    expect(r.context).toBe('We need durable messaging.');
    expect(r.decision).toBe('Use Kafka.');
    expect(r.consequences).toBe('Operations must run a cluster.');
    expect(r.supersededBy).toEqual([12]);
    expect(r.hasFrontMatter).toBe(false);
  });

  it('parses MADR front matter, quoted titles, supersedes lists and h3 consequences', () => {
    const r = parseAdr(MADR, 'docs/adr/0003-adopt-postgresql.md');
    expect(r.id).toBe(3);
    expect(r.title).toBe('Adopt PostgreSQL: the default store');
    expect(r.status).toBe('accepted');
    expect(r.statusLine).toBe(3);
    expect(r.date).toBe('2025-11-02');
    expect(r.supersedes).toEqual([1, 2]);
    expect(r.context).toBe('Need a relational store.');
    expect(r.decision).toContain('Chosen option: PostgreSQL.');
    expect(r.consequences).toBe('* Mature.');
  });

  it('falls back to the file name number and inline Status lines', () => {
    const r = parseAdr('# Use REST\n\nStatus: **Proposed**\nDate: 2026-02-30\n', 'adr/0042-use-rest.md');
    expect(r.id).toBe(42);
    expect(r.headingNumber).toBeNull();
    expect(r.status).toBe('proposed');
    expect(r.dateRaw).toBe('2026-02-30');
    expect(r.date).toBeNull();
  });

  it('reads ADR-/RFC-prefixed titles', () => {
    expect(parseAdr('# ADR-0009: Event sourcing\n', 'x.md').id).toBe(9);
    expect(parseAdr('# RFC-4: Plugins\n', 'x.md').title).toBe('Plugins');
  });

  it('does not read supersede links from the body and ignores fenced headings', () => {
    const content = '# 2. Thing\n\n## Status\n\nAccepted\n\n## Context\n\nADR 1 was superseded by ADR 5 long ago.\n\n```\n## Decision\n```\n';
    const r = parseAdr(content, '0002-thing.md');
    expect(r.supersededBy).toEqual([]);
    expect(r.decision).toBe('');
    expect(r.sections.map((s) => s.title)).toEqual(['2. Thing', 'Status', 'Context']);
  });

  it('records a missing status as null and tolerates CRLF + BOM', () => {
    const r = parseAdr('﻿# 1. Init\r\n\r\nSome text\r\n', '0001-init.md');
    expect(r.title).toBe('Init');
    expect(r.statusRaw).toBeNull();
    expect(r.status).toBe('unknown');
  });
});

describe('helpers', () => {
  it('parses block lists in front matter and rejects unterminated blocks', () => {
    const fm = parseFrontMatter(splitLines('---\nsupersedes:\n  - 1\n  - "2"\nstatus: accepted # note\n---\nbody'));
    expect(fm?.entries.get('supersedes')?.value).toEqual(['1', '2']);
    expect(fm?.entries.get('status')?.value).toBe('accepted');
    expect(parseFrontMatter(splitLines('---\ntitle: x\n'))).toBeNull();
  });

  it('validates ISO dates', () => {
    expect(isValidIsoDate('2024-02-29')).toBe(true);
    expect(isValidIsoDate('2023-02-29')).toBe(false);
    expect(isValidIsoDate('15.1.2026')).toBe(false);
  });

  it('knows auxiliary files and file numbers', () => {
    expect(isAuxiliaryFile('README.md')).toBe(true);
    expect(isAuxiliaryFile('index.md')).toBe(true);
    expect(isAuxiliaryFile('.adr-template.md')).toBe(true);
    expect(isAuxiliaryFile('0001-x.md')).toBe(false);
    expect(isAuxiliaryFile('notes.txt')).toBe(true);
    expect(fileNumber('0012_use-x.md')).toBe(12);
    expect(fileNumber('use-x.md')).toBeNull();
    expect(parseTitleHeading('2024 roadmap')).toEqual({ number: null, title: '2024 roadmap' });
  });
});
