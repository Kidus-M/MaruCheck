import { createHash } from "node:crypto";
import type { QualityContract } from "./model.js";

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, nested]) => nested !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, canonicalize(nested)]),
  );
}

/** Return the stable SHA-256 identifier for a contract's reviewable content. */
export function contractVersionHash(contract: QualityContract): string {
  const reviewableContent = Object.fromEntries(
    Object.entries(contract).filter(([key]) => key !== "approval" && key !== "status"),
  );
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(reviewableContent)))
    .digest("hex");
}
