# 5. Native tree view instead of a webview dashboard

Date: 2026-11-11

## Status

Proposed

## Context

A webview could render the relationship graph inline, but it needs a content security policy, a bundled Mermaid build or a CDN, and it does not follow the editor's theme or accessibility settings for free.

## Decision

Show decision records in a native Explorer tree view (grouped by status, by month or flat) and export the graph as Mermaid or DOT text that GitHub, GitLab and Confluence render already.

## Consequences

The extension stays small and theme-aware. An interactive in-editor graph is left for a later decision that would supersede this one.
