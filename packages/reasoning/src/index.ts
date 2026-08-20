export const REASONING_REQUEST_SCHEMA_VERSION = 1;
export const MAX_REASONING_RESPONSE_BYTES = 1_000_000;

export type ReasoningTask = "challenger-analysis";
export type JsonSchema = Readonly<Record<string, unknown>>;

export interface ReasoningRequest {
  readonly input: Readonly<Record<string, unknown>>;
  readonly instructions: string;
  readonly maxCostUsd: number;
  readonly maxOutputTokens: number;
  readonly outputSchema: JsonSchema;
  readonly requestId: string;
  readonly schemaVersion: 1;
  readonly task: ReasoningTask;
}

export interface ReasoningUsage {
  readonly durationMs: number;
  readonly estimatedCostUsd: number | null;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly totalTokens: number | null;
}

export interface ReasoningResponse {
  readonly output: unknown;
  readonly provider: {
    readonly id: string;
    readonly model: string;
  };
  readonly requestId: string;
  readonly usage: ReasoningUsage;
}

export interface ReasoningProvider {
  readonly id: string;
  readonly model: string;
  readonly reason: (request: ReasoningRequest) => Promise<ReasoningResponse>;
}

export type ReasoningErrorCode =
  | "REASONING_CONFIG_INVALID"
  | "REASONING_PROVIDER_FAILED";

export class ReasoningError extends Error {
  public constructor(
    public readonly code: ReasoningErrorCode,
    message: string,
    public readonly remediation: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ReasoningError";
  }
}

export interface JsonHttpReasoningProviderOptions {
  readonly apiKey?: string;
  readonly endpoint: string;
  readonly fetch?: typeof globalThis.fetch;
  readonly model: string;
  readonly providerId: string;
  readonly timeoutMs?: number;
}

type Environment = Readonly<Record<string, string | undefined>>;

function configured(value: string | undefined): string | undefined {
  const result = value?.trim();
  return result === undefined || result.length === 0 ? undefined : result;
}

function positiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function nonNegativeNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function endpointUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch (error) {
    throw new ReasoningError(
      "REASONING_CONFIG_INVALID",
      "MARU_REASONING_URL must be a valid absolute URL.",
      "Use HTTPS for a remote gateway or HTTP only for a loopback gateway.",
      { cause: error },
    );
  }
  const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  if ((url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) || url.username || url.password) {
    throw new ReasoningError(
      "REASONING_CONFIG_INVALID",
      "The reasoning endpoint must use HTTPS, except for HTTP loopback development endpoints, and must not contain credentials.",
      "Move credentials to MARU_REASONING_API_KEY and use a secure endpoint URL.",
    );
  }
  return url;
}

function requiredName(value: string, field: string): string {
  const result = value.trim();
  if (result.length === 0 || result.length > 200) {
    throw new ReasoningError(
      "REASONING_CONFIG_INVALID",
      `${field} must contain 1 to 200 characters.`,
      `Set ${field} to the configured provider or model identifier.`,
    );
  }
  return result;
}

function responsePayload(value: unknown): {
  readonly output: unknown;
  readonly usage: {
    readonly estimatedCostUsd: number | null;
    readonly inputTokens: number | null;
    readonly outputTokens: number | null;
  };
} {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Response must be an object.");
  }
  const record = value as Record<string, unknown>;
  if (!("output" in record)) throw new Error("Response output is required.");
  if (typeof record.usage !== "object" || record.usage === null || Array.isArray(record.usage)) {
    throw new Error("Response usage is required.");
  }
  const usage = record.usage as Record<string, unknown>;
  const inputTokens = positiveInteger(usage.inputTokens);
  const outputTokens = positiveInteger(usage.outputTokens);
  const estimatedCostUsd = nonNegativeNumber(usage.estimatedCostUsd);
  if (
    (usage.inputTokens !== null && usage.inputTokens !== undefined && inputTokens === null) ||
    (usage.outputTokens !== null && usage.outputTokens !== undefined && outputTokens === null) ||
    (usage.estimatedCostUsd !== null &&
      usage.estimatedCostUsd !== undefined &&
      estimatedCostUsd === null)
  ) {
    throw new Error("Response usage values must be non-negative numbers.");
  }
  return { output: record.output, usage: { estimatedCostUsd, inputTokens, outputTokens } };
}

async function boundedResponseText(response: Response): Promise<string> {
  if (response.body === null) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const item = await reader.read();
    if (item.done) break;
    length += item.value.byteLength;
    if (length > MAX_REASONING_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error("Provider response exceeded the maximum size.");
    }
    chunks.push(item.value);
  }
  return Buffer.concat(chunks, length).toString("utf8");
}

