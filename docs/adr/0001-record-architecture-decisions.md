# 1. Record architecture decisions

Date: 2026-11-10

## Status

Accepted

## Context

ADR Companion is a tool for decision records, so its own design choices should be written down the same way. Contributors need to know why the extension has no runtime dependencies and why git is only ever called through `execFile`.

## Decision

We record architecturally significant decisions in `docs/adr` using the Nygard format, lint them in CI with the bundled CLI, and reference them from code with `@adr:NNNN` annotations.

## Consequences

Every pull request that changes `src/core/**` or `src/node/git.ts` needs a decision record or an update to an existing one (`requireAdrForPaths` in `.adr-config.yaml`).
