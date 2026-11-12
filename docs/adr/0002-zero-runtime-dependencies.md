# 2. Zero runtime dependencies

Date: 2026-11-10

## Status

Accepted

## Context

An editor extension runs inside every developer's VS Code and its CLI runs on every CI build. Each runtime dependency is supply-chain exposure and install time. The configuration format only needs flat `key: value` pairs and string lists.

## Decision

Ship no runtime dependencies. The YAML subset parser, glob matcher and Markdown parsing are written in `src/core`, bundled with esbuild into `dist/extension.js` and a single-file `dist/adr-companion-cli.cjs`.

## Consequences

The CLI can be downloaded as one file and run with plain `node`. We maintain a small parser ourselves and deliberately do not support full YAML (anchors, multi-line scalars).
