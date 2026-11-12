# 2. REST API for partner integrations

Date: 2023-09-02

## Status

Accepted

## Context

Partners integrate with plain HTTP clients and need a stable, documented contract.

## Decision

Expose a versioned REST API described in OpenAPI 3.1.

## Consequences

Breaking changes require a new major version path (`/v2`).
