# 6. SOAP gateway for legacy ERP

Date: 2024-02-01

## Status

Deprecated

## Context

The legacy ERP only speaks SOAP. Amends ADR-0002.

## Decision

Run a SOAP-to-REST gateway.

## Consequences

Extra hop for ERP calls until the ERP is replaced.
