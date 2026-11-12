# 1. Use MySQL for persistence

Date: 2023-03-14

## Status

Superseded by [ADR-0004](0004-use-postgresql.md)

## Context

The first version of the order service needs a relational store the team already knows.

## Decision

Use a managed MySQL 8 instance.

## Consequences

JSON querying is limited.
