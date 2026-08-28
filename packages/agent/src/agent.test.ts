import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { VerificationReport, VerificationReportResult } from "@maru/evidence";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AGENT_GATE_MAX_CONSECUTIVE_BLOCKS,
  AgentError,
  installAgentHook,
  parseAgentHookInput,
  runAgentGate,
  uninstallAgentHook,
} from "./index.js";

const NOW = new Date("2026-08-28T10:00:00.000Z");

function report(status: "blocked" | "passed"): VerificationReport {
  return {
    artifacts: {
      plan: ".maru/generated/verification-plan.json",
      report: ".maru/artifacts/runs/run-1/report.json",
      run: ".maru/artifacts/runs/run-1/run.json",
    },
    evidence: [],
    findings: [
      {
        actual: "resolvePlan returns request.claimedPlan when the client supplies one",
        artifactRefs: [],
        blocking: true,
        contractId: "usage-quota",
        contractTitle: "Usage quota",
        evidenceIds: ["evidence-001-jest"],
        expected: "The plan is read from the stored subscription, never from client data",
        explanation: "The contract regression suite failed for this requirement.",
        id: "finding-001",
        kind: "requirement-failure",
        reproduction: { command: "npx jest tests/usage-quota.contract.test.js", steps: [] },
        requirementId: "QUOTA-INV-001",
        requirementRef: "usage-quota#QUOTA-INV-001",
        severity: "critical",
        sourceLocations: [{ file: "src/quota.js", line: 12 }],
        status: "open",
        title: "Plan resolution trusts client-supplied data",
      },
    ],
    gate: {
      reasons: status === "blocked" ? ["1 blocking requirement failed."] : [],
      status,
    },
    generatedAt: NOW.toISOString(),
    project: { name: "quota-app" },
    requirementEvidence: [],
    risk: { level: "critical", score: 91 },
    runId: "run-1",
    runStatus: status === "blocked" ? "failed" : "passed",
    schemaVersion: 1,
    summary: {
      blockingFindings: status === "blocked" ? 1 : 0,
      evidence: 1,
      failedEvidence: status === "blocked" ? 1 : 0,
      findings: 1,
      inconclusiveEvidence: 0,
      passedEvidence: status === "blocked" ? 0 : 1,
      requirementsFailed: status === "blocked" ? 1 : 0,
      requirementsInconclusive: 0,
      requirementsPassed: status === "blocked" ? 0 : 1,
      requirementsUnverified: 0,
    },
  };
}

function reportResult(status: "blocked" | "passed"): VerificationReportResult {
  return {
    path: ".maru/artifacts/runs/run-1/report.json",
    planPath: ".maru/generated/verification-plan.json",
    report: report(status),
    run: {} as VerificationReportResult["run"],
    runPath: ".maru/artifacts/runs/run-1/run.json",
  };
}

