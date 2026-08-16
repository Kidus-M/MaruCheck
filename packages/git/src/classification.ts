export type ChangeClassification =
  | "api-contract"
  | "authentication"
  | "authorization"
  | "background-job"
  | "billing"
  | "business-logic"
  | "configuration"
  | "database"
  | "dependency-upgrade"
  | "documentation"
  | "external-integration"
  | "migration"
  | "observability"
  | "performance-sensitive"
  | "security-sensitive"
  | "test"
  | "ui-only";

const SOURCE_EXTENSION = /\.(?:[cm]?[jt]sx?|go|java|kt|php|py|rb|rs|swift)$/u;
const UI_EXTENSION = /\.(?:css|less|sass|scss)$/u;

function has(path: string, pattern: RegExp): boolean {
  return pattern.test(path);
}

/** Classify one portable repository path using stable, auditable path rules. */
export function classifyChangedPath(path: string): ChangeClassification[] {
  const normalized = path.replaceAll("\\", "/").toLowerCase();
  const classifications = new Set<ChangeClassification>();

  if (has(normalized, /(?:^|\/)(?:docs?|documentation)(?:\/|$)|\.mdx?$/u)) {
    classifications.add("documentation");
  }
  if (has(normalized, /(?:^|\/)(?:test|tests|__tests__|e2e|specs?)(?:\/|$)|\.(?:spec|test)\./u)) {
    classifications.add("test");
  }
  if (UI_EXTENSION.test(normalized)) classifications.add("ui-only");
  if (
    has(normalized, /(?:^|\/)(?:components?|ui|styles?)(?:\/|$)/u) ||
    has(normalized, /(?:^|\/)app\/(?:[^/]+\/)*page\.[jt]sx$/u)
  ) {
    classifications.add("ui-only");
  }
  if (has(normalized, /authn|authentication|login|logout|oauth|session|sso/u)) {
    classifications.add("authentication");
    classifications.add("security-sensitive");
  }
  if (has(normalized, /authz|authorization|permission|policy|rbac|roles?|acl/u)) {
    classifications.add("authorization");
    classifications.add("security-sensitive");
  }
  if (has(normalized, /billing|payments?|stripe|checkout|invoice|subscription/u)) {
    classifications.add("billing");
    classifications.add("security-sensitive");
  }
  if (has(normalized, /(?:^|\/)(?:migrations?|prisma\/migrations?)(?:\/|$)/u)) {
    classifications.add("migration");
    classifications.add("database");
  } else if (has(normalized, /(?:^|\/)(?:db|database|prisma|schema)(?:\/|\.)/u)) {
    classifications.add("database");
  }
  if (has(normalized, /webhooks?|integrations?|third[-_]?party|providers?|clients?|adapters?/u)) {
    classifications.add("external-integration");
  }
  if (has(normalized, /(?:^|\/)api(?:\/|$)|route\.[jt]s$|openapi|graphql|webhooks?/u)) {
    classifications.add("api-contract");
  }
  if (has(normalized, /(?:^|\/)(?:jobs?|workers?|queues?|cron|tasks?)(?:\/|\.)/u)) {
    classifications.add("background-job");
  }
  if (has(normalized, /security|crypto|encrypt|decrypt|secrets?|tokens?/u)) {
    classifications.add("security-sensitive");
  }
  if (has(normalized, /performance|benchmark|cache|memo|pagination/u)) {
    classifications.add("performance-sensitive");
  }
  if (has(normalized, /observability|telemetry|tracing|metrics?|logging|sentry/u)) {
    classifications.add("observability");
  }
  if (
    has(normalized, /(?:^|\/)(?:package(?:-lock)?\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?)$/u)
  ) {
    classifications.add("dependency-upgrade");
    classifications.add("configuration");
  } else if (
    has(normalized, /(?:^|\/)(?:\.env(?:\.|$)|[^/]*config\.[^/]+|tsconfig[^/]*\.json)$/u)
  ) {
    classifications.add("configuration");
  }

  const nonProduction =
    classifications.has("documentation") ||
    classifications.has("test") ||
    classifications.has("ui-only") ||
    classifications.has("configuration") ||
    classifications.has("dependency-upgrade");
  if (SOURCE_EXTENSION.test(normalized) && !nonProduction) {
    classifications.add("business-logic");
  }

  return [...classifications].sort();
}
