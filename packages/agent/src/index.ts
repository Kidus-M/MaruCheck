import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
  createAndWriteVerificationReport,
  type VerificationReport,
  type VerificationReportResult,
} from "@maru/evidence";
import {
  AGENT_GATE_MAX_CONSECUTIVE_BLOCKS,
  AGENT_GATE_STATE_PATH,
  AGENT_HOOK_COMMAND,
  AGENT_HOOK_EVENT,
  AGENT_HOOK_SETTINGS_PATH,
  type AgentGateDecision,
  type AgentGateState,
  type AgentHookInput,
  type AgentHookInstallResult,
  type AgentHookUninstallResult,
} from "./types.js";

export * from "./types.js";

const MAX_REPORTED_FINDINGS = 5;
const HOOK_TIMEOUT_SECONDS = 600;

export type AgentErrorCode =
  "AGENT_HOOK_NOT_INITIALIZED" | "AGENT_HOOK_SETTINGS_INVALID" | "AGENT_HOOK_WRITE_FAILED";

export class AgentError extends Error {
  public constructor(
    public readonly code: AgentErrorCode,
    message: string,
    public readonly remediation: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "AgentError";
  }
}

function settingsFile(root: string): string {
  return join(resolve(root), ...AGENT_HOOK_SETTINGS_PATH.split("/"));
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function initialized(root: string): Promise<boolean> {
  return exists(join(resolve(root), ".maru", "maru.yml"));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The Stop hook group MaruCheck installs into Claude Code settings. */
export function createStopHookGroup(): Record<string, unknown> {
  return {
    hooks: [
      {
        command: AGENT_HOOK_COMMAND,
        statusMessage: "Verifying the change against approved Quality Contracts",
        timeout: HOOK_TIMEOUT_SECONDS,
        type: "command",
      },
    ],
  };
}

function isMaruHookGroup(group: unknown): boolean {
  if (!isRecord(group) || !Array.isArray(group.hooks)) return false;
  return group.hooks.some(
    (hook) =>
      isRecord(hook) && typeof hook.command === "string" && hook.command.includes("maru hook run"),
  );
}

async function readSettings(path: string): Promise<Record<string, unknown>> {
  if (!(await exists(path))) return {};
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    throw new AgentError(
      "AGENT_HOOK_WRITE_FAILED",
      `Unable to read ${AGENT_HOOK_SETTINGS_PATH}.`,
      "Check file permissions, then run maru hook install again.",
      { cause: error },
    );
  }
  if (raw.trim() === "") return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new AgentError(
      "AGENT_HOOK_SETTINGS_INVALID",
      `${AGENT_HOOK_SETTINGS_PATH} is not valid JSON.`,
      "Repair the settings file by hand, then run maru hook install again; it was not overwritten.",
      { cause: error },
    );
  }
  if (!isRecord(parsed)) {
    throw new AgentError(
      "AGENT_HOOK_SETTINGS_INVALID",
      `${AGENT_HOOK_SETTINGS_PATH} does not contain a JSON object.`,
      "Repair the settings file by hand, then run maru hook install again; it was not overwritten.",
    );
  }
  return parsed;
}

async function writeSettings(path: string, settings: Record<string, unknown>): Promise<void> {
  try {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
  } catch (error) {
    throw new AgentError(
      "AGENT_HOOK_WRITE_FAILED",
      `Unable to write ${AGENT_HOOK_SETTINGS_PATH}.`,
      "Check directory permissions and available disk space, then retry.",
      { cause: error },
    );
  }
}

/**
 * Register the verification gate as a Claude Code Stop hook, preserving every
 * other setting and every hook the project already declares.
 */