describe("agent gate", () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      temporaryDirectories.splice(0).map((path) => rm(path, { force: true, recursive: true })),
    );
  });

  async function project(options: { readonly initialize?: boolean } = {}): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "maru-agent-"));
    temporaryDirectories.push(root);
    if (options.initialize !== false) {
      await mkdir(join(root, ".maru"), { recursive: true });
      await writeFile(join(root, ".maru", "maru.yml"), "version: 1\n", "utf8");
    }
    return root;
  }

  async function settings(root: string): Promise<Record<string, unknown>> {
    return JSON.parse(await readFile(join(root, ".claude", "settings.json"), "utf8")) as Record<
      string,
      unknown
    >;
  }

  it("installs a Stop hook without disturbing existing settings or hooks", async () => {
    const root = await project();
    await mkdir(join(root, ".claude"), { recursive: true });
    await writeFile(
      join(root, ".claude", "settings.json"),
      JSON.stringify({
        hooks: { Stop: [{ hooks: [{ command: "echo done", type: "command" }] }] },
        permissions: { allow: ["Bash(npm test)"] },
      }),
      "utf8",
    );

    const result = await installAgentHook(root);

    expect(result).toMatchObject({ created: false, path: ".claude/settings.json", updated: true });
    const written = await settings(root);
    expect(written.permissions).toEqual({ allow: ["Bash(npm test)"] });
    const stop = (written.hooks as { Stop: { hooks: { command: string }[] }[] }).Stop;
    expect(stop).toHaveLength(2);
    expect(stop[0]?.hooks[0]?.command).toBe("echo done");
    expect(stop[1]?.hooks[0]?.command).toContain("maru hook run");
  });

  it("is idempotent so repeated installs never stack hooks", async () => {
    const root = await project();

    const first = await installAgentHook(root);
    const second = await installAgentHook(root);

    expect(first).toMatchObject({ created: true, updated: false });
    expect(second).toMatchObject({ created: false, updated: false });
    const stop = (await settings(root)).hooks as { Stop: unknown[] };
    expect(stop.Stop).toHaveLength(1);
  });

  it("refuses to install before the project is initialized", async () => {
    const root = await project({ initialize: false });

    await expect(installAgentHook(root)).rejects.toMatchObject({
      code: "AGENT_HOOK_NOT_INITIALIZED",
    });
  });

  it("leaves an unparsable settings file untouched", async () => {
    const root = await project();
    await mkdir(join(root, ".claude"), { recursive: true });
    await writeFile(join(root, ".claude", "settings.json"), "{ not json", "utf8");

    await expect(installAgentHook(root)).rejects.toBeInstanceOf(AgentError);
    await expect(readFile(join(root, ".claude", "settings.json"), "utf8")).resolves.toBe(
      "{ not json",
    );
  });

  it("removes only the MaruCheck hook on uninstall", async () => {
    const root = await project();
    await mkdir(join(root, ".claude"), { recursive: true });
    await writeFile(
      join(root, ".claude", "settings.json"),
      JSON.stringify({ hooks: { Stop: [{ hooks: [{ command: "echo done", type: "command" }] }] } }),
      "utf8",
    );
    await installAgentHook(root);

    const result = await uninstallAgentHook(root);

    expect(result).toMatchObject({ removed: true });
    const stop = (await settings(root)).hooks as { Stop: { hooks: { command: string }[] }[] };
    expect(stop.Stop).toHaveLength(1);
    expect(stop.Stop[0]?.hooks[0]?.command).toBe("echo done");
  });

  it("blocks the turn and explains the failure when the gate is blocked", async () => {
    const root = await project();
    const createReport = vi.fn().mockResolvedValue(reportResult("blocked"));

    const decision = await runAgentGate(root, {
      createReport,
      input: { hook_event_name: "Stop", session_id: "session-a" },
      now: NOW,
    });

    expect(decision.blocked).toBe(true);
    expect(decision.exitCode).toBe(2);
    expect(decision.reason).toContain("usage-quota#QUOTA-INV-001");
    expect(decision.reason).toContain("Do not edit or re-approve the");
    expect(decision.payload).toMatchObject({
      hookSpecificOutput: { continue: true, hookEventName: "Stop" },
    });
  });

  it("lets the turn end and reports evidence when the gate passes", async () => {
    const root = await project();
    const createReport = vi.fn().mockResolvedValue(reportResult("passed"));

    const decision = await runAgentGate(root, {
      createReport,
      input: { session_id: "session-a" },
      now: NOW,
    });

    expect(decision).toMatchObject({ blocked: false, exitCode: 0, skipped: "gate-passed" });
    expect(decision.payload.systemMessage).toContain("passed");
  });

  it("stops blocking after repeated failures so the human regains control", async () => {
    const root = await project();
    const createReport = vi.fn().mockResolvedValue(reportResult("blocked"));
    const input = { session_id: "session-a" };

    for (let attempt = 0; attempt < AGENT_GATE_MAX_CONSECUTIVE_BLOCKS; attempt += 1) {
      const blocked = await runAgentGate(root, { createReport, input, now: NOW });
      expect(blocked.blocked).toBe(true);
    }
    const released = await runAgentGate(root, { createReport, input, now: NOW });

    expect(released).toMatchObject({ blocked: false, exitCode: 0, skipped: "loop-guard" });
    expect(createReport).toHaveBeenCalledTimes(AGENT_GATE_MAX_CONSECUTIVE_BLOCKS);
  });

  it("honours stop_hook_active so a re-entered hook never loops", async () => {
    const root = await project();
    const createReport = vi.fn().mockResolvedValue(reportResult("blocked"));

    const decision = await runAgentGate(root, {
      createReport,
      input: { session_id: "session-a", stop_hook_active: true },
      now: NOW,
    });

    expect(decision).toMatchObject({ blocked: false, skipped: "loop-guard" });
    expect(createReport).not.toHaveBeenCalled();
  });

  it("never blocks a turn when verification itself cannot run", async () => {
    const root = await project();
    const createReport = vi.fn().mockRejectedValue(new Error("not a Git repository."));

    const decision = await runAgentGate(root, { createReport, input: {}, now: NOW });

    expect(decision).toMatchObject({
      blocked: false,
      exitCode: 0,
      skipped: "verification-unavailable",
    });
    expect(decision.reason).toContain("not a Git repository.");
  });

  it("stays silent in a project that has not been initialized", async () => {
    const root = await project({ initialize: false });
    const createReport = vi.fn();

    const decision = await runAgentGate(root, { createReport, input: {}, now: NOW });

    expect(decision).toMatchObject({ blocked: false, payload: {}, skipped: "not-initialized" });
    expect(createReport).not.toHaveBeenCalled();
  });

  it("tolerates an empty or malformed hook payload", () => {
    expect(parseAgentHookInput("")).toEqual({});
    expect(parseAgentHookInput("not json")).toEqual({});
    expect(parseAgentHookInput('{"session_id":"abc"}')).toEqual({ session_id: "abc" });
  });
});
