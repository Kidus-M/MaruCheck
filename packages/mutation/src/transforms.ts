import * as ts from "typescript";
import type { MutationCandidate, MutationKind } from "./model.js";

const OWNERSHIP_TERM =
  /\b(?:account|access|authori[sz](?:ation|e|ed)?|member|organi[sz]ation|owner|permission|role|tenant|user)\w*\b/iu;
const COMPARISON_REPLACEMENTS = new Map<ts.SyntaxKind, string>([
  [ts.SyntaxKind.EqualsEqualsToken, "!="],
  [ts.SyntaxKind.EqualsEqualsEqualsToken, "!=="],
  [ts.SyntaxKind.ExclamationEqualsToken, "=="],
  [ts.SyntaxKind.ExclamationEqualsEqualsToken, "==="],
  [ts.SyntaxKind.LessThanToken, "<="],
  [ts.SyntaxKind.LessThanEqualsToken, "<"],
  [ts.SyntaxKind.GreaterThanToken, ">="],
  [ts.SyntaxKind.GreaterThanEqualsToken, ">"],
]);

interface CandidateDraft {
  readonly column: number;
  readonly description: string;
  readonly end: number;
  readonly file: string;
  readonly kind: MutationKind;
  readonly line: number;
  readonly original: string;
  readonly replacement: string;
  readonly start: number;
}

function isAbrupt(statement: ts.Statement): boolean {
  if (
    ts.isReturnStatement(statement) ||
    ts.isThrowStatement(statement) ||
    ts.isBreakStatement(statement) ||
    ts.isContinueStatement(statement)
  ) {
    return true;
  }
  if (!ts.isBlock(statement) || statement.statements.length === 0) return false;
  const last = statement.statements.at(-1);
  return last !== undefined && isAbrupt(last);
}

function guardKind(node: ts.IfStatement, sourceFile: ts.SourceFile): MutationKind | undefined {
  if (node.elseStatement !== undefined || !isAbrupt(node.thenStatement)) return undefined;
  if (!(ts.isSourceFile(node.parent) || ts.isBlock(node.parent))) return undefined;
  const condition = node.expression.getText(sourceFile);
  return OWNERSHIP_TERM.test(condition) ? "remove-ownership-condition" : "remove-guard";
}

function location(sourceFile: ts.SourceFile, start: number): { column: number; line: number } {
  const value = sourceFile.getLineAndCharacterOfPosition(start);
  return { column: value.character + 1, line: value.line + 1 };
}

function draft(input: {
  readonly description: string;
  readonly end: number;
  readonly file: string;
  readonly kind: MutationKind;
  readonly replacement: string;
  readonly source: string;
  readonly sourceFile: ts.SourceFile;
  readonly start: number;
}): CandidateDraft {
  return {
    ...location(input.sourceFile, input.start),
    description: input.description,
    end: input.end,
    file: input.file,
    kind: input.kind,
    original: input.source.slice(input.start, input.end),
    replacement: input.replacement,
    start: input.start,
  };
}

/** Discover deterministic, single-edit TypeScript mutants without executing project code. */
export function discoverTypeScriptMutations(file: string, source: string): MutationCandidate[] {
  const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind);
  const drafts: CandidateDraft[] = [];

  const visit = (node: ts.Node): void => {
    if (node.kind === ts.SyntaxKind.TrueKeyword || node.kind === ts.SyntaxKind.FalseKeyword) {
      const start = node.getStart(sourceFile);
      const replacement = node.kind === ts.SyntaxKind.TrueKeyword ? "false" : "true";
      drafts.push(
        draft({
          description: `Invert boolean ${source.slice(start, node.end)} to ${replacement}.`,
          end: node.end,
          file,
          kind: "invert-boolean",
          replacement,
          source,
          sourceFile,
          start,
        }),
      );
    }

    if (ts.isBinaryExpression(node)) {
      const replacement = COMPARISON_REPLACEMENTS.get(node.operatorToken.kind);
      if (replacement !== undefined) {
        const start = node.operatorToken.getStart(sourceFile);
        drafts.push(
          draft({
            description: `Change comparison ${node.operatorToken.getText(sourceFile)} to ${replacement}.`,
            end: node.operatorToken.end,
            file,
            kind: "change-comparison",
            replacement,
            source,
            sourceFile,
            start,
          }),
        );
      }
    }

    if (ts.isIfStatement(node)) {
      const mutationKind = guardKind(node, sourceFile);
      if (mutationKind !== undefined) {
        const start = node.getStart(sourceFile);
        drafts.push(
          draft({
            description:
              mutationKind === "remove-ownership-condition"
                ? `Remove ownership guard ${node.expression.getText(sourceFile)}.`
                : `Remove guard ${node.expression.getText(sourceFile)}.`,
            end: node.end,
            file,
            kind: mutationKind,
            replacement: "",
            source,
            sourceFile,
            start,
          }),
        );
      }
    }

    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  return drafts
    .sort(
      (left, right) =>
        left.start - right.start || left.end - right.end || left.kind.localeCompare(right.kind),
    )
    .map((candidate, index) => ({
      ...candidate,
      id: `MUT-${String(index + 1).padStart(4, "0")}`,
    }));
}

/** Apply one previously discovered edit to its exact source snapshot. */
export function applyMutation(source: string, candidate: MutationCandidate): string {
  if (source.slice(candidate.start, candidate.end) !== candidate.original) {
    throw new MutationError(
      "MUTATION_SOURCE_CHANGED",
      `Mutation ${candidate.id} no longer matches ${candidate.file}.`,
    );
  }
  return `${source.slice(0, candidate.start)}${candidate.replacement}${source.slice(candidate.end)}`;
}

export class MutationError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "MutationError";
  }
}