export async function installAgentHook(root: string): Promise<AgentHookInstallResult> {
  if (!(await initialized(root))) {
    throw new AgentError(
      "AGENT_HOOK_NOT_INITIALIZED",
      "MaruCheck must be initialized before the agent gate can be installed.",
      "Run maru init from the repository root, then run maru hook install again.",
    );
  }

  const path = settingsFile(root);
  const settings = await readSettings(path);
  const hooks = isRecord(settings.hooks) ? { ...settings.hooks } : {};
  const declared = hooks[AGENT_HOOK_EVENT];
  const existing = Array.isArray(declared) ? [...declared] : [];
  const base = { command: AGENT_HOOK_COMMAND, path: AGENT_HOOK_SETTINGS_PATH } as const;

  if (existing.some((group) => isMaruHookGroup(group))) {
    return { ...base, created: false, updated: false };
  }

  hooks[AGENT_HOOK_EVENT] = [...existing, createStopHookGroup()];
  await writeSettings(path, { ...settings, hooks });
  return { ...base, created: existing.length === 0, updated: existing.length > 0 };
}

/** Remove the MaruCheck Stop hook without touching any other hook. */
export async function uninstallAgentHook(root: string): Promise<AgentHookUninstallResult> {
  const path = settingsFile(root);
  const settings = await readSettings(path);
  const hooks = isRecord(settings.hooks) ? { ...settings.hooks } : {};
  const declared = hooks[AGENT_HOOK_EVENT];
  const existing = Array.isArray(declared) ? declared : [];
  const remaining = existing.filter((group) => !isMaruHookGroup(group));
  if (remaining.length === existing.length) {
    return { path: AGENT_HOOK_SETTINGS_PATH, removed: false };
  }

  if (remaining.length === 0) {
    delete hooks[AGENT_HOOK_EVENT];
  } else {
    hooks[AGENT_HOOK_EVENT] = remaining;
  }
  const next: Record<string, unknown> = { ...settings, hooks };
  if (Object.keys(hooks).length === 0) delete next.hooks;
  await writeSettings(path, next);
  return { path: AGENT_HOOK_SETTINGS_PATH, removed: true };
}

/** Parse the JSON Claude Code writes to hook stdin, tolerating an empty body. */
export function parseAgentHookInput(raw: string): AgentHookInput {
  if (raw.trim() === "") return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return isRecord(parsed) ? (parsed as AgentHookInput) : {};
  } catch {
    return {};
  }
}

function statePath(root: string): string {
  return join(resolve(root), ...AGENT_GATE_STATE_PATH.split("/"));
}

async function readState(root: string): Promise<AgentGateState | undefined> {
  try {
    const parsed: unknown = JSON.parse(await readFile(statePath(root), "utf8"));
    if (!isRecord(parsed) || typeof parsed.consecutiveBlocks !== "number") return undefined;
    return {
      consecutiveBlocks: parsed.consecutiveBlocks,
      lastBlockedAt: typeof parsed.lastBlockedAt === "string" ? parsed.lastBlockedAt : "",
      sessionId: typeof parsed.sessionId === "string" ? parsed.sessionId : "",
    };
  } catch {
    return undefined;
  }
}

async function writeState(root: string, state: AgentGateState): Promise<void> {
  const path = statePath(root);
  try {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  } catch {
    // The gate keeps working when the state file cannot be persisted; the only
    // cost is that the loop guard restarts its count.
  }
}

function bounded(value: string, limit = 200): string {
  const normalized = value.replace(/\s+/gu, " ").trim();
  return normalized.length <= limit ? normalized : `${normalized.slice(0, limit - 1)}...`;
}

