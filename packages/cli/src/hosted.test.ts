import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HostedUploadError, uploadVerificationReport } from "./hosted.js";

describe("hosted report upload", () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      temporaryDirectories.splice(0).map((path) => rm(path, { force: true, recursive: true })),
    );
  });

  async function fixture(): Promise<{ reportPath: string; root: string }> {
    const root = await mkdtemp(join(tmpdir(), "maru-hosted-"));
    temporaryDirectories.push(root);
    const directory = join(root, ".maru", "artifacts", "runs", "RUN-1048");
    await mkdir(directory, { recursive: true });
    const reportPath = ".maru/artifacts/runs/RUN-1048/report.json";
    await writeFile(
      join(root, reportPath),
      JSON.stringify({
        artifacts: { plan: "plan.json", report: reportPath, run: "run.json" },
        evidence: [],
        findings: [],
        gate: { reasons: [], status: "passed" },
        generatedAt: "2026-08-21T10:01:42.000Z",
        project: { name: "maru-web" },
        requirementEvidence: [],
        risk: { level: "low", score: 12 },
        runId: "RUN-1048",
        runStatus: "passed",
        schemaVersion: 1,
        summary: {
          blockingFindings: 0,
          evidence: 0,
          failedEvidence: 0,
          findings: 0,
          inconclusiveEvidence: 0,
          passedEvidence: 0,
          requirementsFailed: 0,
          requirementsInconclusive: 0,
          requirementsPassed: 0,
          requirementsUnverified: 0,
        },
      }),
    );
    return { reportPath, root };
  }

  const gitRunner = {
    run: vi.fn(async (args: readonly string[]) => {
      if (args.includes("--abbrev-ref")) return "main\n";
      if (args.includes("--pretty=%s")) return "fix: enforce invoice ownership\n";
      return "8f2c1a7d5e3b\n";
    }),
  };

  it("uploads a versioned envelope with Git metadata and no token in the body", async () => {
    const { reportPath, root } = await fixture();
    const fetcher = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(JSON.stringify({ accepted: true, runId: "RUN-1048", schemaVersion: 1 }), {
        status: 202,
      }),
    );

    const result = await uploadVerificationReport(root, {
      baseURL: "https://app.marucheck.dev",
      environment: { MARUCHECK_TOKEN: "maru_test_token" },
      fetcher,
      gitRunner,
      reportPath,
    });

    expect(result).toEqual({
      dashboardURL: "https://app.marucheck.dev/projects",
      endpoint: "https://app.marucheck.dev/api/v1/ingest/runs",
      reportPath,
      runId: "RUN-1048",
    });
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, request] = fetcher.mock.calls[0]!;
    expect(url).toBe("https://app.marucheck.dev/api/v1/ingest/runs");
    expect(request?.headers).toEqual({
      authorization: "Bearer maru_test_token",
      "content-type": "application/json",
    });
    expect(request?.body).not.toContain("maru_test_token");
    expect(JSON.parse(String(request?.body))).toMatchObject({
      branch: "main",
      commitSha: "8f2c1a7d5e3b",
      report: { project: { name: "maru-web" }, runId: "RUN-1048" },
      schemaVersion: 1,
      title: "fix: enforce invoice ownership",
    });
  });

  it("loads an ignored connection file and uploads the newest valid report by default", async () => {
    const { reportPath, root } = await fixture();
    await writeFile(
      join(root, ".maru", "connection.env"),
      [
        "MARUCHECK_TOKEN=maru_connection_token",
        'MARUCHECK_URL="https://app.marucheck.dev"',
        "UNRELATED_SECRET=must-not-be-loaded",
      ].join("\n"),
    );
    const newerDirectory = join(root, ".maru", "artifacts", "runs", "RUN-2048");
    await mkdir(newerDirectory, { recursive: true });
    const newerPath = ".maru/artifacts/runs/RUN-2048/report.json";
    const newerReport = JSON.parse(await readFile(join(root, reportPath), "utf8")) as Record<
      string,
      unknown
    >;
    newerReport.generatedAt = "2026-08-21T11:01:42.000Z";
    newerReport.runId = "RUN-2048";
    await writeFile(join(root, newerPath), JSON.stringify(newerReport));
    const fetcher = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ accepted: true, runId: "RUN-2048" }), { status: 202 }),
      );

    const result = await uploadVerificationReport(root, { fetcher, gitRunner });

    expect(result.reportPath).toBe(newerPath);
    expect(result.runId).toBe("RUN-2048");
    expect(fetcher).toHaveBeenCalledWith(
      "https://app.marucheck.dev/api/v1/ingest/runs",
      expect.objectContaining({
        headers: {
          authorization: "Bearer maru_connection_token",
          "content-type": "application/json",
        },
      }),
    );
  });

  it("requires the token and a secure host before making a request", async () => {
    const { reportPath, root } = await fixture();
    const fetcher = vi.fn<typeof globalThis.fetch>();

    await expect(
      uploadVerificationReport(root, {
        baseURL: "https://app.marucheck.dev",
        environment: {},
        fetcher,
        gitRunner,
        reportPath,
      }),
    ).rejects.toMatchObject({ code: "HOSTED_AUTH_REQUIRED" });
    await expect(
      uploadVerificationReport(root, {
        baseURL: "http://app.marucheck.dev",
        environment: { MARUCHECK_TOKEN: "maru_test_token" },
        fetcher,
        gitRunner,
        reportPath,
      }),
    ).rejects.toMatchObject({ code: "HOSTED_URL_INVALID" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("does not load credentials from a connection file that Git does not ignore", async () => {
    const { reportPath, root } = await fixture();
    await writeFile(
      join(root, ".maru", "connection.env"),
      "MARUCHECK_TOKEN=maru_exposed\nMARUCHECK_URL=https://app.marucheck.dev\n",
    );

    await expect(
      uploadVerificationReport(root, {
        environment: {},
        gitRunner: { run: vi.fn().mockRejectedValue(new Error("not ignored")) },
        reportPath,
      }),
    ).rejects.toMatchObject({ code: "HOSTED_AUTH_REQUIRED" });
  });

  it("explains how to create a report when no completed run exists", async () => {
    const root = await mkdtemp(join(tmpdir(), "maru-hosted-empty-"));
    temporaryDirectories.push(root);

    await expect(
      uploadVerificationReport(root, {
        baseURL: "https://app.marucheck.dev",
        environment: { MARUCHECK_TOKEN: "maru_test_token" },
        gitRunner,
      }),
    ).rejects.toMatchObject({ code: "HOSTED_REPORT_NOT_FOUND" });
  });

  it("rejects report paths that escape the project root", async () => {
    const { root } = await fixture();
    const options = {
      baseURL: "https://app.marucheck.dev",
      environment: { MARUCHECK_TOKEN: "maru_test_token" },
      gitRunner,
    };

    await expect(
      uploadVerificationReport(root, { ...options, reportPath: "../outside.json" }),
    ).rejects.toMatchObject({ code: "HOSTED_REPORT_UNREADABLE" });
  });

  it.skipIf(process.platform === "win32")("rejects symlink report files", async () => {
    const { reportPath, root } = await fixture();
    const linked = join(root, ".maru", "linked-report.json");
    await symlink(join(root, reportPath), linked);

    await expect(
      uploadVerificationReport(root, {
        baseURL: "https://app.marucheck.dev",
        environment: { MARUCHECK_TOKEN: "maru_test_token" },
        gitRunner,
        reportPath: ".maru/linked-report.json",
      }),
    ).rejects.toMatchObject({ code: "HOSTED_REPORT_UNREADABLE" });
  });

  it("reports bounded host errors without exposing the bearer token", async () => {
    const { reportPath, root } = await fixture();
    const token = "maru_private_value";
    let rejection: HostedUploadError | undefined;
    try {
      await uploadVerificationReport(root, {
        baseURL: "https://app.marucheck.dev",
        environment: { MARUCHECK_TOKEN: token },
        fetcher: vi.fn<typeof globalThis.fetch>().mockResolvedValue(
          new Response(JSON.stringify({ detail: "The project name does not match." }), {
            status: 409,
          }),
        ),
        gitRunner,
        reportPath,
      });
    } catch (error) {
      rejection = error as HostedUploadError;
    }

    expect(rejection).toMatchObject({ code: "HOSTED_REQUEST_FAILED" });
    expect(rejection?.message).toContain("409");
    expect(rejection?.message).toContain("project name does not match");
    expect(rejection?.message).not.toContain(token);
  });
});
