---
number: 3
title: gRPC between internal services
status: accepted
date: 2024-05-20
---
# gRPC between internal services

## Context and Problem Statement

Internal calls are chatty and JSON parsing dominates latency.

## Decision Outcome

Chosen option: gRPC with protobuf contracts. Depends on ADR-0002 for the public edge.

### Positive Consequences

* Typed contracts generated for every service.
