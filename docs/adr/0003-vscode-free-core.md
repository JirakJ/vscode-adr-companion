# 3. Keep the core free of the VS Code API

Date: 2026-11-10

## Status

Accepted

## Context

The lint rules, governance check and graph export must behave the same in the editor and in CI. Code that imports `vscode` cannot run in the CLI or in plain unit tests.

## Decision

Everything in `src/core` is pure TypeScript over strings and plain objects. File-system and git access live in `src/node`, and only `src/ui` and `src/extension.ts` import `vscode`. Related to ADR-0002.

## Consequences

The core is covered by fast vitest tests without an extension host. The editor diagnostics and `adr-companion lint` cannot drift apart because they call the same function.
