# ADR-003: Use a local stdio MCP server

## Status

Accepted

## Date

2026-08-16

## Context

MaruCheck must let coding agents inspect project context and Quality Contracts before modifying code. The first integration must work locally without accounts, credentials, listening ports, or repository uploads. The official MCP TypeScript SDK was not available in the managed offline npm cache.

## Decision

Implement the bounded MCP JSON-RPC surface in `@maru/mcp-server` and run it through newline-delimited stdio with `maru mcp`. Target stable MCP version `2025-11-25` and negotiate the prior `2025-06-18` and `2024-11-05` versions.

Expose only namespaced `maru_*` tools with closed input schemas, structured object results, text fallbacks, and safety annotations. Keep transport, protocol lifecycle, tool definitions, and domain operations in separate modules so the official SDK can replace protocol internals later without changing tool contracts.

Contract approval is intentionally absent from MCP. Agent-created contracts remain drafts requiring human review.

## Alternatives considered

### Streamable HTTP

HTTP enables remote access but introduces a listening service, origin validation, authentication, and session management before the product needs them.

### Official TypeScript SDK

The SDK is the preferred long-term implementation, but it was unavailable offline. Adding an unresolved dependency would make the workspace unbuildable.

### Client-specific plugins only

Separate integrations for Codex, Claude Code, and Cursor would duplicate behavior and create inconsistent tool contracts. MCP provides one interoperable surface.

## Consequences

- The server remains local-first and has no network authentication surface.
- Codex, Claude Code, Cursor, and compatible clients can launch the same command.
- Protocol compatibility and framing are covered by integration tests.
- The server must keep stdout free of non-protocol output.
- Remote transport, authentication, resources, prompts, and server-initiated features remain future decisions.