function validateRequest(request: ReasoningRequest): void {
  if (
    request.schemaVersion !== REASONING_REQUEST_SCHEMA_VERSION ||
    request.task !== "challenger-analysis" ||
    request.requestId.length < 1 ||
    request.requestId.length > 200 ||
    request.instructions.length < 1 ||
    request.instructions.length > 20_000 ||
    !Number.isFinite(request.maxCostUsd) ||
    request.maxCostUsd < 0 ||
    request.maxCostUsd > 100 ||
    !Number.isSafeInteger(request.maxOutputTokens) ||
    request.maxOutputTokens < 100 ||
    request.maxOutputTokens > 10_000
  ) {
    throw new ReasoningError(
      "REASONING_CONFIG_INVALID",
      "The structured reasoning request violates its safety bounds.",
      "Use the versioned request schema and bounded cost, instructions, identifiers, and output tokens.",
    );
  }
  if (Buffer.byteLength(JSON.stringify(request), "utf8") > MAX_REASONING_RESPONSE_BYTES) {
    throw new ReasoningError(
      "REASONING_CONFIG_INVALID",
      "The structured reasoning request exceeds the maximum size.",
      "Reduce the bounded reasoning context before calling the provider.",
    );
  }
}

/** Create a provider for the small vendor-neutral MaruCheck JSON reasoning protocol. */
export function createJsonHttpReasoningProvider(
  options: JsonHttpReasoningProviderOptions,
): ReasoningProvider {
  const endpoint = endpointUrl(options.endpoint).toString();
  const id = requiredName(options.providerId, "MARU_REASONING_PROVIDER");
  const model = requiredName(options.model, "MARU_REASONING_MODEL");
  const fetchImplementation = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? 30_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 120_000) {
    throw new ReasoningError(
      "REASONING_CONFIG_INVALID",
      "Reasoning timeout must be between 1000 and 120000 milliseconds.",
      "Use a bounded provider timeout.",
    );
  }

  return {
    id,
    model,
    async reason(request) {
      validateRequest(request);
      const startedAt = Date.now();
      try {
        const response = await fetchImplementation(endpoint, {
          body: JSON.stringify({ ...request, model }),
          headers: {
            ...(configured(options.apiKey) === undefined
              ? {}
              : { authorization: `Bearer ${configured(options.apiKey)}` }),
            "content-type": "application/json",
          },
          method: "POST",
          redirect: "error",
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!response.ok) throw new Error(`Provider returned HTTP ${response.status}.`);
        const body = await boundedResponseText(response);
        const parsed = responsePayload(JSON.parse(body) as unknown);
        const totalTokens =
          parsed.usage.inputTokens === null || parsed.usage.outputTokens === null
            ? null
            : parsed.usage.inputTokens + parsed.usage.outputTokens;
        return {
          output: parsed.output,
          provider: { id, model },
          requestId: request.requestId,
          usage: {
            durationMs: Math.max(0, Date.now() - startedAt),
            estimatedCostUsd: parsed.usage.estimatedCostUsd,
            inputTokens: parsed.usage.inputTokens,
            outputTokens: parsed.usage.outputTokens,
            totalTokens,
          },
        };
      } catch (error) {
        if (error instanceof ReasoningError) throw error;
        throw new ReasoningError(
          "REASONING_PROVIDER_FAILED",
          `Reasoning provider ${id} could not return a valid bounded response.`,
          "Check the configured gateway, model, credentials, timeout, and JSON protocol response.",
          { cause: error },
        );
      }
    },
  };
}

/** Load a live provider only from explicit environment configuration. */
export function reasoningProviderFromEnvironment(
  environment: Environment = process.env,
  fetchImplementation: typeof globalThis.fetch = globalThis.fetch,
): ReasoningProvider | undefined {
  const endpoint = configured(environment.MARU_REASONING_URL);
  const model = configured(environment.MARU_REASONING_MODEL);
  const providerId = configured(environment.MARU_REASONING_PROVIDER);
  const present = [endpoint, model, providerId].filter((value) => value !== undefined).length;
  if (present === 0) return undefined;
  if (endpoint === undefined || model === undefined || providerId === undefined) {
    throw new ReasoningError(
      "REASONING_CONFIG_INVALID",
      "Reasoning configuration is incomplete.",
      "Set MARU_REASONING_URL, MARU_REASONING_MODEL, and MARU_REASONING_PROVIDER together.",
    );
  }
  return createJsonHttpReasoningProvider({
    apiKey: configured(environment.MARU_REASONING_API_KEY),
    endpoint,
    fetch: fetchImplementation,
    model,
    providerId,
  });
}
