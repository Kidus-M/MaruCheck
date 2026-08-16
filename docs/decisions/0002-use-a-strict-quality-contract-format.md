# ADR-002: Use a strict Quality Contract format

## Status

Accepted

## Date

2026-08-16

## Context

Quality Contracts are security-sensitive, version-controlled product intent. Phase 2 needs YAML parsing and schema validation, while the local CLI must remain buildable offline and should not accept executable or ambiguous YAML features. The managed npm environment did not have Zod or a YAML parser available in its cache.

## Decision

Implement the documented Quality Contract YAML subset and typed validation inside `@maru/contracts`. Accept the mappings, sequences, nested values, comments, quotes, and text blocks used by the schema. Reject anchors, aliases, tags, merge keys, duplicate keys, tabs, oversized documents, unsafe identifiers, and paths outside the project root.

Keep parsing, validation, semantic diffing, hashing, and persistence behind exported domain APIs so a mature external schema implementation can replace the internals without changing CLI behavior.

## Alternatives considered

### Zod and a general YAML package

These are mature choices, but neither dependency was available in the offline npm cache. Adding unresolved dependencies would make the repository unbuildable.

### JSON contracts

JSON would simplify parsing but conflicts with the plan's human-authored YAML contract format and makes multiline product intent less readable.

### Full YAML implementation

Supporting the complete YAML specification would increase complexity and admit features that contracts do not need. A deliberately bounded format is easier to validate and audit.

## Consequences

- Phase 2 stays dependency-free and works offline.
- Contract files have deterministic serialization and a smaller parsing attack surface.
- Unsupported YAML features produce explicit validation errors.
- A future external schema library must preserve the public model, safety policy, and CLI behavior or supersede this ADR.
