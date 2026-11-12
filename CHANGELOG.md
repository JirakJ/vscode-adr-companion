# Changelog

## [1.0.0] - 2026-11-12

First release.

### Added
- Create ADRs from Nygard, MADR, RFC, Y-Statement, Tyree & Akerman or a custom template with
  automatic numbering that keeps the existing zero padding.
- Create an ADR from a merged pull request (`git log --merges`) or a copied PR description, with
  Context / Decision / Consequences extraction, PR-number detection and title suggestions.
- Architecture Decisions view in the Explorer (by status, timeline by month, or flat), status-bar count
  and Go to ADR.
- `@adr:NNNN` annotations: links, hover cards, completion, Link Code to ADR (`Cmd/Ctrl+Alt+A`) and
  Find Code References.
- Change Status with lifecycle hints; Superseded writes the successor link and a `Supersedes`
  backlink (front matter and Status section kept in sync).
- Renumber ADR: file name, heading, front matter and every reference across the folder in one step.
- Live lint diagnostics: required fields per status, supersede links, duplicate numbers, stale
  proposals, unknown statuses, invalid dates, number conflicts, leftover placeholders, outdated or
  missing `@adr` targets.
- Copy Status Summary, Generate Index, Export Relationship Graph (Mermaid / Graphviz DOT).
- Team configuration via `.adr-config.yaml` (shared format with the JetBrains plugin), with warnings
  shown on the file.
- Governance check for `requireAdrForPaths` in the editor and in CI.
- `adr-companion` CLI (`lint`, `governance`, `graph`, `index`, `summary`) with text, JSON and GitHub
  Actions annotation output, attached to every GitHub release; command to generate the workflow.
