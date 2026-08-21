import { lstat, readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { defaultGitRunner, type GitRunner } from "@maru/git";
import type { VerificationReport } from "@maru/evidence";

const INGEST_PATH = "/api/v1/ingest/runs";
const MAX_REPORT_BYTES = 1_900_000;

export type HostedUploadErrorCode =
  | "HOSTED_AUTH_REQUIRED"
  | "HOSTED_GIT_METADATA_FAILED"
  | "HOSTED_REPORT_INVALID"
  | "HOSTED_REPORT_UNREADABLE"
  | "HOSTED_REQUEST_FAILED"
  | "HOSTED_URL_INVALID";

export class HostedUploadError extends Error {
  public readonly code: HostedUploadErrorCode;
  public readonly remediation: string;

  public constructor(
    code: HostedUploadErrorCode,
    message: string,
    remediation: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "HostedUploadError";
    this.code = code;
    this.remediation = remediation;
  }
}

export interface HostedUploadResult {
  readonly dashboardURL: string;
  readonly endpoint: string;
  readonly runId: string;
}

export interface HostedUploadOptions {
  readonly baseURL?: string;
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly fetcher?: typeof globalThis.fetch;
  readonly gitRunner?: GitRunner;
  readonly reportPath: string;
}

interface ReportIdentity {
  readonly generatedAt: string;
  readonly projectName: string;
  readonly report: VerificationReport;
  readonly runId: string;
}

/** Explicitly upload one completed verification report without sending repository source. */
export async function uploadVerificationReport(
  root: string,
  options: HostedUploadOptions,
): Promise<HostedUploadResult> {
  const environment = options.environment ?? process.env;
  const token = environment.MARUCHECK_TOKEN?.trim();
  if (!token || !token.startsWith("maru_") || token.length > 128) {
    throw new HostedUploadError(
      "HOSTED_AUTH_REQUIRED",
      "A valid project token is required for hosted report upload.",
      "Set MARUCHECK_TOKEN to the one-time token shown when the dashboard project was connected.",
    );
  }

  const baseURL = hostedBaseURL(options.baseURL ?? environment.MARUCHECK_URL);
  const report = await readReport(root, options.reportPath);
  const metadata = await gitMetadata(root, options.gitRunner ?? defaultGitRunner);
  const envelope = {
    schemaVersion: 1,
    branch: metadata.branch,
    commitSha: metadata.commitSha,
    title: metadata.title,
    startedAt: report.generatedAt,
    completedAt: report.generatedAt,
    report: report.report,
  } as const;
  const body = JSON.stringify(envelope);
  if (Buffer.byteLength(body, "utf8") > 2_000_000) {
    throw new HostedUploadError(
      "HOSTED_REPORT_INVALID",
      "The hosted ingestion envelope exceeds the 2 MB limit.",
      "Reduce diagnostic or artifact-reference volume, regenerate the report, and retry.",
    );
  }

  const endpoint = new URL(INGEST_PATH, baseURL).toString();
  let response: Response;
  try {
    response = await (options.fetcher ?? globalThis.fetch)(endpoint, {
      body,
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      method: "POST",
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    throw new HostedUploadError(
      "HOSTED_REQUEST_FAILED",
      "The MaruCheck host could not be reached.",
      "Check MARUCHECK_URL and network access, then retry the same report.",
      { cause: error },
    );
  }

  if (response.status !== 202) {
    const detail = await safeResponseDetail(response);
    throw new HostedUploadError(
      "HOSTED_REQUEST_FAILED",
      `The MaruCheck host rejected the report (${response.status})${detail ? `: ${detail}` : "."}`,
      response.status === 401
        ? "Rotate or recopy the project token, update MARUCHECK_TOKEN, and retry."
        : "Confirm the connected project name matches report.project.name, then retry.",
    );
  }

  return {
    dashboardURL: new URL("/projects", baseURL).toString(),
    endpoint,
    runId: report.runId,
  };
}

function hostedBaseURL(value: string | undefined): URL {
  let url: URL;
  try {
    url = new URL(value ?? "");
  } catch {
    throw invalidHostedURL();
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (
    (url.protocol !== "https:" && !(local && url.protocol === "http:")) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw invalidHostedURL();
  }
  return new URL(url.origin);
}

function invalidHostedURL(): HostedUploadError {
  return new HostedUploadError(
    "HOSTED_URL_INVALID",
    "A valid MaruCheck host URL is required.",
    "Pass --url https://your-marucheck-host or set MARUCHECK_URL. HTTP is allowed only for localhost.",
  );
}

async function readReport(root: string, relativePath: string): Promise<ReportIdentity> {
  const absoluteRoot = resolve(root);
  const target = resolve(absoluteRoot, relativePath);
  if (target === absoluteRoot || !target.startsWith(`${absoluteRoot}${sep}`)) {
    throw new HostedUploadError(
      "HOSTED_REPORT_UNREADABLE",
      "The report path must stay inside the project root.",
      "Pass the report.json path printed by maru verify --diff.",
    );
  }

  try {
    const stats = await lstat(target);
    if (!stats.isFile() || stats.isSymbolicLink() || stats.size > MAX_REPORT_BYTES) {
      throw new HostedUploadError(
        "HOSTED_REPORT_UNREADABLE",
        "The report must be a regular, non-symlink file smaller than 1.9 MB.",
        "Pass the report.json path printed by maru verify --diff.",
      );
    }
    const parsed = JSON.parse(await readFile(target, "utf8")) as unknown;
    return reportIdentity(parsed);
  } catch (error) {
    if (error instanceof HostedUploadError) throw error;
    throw new HostedUploadError(
      "HOSTED_REPORT_UNREADABLE",
      "The verification report could not be read.",
      "Pass a valid report.json path inside this project.",
      { cause: error },
    );
  }
}

function reportIdentity(value: unknown): ReportIdentity {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalidReport();
  const report = value as Record<string, unknown>;
  const project = report.project;
  if (!project || typeof project !== "object" || Array.isArray(project)) throw invalidReport();
  const projectName = (project as Record<string, unknown>).name;
  if (
    report.schemaVersion !== 1 ||
    typeof report.generatedAt !== "string" ||
    Number.isNaN(Date.parse(report.generatedAt)) ||
    typeof report.runId !== "string" ||
    !report.runId.trim() ||
    typeof projectName !== "string" ||
    !projectName.trim()
  ) {
    throw invalidReport();
  }
  return {
    generatedAt: report.generatedAt,
    projectName,
    report: value as VerificationReport,
    runId: report.runId,
  };
}

function invalidReport(): HostedUploadError {
  return new HostedUploadError(
    "HOSTED_REPORT_INVALID",
    "The file is not a MaruCheck verification report with schemaVersion 1.",
    "Generate a fresh report with maru verify --diff and pass that report.json file.",
  );
}

async function gitMetadata(root: string, runner: GitRunner) {
  try {
    const [branch, commitSha, title] = await Promise.all([
      runner.run(["rev-parse", "--abbrev-ref", "HEAD"], root),
      runner.run(["rev-parse", "HEAD"], root),
      runner.run(["log", "-1", "--pretty=%s"], root),
    ]);
    const normalized = {
      branch: branch.trim().slice(0, 200),
      commitSha: commitSha.trim().slice(0, 100),
      title: title.trim().slice(0, 300),
    };
    if (!normalized.branch || !normalized.commitSha || !normalized.title) throw new Error();
    return normalized;
  } catch (error) {
    throw new HostedUploadError(
      "HOSTED_GIT_METADATA_FAILED",
      "Git metadata for the verification run could not be read.",
      "Commit the change in a readable Git repository, then retry the upload.",
      { cause: error },
    );
  }
}

async function safeResponseDetail(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as unknown;
    if (!body || typeof body !== "object" || Array.isArray(body)) return "";
    const detail = (body as Record<string, unknown>).detail;
    return typeof detail === "string" ? detail.replaceAll(/\s+/gu, " ").slice(0, 500) : "";
  } catch {
    return "";
  }
}
