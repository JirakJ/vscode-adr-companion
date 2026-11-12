# 4. Use PostgreSQL for persistence

Date: 2025-01-08

## Status

Accepted

Supersedes [ADR-0001](0001-use-mysql.md)

## Context

Order documents need JSONB indexing and logical replication.

## Decision

Migrate to PostgreSQL 17.

## Consequences

One-off migration effort; MySQL tooling is retired.
