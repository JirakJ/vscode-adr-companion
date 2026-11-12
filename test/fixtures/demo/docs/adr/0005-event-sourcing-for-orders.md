# 5. Event sourcing for orders

Date: 2025-04-11

## Status

Proposed

## Context

Auditors need the full history of every order. Builds on ADR-0004.

## Decision

Store order changes as an append-only event stream.

## Consequences

Read models must be rebuilt from events.
