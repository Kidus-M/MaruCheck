import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { listPathHistory, type GitRunner } from "@maru/git";
import type {
  MemoryPathCommit,
  MemoryRelevance,
  MemoryRelevanceContext,
  MemoryRelevanceContract,
  MemoryRelevanceLevel,
  MemoryRelevanceSignal,
  QAMemoryRecord,
} from "./model.js";

/** Penalties are subtracted from a fully relevant score of 100; confirmations contribute 0. */
export const MEMORY_RELEVANCE_PENALTIES = {
  age: { overOneYear: 10, overSixMonths: 5 },
  regressionTestsChanged: { rewritten: 20, touched: 10 },
  regressionTestsMissing: 30,
  relatedContractsInactive: 25,
  relatedFilesMissing: 35,
  superseded: 70,
} as const;

const HIGH_THRESHOLD = 70;
const MEDIUM_THRESHOLD = 40;
const REWRITTEN_COMMITS = 3;
const DAY = 86_400_000;
const LISTED_PATHS = 5;

function list(items: readonly string[]): string {
  const shown = items.slice(0, LISTED_PATHS).join(", ");
  return items.length > LISTED_PATHS ? `${shown}, and ${items.length - LISTED_PATHS} more` : shown;
}

function noun(count: number, singular: string, pluralForm = `${singular}s`): string {
  return count === 1 ? singular : pluralForm;
}

