import type { VerificationReport } from "@maru/evidence";

export const AGENT_HOOK_SETTINGS_PATH = ".claude/settings.json";
export const AGENT_GATE_STATE_PATH = ".maru/generated/agent-gate.json";
export const AGENT_HOOK_COMMAND = "npx --no-install maru hook run";
export const AGENT_HOOK_EVENT = "Stop";

/**
 * The gate stops blocking after this many consecutive Stop events so a change the
 * agent cannot fix on its own returns control to the human instead of looping.
 */
export const AGENT_GATE_MAX_CONSECUTIVE_BLOCKS = 3;

export type AgentGateSkipReason =
  "gate-passed" | "loop-guard" | "not-initialized" | "verification-unavailable";

/** The subset of the Claude Code Stop hook payload the gate reads. */
export interface AgentHookInput {
  readonly cwd?: string;
  readonly hook_event_name?: string;
  readonly session_id?: string;
  readonly stop_hook_active?: boolean;
}

export interface AgentGateState {
  readonly consecutiveBlocks: number;
  readonly lastBlockedAt: string;
  readonly sessionId: string;
}

export interface AgentGateDecision {
  /** True when the agent is prevented from ending its turn. */
  readonly blocked: boolean;
  readonly exitCode: 0 | 2;
  /** Written to stdout for Claude Code to parse. */
  readonly payload: Readonly<Record<string, unknown>>;
  /** Written to stderr; Claude Code shows this as the blocking reason. */
  readonly reason: string;
  readonly report?: VerificationReport;
  readonly skipped?: AgentGateSkipReason;
}

export interface AgentHookInstallResult {
  readonly command: string;
  readonly created: boolean;
  readonly path: typeof AGENT_HOOK_SETTINGS_PATH;
  readonly updated: boolean;
}

export interface AgentHookUninstallResult {
  readonly path: typeof AGENT_HOOK_SETTINGS_PATH;
  readonly removed: boolean;
}