/** Build the text the agent reads when the gate refuses to let the turn end. */
export function formatAgentGateReason(report: VerificationReport): string {
  const blocking = report.findings.filter((finding) => finding.blocking);
  const lines = [
    "MaruCheck gate: BLOCKED.",
    `Risk ${report.risk.level} (${String(report.risk.score)}). ` +
      `${String(report.summary.requirementsFailed)} requirement(s) failed, ` +
      `${String(report.summary.requirementsInconclusive)} inconclusive.`,
    "",
  ];

  for (const reason of report.gate.reasons.slice(0, MAX_REPORTED_FINDINGS)) {
    lines.push(`- ${bounded(reason)}`);
  }

  if (blocking.length > 0) {
    lines.push("", "Blocking findings:");
    for (const finding of blocking.slice(0, MAX_REPORTED_FINDINGS)) {
      lines.push(`- ${finding.requirementRef}: ${bounded(finding.title)}`);
      lines.push(`    expected:  ${bounded(finding.expected)}`);
      lines.push(`    actual:    ${bounded(finding.actual)}`);
      lines.push(`    reproduce: ${bounded(finding.reproduction.command)}`);
    }
    if (blocking.length > MAX_REPORTED_FINDINGS) {
      lines.push(`- ...and ${String(blocking.length - MAX_REPORTED_FINDINGS)} more.`);
    }
  }

  lines.push(
    "",
    `Full evidence: ${report.artifacts.report}`,
    "Change the code so the approved contract holds. Do not edit or re-approve the",
    "contract to make this pass; if the contract itself is wrong, stop and tell the",
    "human to run maru drift propose.",
  );
  return lines.join("\n");
}

function blockedPayload(reason: string): Record<string, unknown> {
  return {
    hookSpecificOutput: {
      continue: true,
      hookEventName: AGENT_HOOK_EVENT,
      stopReason: reason,
      suppressOutput: false,
    },
    systemMessage: reason,
  };
}

function passthroughPayload(systemMessage?: string): Record<string, unknown> {
  return systemMessage === undefined ? {} : { systemMessage };
}

export interface RunAgentGateOptions {
  readonly createReport?: (root: string, now: Date) => Promise<VerificationReportResult>;
  readonly input?: AgentHookInput;
  readonly now?: Date;
}

/**
 * Verify the working tree on behalf of a coding agent that is trying to end its
 * turn. A blocked gate is reported back to the agent; every other outcome, including
 * a gate that could not run, lets the turn end so the hook never wedges a session.
 */
export async function runAgentGate(
  root: string,
  options: RunAgentGateOptions = {},
): Promise<AgentGateDecision> {
  const input = options.input ?? {};
  const now = options.now ?? new Date();
  const sessionId = input.session_id ?? "";

  if (!(await initialized(root))) {
    return { blocked: false, exitCode: 0, payload: {}, reason: "", skipped: "not-initialized" };
  }

  const previous = await readState(root);
  const priorBlocks = previous?.sessionId === sessionId ? previous.consecutiveBlocks : 0;
  if (input.stop_hook_active === true || priorBlocks >= AGENT_GATE_MAX_CONSECUTIVE_BLOCKS) {
    const message =
      `MaruCheck gate is still blocked after ${String(priorBlocks)} attempt(s). ` +
      "Returning control to the human instead of looping; run maru verify --diff to see why.";
    await writeState(root, { consecutiveBlocks: 0, lastBlockedAt: now.toISOString(), sessionId });
    return {
      blocked: false,
      exitCode: 0,
      payload: passthroughPayload(message),
      reason: message,
      skipped: "loop-guard",
    };
  }

  let result: VerificationReportResult;
  try {
    result = await (options.createReport ?? createAndWriteVerificationReport)(root, now);
  } catch (error) {
    const detail = error instanceof Error ? bounded(error.message) : "unknown error";
    const message = `MaruCheck gate did not run: ${detail} The turn was not blocked.`;
    return {
      blocked: false,
      exitCode: 0,
      payload: passthroughPayload(message),
      reason: message,
      skipped: "verification-unavailable",
    };
  }

  if (result.report.gate.status !== "blocked") {
    await writeState(root, { consecutiveBlocks: 0, lastBlockedAt: "", sessionId });
    const message = `MaruCheck gate: passed. Evidence: ${result.report.artifacts.report}`;
    return {
      blocked: false,
      exitCode: 0,
      payload: passthroughPayload(message),
      reason: message,
      report: result.report,
      skipped: "gate-passed",
    };
  }

  const reason = formatAgentGateReason(result.report);
  await writeState(root, {
    consecutiveBlocks: priorBlocks + 1,
    lastBlockedAt: now.toISOString(),
    sessionId,
  });
  return {
    blocked: true,
    exitCode: 2,
    payload: blockedPayload(reason),
    reason,
    report: result.report,
  };
}
