# Phase 3: MCP integration

MaruCheck runs as a local Model Context Protocol server over newline-delimited stdio. Build it once, then configure the coding agent to start it with the target project's directory as its working directory.

```powershell
cd C:\path\to\MaruCheck\maru-cli
npm install
npm run build
```

The server command is:

```powershell
node C:\path\to\MaruCheck\maru-cli\packages\cli\dist\index.js mcp
```

The process writes only valid JSON-RPC messages to stdout. Close its stdin to stop it.

## Tools

| Tool                              | Behavior                                                                            | Access                         |
| --------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------ |
| `maru_get_project_context`        | Return project architecture, test inventory, routes, and contract summaries         | Read-only                      |
| `maru_list_contracts`             | List contract lifecycle, criticality, path, and version hash                        | Read-only                      |
| `maru_get_contract`               | Return one validated contract and its stable version hash                           | Read-only                      |
| `maru_create_contract`            | Create a review-required draft from requirements; never approve it                  | Local write                    |
| `maru_validate_contract`          | Validate every current contract or one project-root-bounded path                    | Read-only                      |
| `maru_analyze_diff`               | Return bounded staged, unstaged, and untracked change metadata and classifications  | Read-only                      |
| `maru_assess_risk`                | Return deterministic risk, reasons, related contracts, and test categories          | Read-only                      |
| `maru_create_verification_plan`   | Write a requirement-linked, risk-based verification plan                            | Local write                    |
| `maru_run_verification`           | Execute tests and persist raw artifacts, evidence, findings, and JSON report        | Local write and code execution |
| `maru_run_mutation_verification`  | Test selected tests against bounded mutations in an isolated Git worktree           | Local write and code execution |
| `maru_check_semantic_drift`       | Compare observations with protected contract expectations                           | Read-only                      |
| `maru_propose_contract_amendment` | Write an immutable pending amendment; never approve or rewrite the current contract | Local write                    |
| `maru_record_bug`                 | Record a confirmed bug, root cause, links, tags, and regression tests               | Local write                    |
| `maru_query_memory`               | Search historical QA memory with explainable matches                                | Read-only                      |

Every tool publishes a closed JSON input schema, a structured JSON result, and a JSON text fallback. Tool execution errors include a stable code, safe message, remediation, and validation issues when available.

Project context returns totals plus at most 100 source, route, test, dependency, and contract items per category. The complete scan remains available locally at `.maru/generated/project-scan.json`, preventing large repositories from consuming an agent's context window unnecessarily.

## Codex

Codex can store MCP settings in the user configuration or a trusted project's `.codex/config.toml`. The sibling `maru-web` repository already includes this portable project-scoped configuration:

```toml
[mcp_servers.maru]
command = "node"
args = ["../maru-cli/packages/cli/dist/index.js", "mcp"]
required = false
default_tools_approval_mode = "writes"
```

The relative path works on Windows, macOS, and Linux when `maru-cli` and `maru-web` are sibling folders. `required = false` means Codex still opens normally when a contributor has only cloned the web repository or has not built the CLI yet. The MCP tools become available after the CLI is installed and built.

For a different folder layout, add the server to your user configuration with an absolute path, or run this while inside the target project and adjust the path:

```powershell
codex mcp add maru -- node ..\maru-cli\packages\cli\dist\index.js mcp
codex mcp list
```

Trust the project when Codex prompts, restart the Codex host after changing configuration, then use `/mcp` to inspect the connection.

This file is only a Codex convenience. The `maru mcp` process uses standard MCP stdio and does not depend on Codex, so other clients can use the same server command.

## Claude Code

From the target project, add a project-scoped stdio server:

```powershell
claude mcp add maru --scope project -- node ..\maru-cli\packages\cli\dist\index.js mcp
claude mcp list
```

Claude Code writes shared project configuration to `.mcp.json` and asks for approval before using project-scoped servers.

## Cursor

Add `.cursor/mcp.json` to the target project, replacing the executable path with the absolute local path:

```json
{
  "mcpServers": {
    "maru": {
      "command": "node",
      "args": ["C:\\path\\to\\MaruCheck\\maru-cli\\packages\\cli\\dist\\index.js", "mcp"]
    }
  }
}
```

Restart Cursor and enable `maru` in MCP settings.

## Recommended agent workflow

1. Call `maru_get_project_context` before changing behavior.
2. Call `maru_get_contract` for the affected feature.
3. Call `maru_query_memory` for the affected domain and review earlier root causes and regression tests.
4. Call `maru_check_semantic_drift` before changing a protected expectation.
5. Implement the change without weakening or auto-approving the contract. If product intent should change, create a pending proposal with `maru_propose_contract_amendment` for an owner to review separately.
6. Call `maru_analyze_diff` to inspect change metadata and classifications.
7. Call `maru_assess_risk` to inspect score contributions, historical matches, and related requirements.
8. Call `maru_create_verification_plan` and review automatically included historical regressions plus unavailable or uncovered work.
9. Call `maru_run_verification`; review any temporary test source before allowing execution.
10. For important contracts, call `maru_run_mutation_verification` and treat surviving or inconclusive mutations as unresolved verification.
11. Treat a blocked report gate or any blocking finding as unresolved verification.
12. Record confirmed bugs with `maru_record_bug`, including a reviewed regression-test path, then validate contracts with `maru_validate_contract`.

## Protocol and safety

- Stable protocol target: MCP `2025-11-25`, with negotiation for `2025-06-18` and `2024-11-05` clients.
- Transport: local stdio only; no listening network socket or authentication surface.
- Paths remain inside the configured project root.
- Contract creation always produces `draft` status. Planning, verification, and amendment proposals also write bounded local artifacts.
- MCP can propose a semantic amendment but cannot approve one; approval requires a separate current-owner CLI action.
- MCP records immutable QA memory but cannot rewrite an existing record.
- Git analysis invokes `git` directly without a shell and returns metadata rather than changed source lines.
- stdout is reserved for MCP messages; clients should apply normal tool approval controls.

References: [MCP lifecycle](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle), [stdio transport](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports), [MCP tools](https://modelcontextprotocol.io/specification/2025-11-25/server/tools), [Codex MCP configuration](https://developers.openai.com/codex/mcp), [Claude Code MCP](https://docs.anthropic.com/en/docs/claude-code/mcp), and [Cursor MCP](https://docs.cursor.com/context/model-context-protocol).
