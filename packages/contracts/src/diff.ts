import type { ContractChange, ContractDiff, QualityContract } from "./model.js";

const MECHANICAL_PATHS = new Set(["approval", "status", "title"]);

function equal(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function change(path: string, before: unknown, after: unknown): ContractChange {
  const semantic = !MECHANICAL_PATHS.has(path.split(".")[0]!);
  return {
    kind: before === undefined ? "added" : after === undefined ? "removed" : "changed",
    path,
    semantic,
    ...(before === undefined ? {} : { before }),
    ...(after === undefined ? {} : { after }),
  };
}

function compareValue(
  path: string,
  left: unknown,
  right: unknown,
  changes: ContractChange[],
): void {
  if (equal(left, right)) return;
  if (
    typeof left === "object" &&
    left !== null &&
    !Array.isArray(left) &&
    typeof right === "object" &&
    right !== null &&
    !Array.isArray(right)
  ) {
    const leftRecord = left as Record<string, unknown>;
    const rightRecord = right as Record<string, unknown>;
    const keys = [...new Set([...Object.keys(leftRecord), ...Object.keys(rightRecord)])].sort();
    for (const key of keys) {
      compareValue(`${path}.${key}`, leftRecord[key], rightRecord[key], changes);
    }
    return;
  }
  changes.push(change(path, left, right));
}

function compareIdentifiedList(
  path: string,
  left: readonly { readonly id: string }[],
  right: readonly { readonly id: string }[],
  changes: ContractChange[],
): void {
  const leftItems = new Map(left.map((item) => [item.id, item]));
  const rightItems = new Map(right.map((item) => [item.id, item]));
  const ids = [...new Set([...leftItems.keys(), ...rightItems.keys()])].sort();
  for (const id of ids) {
    const before = leftItems.get(id);
    const after = rightItems.get(id);
    if (before === undefined || after === undefined) {
      changes.push(change(`${path}[${id}]`, before, after));
      continue;
    }
    for (const key of [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()) {
      if (key !== "id") {
        compareValue(
          `${path}[${id}].${key}`,
          (before as Record<string, unknown>)[key],
          (after as Record<string, unknown>)[key],
          changes,
        );
      }
    }
  }
}

/** Compare two contracts and identify whether the differences change product intent. */
export function diffQualityContracts(left: QualityContract, right: QualityContract): ContractDiff {
  const changes: ContractChange[] = [];
  const leftRecord = left as unknown as Record<string, unknown>;
  const rightRecord = right as unknown as Record<string, unknown>;

  for (const key of [
    ...new Set([...Object.keys(leftRecord), ...Object.keys(rightRecord)]),
  ].sort()) {
    if (key === "requirements") {
      compareIdentifiedList(key, left.requirements, right.requirements, changes);
    } else if (key === "invariants") {
      compareIdentifiedList(key, left.invariants, right.invariants, changes);
    } else {
      compareValue(key, leftRecord[key], rightRecord[key], changes);
    }
  }

  return {
    classification:
      changes.length === 0
        ? "none"
        : changes.some((item) => item.semantic)
          ? "semantic"
          : "mechanical",
    changes,
  };
}