function counted(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${noun(count, singular, pluralForm)}`;
}

function share(penalty: number, affected: number, total: number): number {
  return -Math.round((penalty * affected) / total);
}

/** Map every record to the active records that declare they supersede it. */
export function supersededBy(records: readonly QAMemoryRecord[]): ReadonlyMap<string, string[]> {
  const result = new Map<string, string[]>();
  for (const record of records) {
    for (const older of record.supersedes) {
      if (older === record.id) continue;
      result.set(older, [...(result.get(older) ?? []), record.id].sort());
    }
  }
  return result;
}

export function memoryRelevanceLevel(score: number): MemoryRelevanceLevel {
  if (score >= HIGH_THRESHOLD) return "high";
  if (score >= MEDIUM_THRESHOLD) return "medium";
  return "low";
}

function relatedFilesSignal(
  record: QAMemoryRecord,
  existingPaths: ReadonlySet<string>,
): MemoryRelevanceSignal | undefined {
  const total = record.relatedFiles.length;
  if (total === 0) return undefined;
  const missing = record.relatedFiles.filter((path) => !existingPaths.has(path)).sort();
  if (missing.length === 0) {
    return {
      code: "related-files-present",
      message: `${total === 1 ? "The originally affected file still exists" : `All ${total} originally affected files still exist`}: ${list([...record.relatedFiles].sort())}.`,
      paths: [...record.relatedFiles].sort(),
      points: 0,
    };
  }
  return {
    code: "related-files-present",
    message:
      missing.length === total
        ? `${total === 1 ? "The originally affected file no longer exists" : `None of the ${total} originally affected files still exist`}: ${list(missing)}.`
        : `${missing.length} of ${total} originally affected files no longer exist: ${list(missing)}.`,
    paths: missing,
    points: share(MEMORY_RELEVANCE_PENALTIES.relatedFilesMissing, missing.length, total),
  };
}

function regressionTestsSignal(
  record: QAMemoryRecord,
  existingPaths: ReadonlySet<string>,
): MemoryRelevanceSignal | undefined {
  const paths = [...new Set(record.regressionTests.map((test) => test.path))].sort();
  if (paths.length === 0) return undefined;
  const missing = paths.filter((path) => !existingPaths.has(path));
  if (missing.length === 0) {
    return {
      code: "regression-tests-present",
      message: `Recorded regression ${noun(paths.length, "test")} still ${paths.length === 1 ? "exists" : "exist"}: ${list(paths)}.`,
      paths,
      points: 0,
    };
  }
  return {
    code: "regression-tests-present",
    message: `Recorded regression ${noun(missing.length, "test")} no longer ${missing.length === 1 ? "exists" : "exist"}: ${list(missing)}.`,
    paths: missing,
    points: share(MEMORY_RELEVANCE_PENALTIES.regressionTestsMissing, missing.length, paths.length),
  };
}

function relatedContractsSignal(
  record: QAMemoryRecord,
  contracts: readonly MemoryRelevanceContract[],
): MemoryRelevanceSignal | undefined {
  const total = record.relatedContracts.length;
  if (total === 0) return undefined;
  const statuses = new Map(contracts.map((contract) => [contract.id, contract.status]));
  const sorted = [...record.relatedContracts].sort();
  const missing = sorted.filter((id) => !statuses.has(id));
  const deprecated = sorted.filter((id) => statuses.get(id) === "deprecated");
  const inactive = missing.length + deprecated.length;
  if (inactive === 0) {
    return {
      code: "related-contracts-active",
      message: `Related Quality ${noun(total, "Contract")} ${total === 1 ? "remains" : "remain"} active: ${list(sorted.map((id) => `${id} (${statuses.get(id)})`))}.`,
      points: 0,
    };
  }
  const details = [
    ...(missing.length === 0
      ? []
      : [`no longer ${missing.length === 1 ? "exists" : "exist"}: ${list(missing)}`]),
    ...(deprecated.length === 0
      ? []
      : [`${deprecated.length === 1 ? "is" : "are"} deprecated: ${list(deprecated)}`]),
  ];
  return {
    code: "related-contracts-active",
    message: `Related Quality ${noun(inactive, "Contract")} ${details.join("; ")}.`,
    points: share(MEMORY_RELEVANCE_PENALTIES.relatedContractsInactive, inactive, total),
  };
}

function regressionTestsChangedSignal(
  record: QAMemoryRecord,
  history: readonly MemoryPathCommit[],
  existingPaths: ReadonlySet<string> | undefined,
): MemoryRelevanceSignal | undefined {
  const paths = [...new Set(record.regressionTests.map((test) => test.path))]
    .filter((path) => existingPaths === undefined || existingPaths.has(path))
    .sort();
  if (paths.length === 0) return undefined;
  const commits = new Map(paths.map((path) => [path, 0]));
  for (const commit of history) {
    if (commit.committedAt <= record.createdAt) continue;
    for (const path of commit.paths) {
      const count = commits.get(path);
      if (count !== undefined) commits.set(path, count + 1);
    }
  }
  const changed = [...commits].filter(([, count]) => count > 0);
  if (changed.length === 0) {
    return {
      code: "regression-tests-changed",
      message: `Recorded regression ${noun(paths.length, "test")} ${paths.length === 1 ? "is" : "are"} unchanged since the record was created.`,
      paths,
      points: 0,
    };
  }
  const most = Math.max(...changed.map(([, count]) => count));
  const rewritten = most >= REWRITTEN_COMMITS;
  return {
    code: "regression-tests-changed",
    message: `Recorded regression ${noun(changed.length, "test")} changed${rewritten ? " significantly" : ""} since the record was created (${counted(most, "commit")}): ${list(changed.map(([path]) => path))}.`,
    paths: changed.map(([path]) => path),
    points: rewritten
      ? -MEMORY_RELEVANCE_PENALTIES.regressionTestsChanged.rewritten
      : -MEMORY_RELEVANCE_PENALTIES.regressionTestsChanged.touched,
  };
}

function ageSignal(record: QAMemoryRecord, now: string): MemoryRelevanceSignal | undefined {
  const days = Math.floor((Date.parse(now) - Date.parse(record.createdAt)) / DAY);
  if (!Number.isFinite(days) || days < 180) return undefined;
  return {
    code: "age",
    message: `Record is ${counted(days, "day")} old.`,
    points:
      days >= 365
        ? -MEMORY_RELEVANCE_PENALTIES.age.overOneYear
        : -MEMORY_RELEVANCE_PENALTIES.age.overSixMonths,
  };
}

function currentChangeSignal(match: {
  readonly exactFileMatches: readonly string[];
  readonly matchedTerms: readonly string[];
}): MemoryRelevanceSignal | undefined {
  if (match.exactFileMatches.length > 0) {
    return {
      code: "current-change",
      message: `Current change modifies ${match.exactFileMatches.length === 1 ? "an originally affected file" : `${match.exactFileMatches.length} originally affected files`}: ${list(match.exactFileMatches)}.`,
      paths: match.exactFileMatches,
      points: 0,
    };
  }
  if (match.matchedTerms.length > 0) {
    return {
      code: "current-change",
      message: `Current change matches by shared vocabulary only: ${match.matchedTerms.join(", ")}.`,
      points: 0,
    };
  }
  return undefined;
}

/**
 * Judge how much one historical record should still influence verification.
 * A record stays fully relevant until project evidence shows its failure context changed;
 * every signal without evidence is skipped rather than guessed.
 */
export function assessMemoryRelevance(
  record: QAMemoryRecord,
  records: readonly QAMemoryRecord[],
  context: MemoryRelevanceContext = {},
  match: { readonly exactFileMatches: readonly string[]; readonly matchedTerms: readonly string[] } = {
    exactFileMatches: [],
    matchedTerms: [],
  },
): MemoryRelevance {
  const newer = supersededBy(records).get(record.id) ?? [];
  const signals = [
    currentChangeSignal(match),
    newer.length === 0
      ? undefined
      : {
          code: "superseded" as const,
          message: `Superseded by newer QA ${noun(newer.length, "memory", "memories")}: ${newer.join(", ")}.`,
          points: -MEMORY_RELEVANCE_PENALTIES.superseded,
        },
    context.existingPaths === undefined
      ? undefined
      : relatedFilesSignal(record, context.existingPaths),
    context.contracts === undefined
      ? undefined
      : relatedContractsSignal(record, context.contracts),
    context.existingPaths === undefined
      ? undefined
      : regressionTestsSignal(record, context.existingPaths),
    context.history === undefined
      ? undefined
      : regressionTestsChangedSignal(record, context.history, context.existingPaths),
    context.now === undefined ? undefined : ageSignal(record, context.now),
  ].filter((signal): signal is MemoryRelevanceSignal => signal !== undefined);
  const score = Math.max(
    0,
    Math.min(100, 100 + signals.reduce((total, signal) => total + signal.points, 0)),
  );
  return { level: memoryRelevanceLevel(score), score, signals, supersededBy: newer };
}

/** Collect the local evidence relevance needs: which recorded paths exist and how tests changed. */
export async function buildMemoryRelevanceContext(
  root: string,
  records: readonly QAMemoryRecord[],
  options: { readonly now?: Date; readonly runner?: GitRunner } = {},
): Promise<MemoryRelevanceContext> {
  const testPaths = [
    ...new Set(records.flatMap((record) => record.regressionTests.map((test) => test.path))),
  ].sort();
  const paths = [
    ...new Set([...testPaths, ...records.flatMap((record) => record.relatedFiles)]),
  ].sort();
  const existing = await Promise.all(
    paths.map(async (path) => {
      try {
        await access(resolve(root, path));
        return path;
      } catch {
        return undefined;
      }
    }),
  );
  const since = [...records.map((record) => record.createdAt)].sort()[0];
  const history =
    since === undefined || testPaths.length === 0
      ? []
      : await listPathHistory(root, testPaths, since, options.runner);
  return {
    existingPaths: new Set(existing.filter((path): path is string => path !== undefined)),
    history,
    now: (options.now ?? new Date()).toISOString(),
  };
}
