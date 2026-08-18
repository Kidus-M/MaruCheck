import type { GitDiffAnalysis } from "@maru/git";
import type {
  HistoricalRiskMatch,
  MemorySearchMatch,
  QAMemoryRecord,
} from "./model.js";
import { MemoryError } from "./model.js";
import { listMemoryRecords } from "./repository.js";

const STOP_WORDS = new Set([
  "access",
  "account",
  "active",
  "another",
  "change",
  "could",
  "file",
  "historical",
  "later",
  "manual",
  "missing",
  "record",
  "regression",
  "services",
  "tests",
  "users",
  "with",
]);

function stem(term: string): string {
  return term.length > 4 && term.endsWith("s") ? term.slice(0, -1) : term;
}

function terms(text: string): Set<string> {
  const separated = text.replace(/([a-z0-9])([A-Z])/gu, "$1 $2").toLowerCase();
  return new Set(
    separated
      .split(/[^a-z0-9]+/u)
      .map(stem)
      .filter((term) => term.length >= 4 && !STOP_WORDS.has(term)),
  );
}

function intersection(left: Set<string>, right: Set<string>): string[] {
  return [...left].filter((term) => right.has(term)).sort();
}

function searchableFields(record: QAMemoryRecord): Record<string, string> {
  return {
    id: record.id,
    regressionTests: record.regressionTests.map((test) => `${test.id} ${test.path}`).join(" "),
    relatedContracts: record.relatedContracts.join(" "),
    relatedFiles: record.relatedFiles.join(" "),
    rootCause: record.rootCause,
    summary: record.summary,
    tags: record.tags.join(" "),
    title: record.title,
    type: record.type,
  };
}

/** Search active memory with deterministic field and term scoring. */
export function searchMemory(
  records: readonly QAMemoryRecord[],
  query: string,
): MemorySearchMatch[] {
  const queryTerms = terms(query);
  if (query.trim().length === 0 || queryTerms.size === 0) {
    throw new MemoryError(
      "MEMORY_INVALID",
      "A meaningful memory search query is required.",
      "Search for a bug ID, contract, path, root cause, or tag.",
    );
  }
  return records
    .map((record): MemorySearchMatch | undefined => {
      const fields = searchableFields(record);
      const matchedFields: string[] = [];
      const matchedTerms = new Set<string>();
      let score = 0;
      for (const [field, value] of Object.entries(fields)) {
        const matches = intersection(queryTerms, terms(value));
        if (matches.length === 0) continue;
        matchedFields.push(field);
        for (const match of matches) matchedTerms.add(match);
        score += matches.length * (field === "tags" || field === "id" ? 4 : 2);
      }
      if (matchedTerms.size === 0) return undefined;
      return {
        matchedFields: matchedFields.sort(),
        matchedTerms: [...matchedTerms].sort(),
        record,
        score,
      };
    })
    .filter((match): match is MemorySearchMatch => match !== undefined)
    .sort(
      (left, right) =>
        right.score - left.score || right.record.createdAt.localeCompare(left.record.createdAt),
    );
}

export async function searchMemoryRecords(
  root: string,
  query: string,
): Promise<MemorySearchMatch[]> {
  return searchMemory(await listMemoryRecords(root), query);
}

/** Match historical defects to a later Git change using exact paths and meaningful vocabulary. */
export function matchHistoricalRisks(
  analysis: GitDiffAnalysis,
  records: readonly QAMemoryRecord[],
): HistoricalRiskMatch[] {
  if (analysis.clean) return [];
  const changedPaths = new Set(analysis.files.map((file) => file.path.replaceAll("\\", "/")));
  const changedTerms = terms(
    analysis.files
      .flatMap((file) => [file.path, ...file.symbols, ...file.classifications])
      .join(" "),
  );

  return records
    .map((record): HistoricalRiskMatch | undefined => {
      if (record.status !== "active") return undefined;
      const exactFileMatches = record.relatedFiles
        .filter((path) => changedPaths.has(path))
        .sort();
      const memoryTerms = terms(Object.values(searchableFields(record)).join(" "));
      const matchedTerms = intersection(changedTerms, memoryTerms);
      if (exactFileMatches.length === 0 && matchedTerms.length < 2) return undefined;
      const reasons = [
        ...(exactFileMatches.length === 0
          ? []
          : [`Changed ${exactFileMatches.length} file linked to historical memory ${record.id}.`]),
        ...(matchedTerms.length === 0
          ? []
          : [`Matches historical terms for ${record.id}: ${matchedTerms.join(", ")}.`]),
      ];
      return {
        exactFileMatches,
        matchedTerms,
        memoryId: record.id,
        reasons,
        regressionTests: record.regressionTests,
        relatedContracts: record.relatedContracts,
        severity: record.severity,
        title: record.title,
        type: record.type,
      };
    })
    .filter((match): match is HistoricalRiskMatch => match !== undefined)
    .sort((left, right) => left.memoryId.localeCompare(right.memoryId));
}
