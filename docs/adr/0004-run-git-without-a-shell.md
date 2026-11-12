# 4. Run git without a shell

Date: 2026-11-11

## Status

Accepted

## Context

Creating ADRs from merged pull requests and the governance check both call git with user-supplied refs. Building a shell command string from a branch name is an injection risk, and git itself can execute configured programs in an untrusted repository.

## Decision

Git is invoked only through `child_process.execFile('git', [...args])` with an argument array. Refs are rejected when they start with `-` or contain whitespace. Both features are disabled until the workspace is trusted. Depends on ADR-0003.

## Consequences

No quoting rules to get wrong. Users of untrusted workspaces can still browse, lint and edit decision records, but not run git-backed commands.
