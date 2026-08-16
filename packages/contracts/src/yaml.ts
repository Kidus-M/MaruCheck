import { ContractError } from "./model.js";

interface YamlLine {
  readonly content: string;
  readonly indent: number;
  readonly line: number;
}

const MAX_DOCUMENT_SIZE = 1024 * 1024;
const FORBIDDEN_YAML_FEATURE = /(^|[\s:[{,])(?:[&*!]|<<:)/u;

function yamlError(message: string, line?: number): ContractError {
  const suffix = line === undefined ? "" : ` at line ${line}`;
  return new ContractError(
    "CONTRACT_INVALID",
    `Invalid contract YAML${suffix}: ${message}`,
    "Fix the YAML syntax and run maru contract validate again.",
    [{ message, path: line === undefined ? "yaml" : `yaml.line.${line}` }],
  );
}

function splitKeyValue(content: string, line: number): [string, string] {
  const separator = content.indexOf(":");
  if (separator <= 0) {
    throw yamlError("Expected a key followed by a colon.", line);
  }
  const key = content.slice(0, separator).trim();
  if (!/^[A-Za-z][A-Za-z0-9_-]*$/u.test(key)) {
    throw yamlError(`Unsupported key: ${key}`, line);
  }
  return [key, content.slice(separator + 1).trim()];
}

function parseScalar(value: string, line: number): unknown {
  if (FORBIDDEN_YAML_FEATURE.test(value)) {
    throw yamlError("YAML anchors, aliases, tags, and merge keys are not supported.", line);
  }
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "null" || value === "~") return null;
  if (/^-?(?:0|[1-9]\d*)$/u.test(value)) return Number(value);
  if (value.startsWith('"')) {
    try {
      return JSON.parse(value) as unknown;
    } catch {
      throw yamlError("Invalid double-quoted string.", line);
    }
  }
  if (value.startsWith("'")) {
    if (!value.endsWith("'")) throw yamlError("Unterminated single-quoted string.", line);
    return value.slice(1, -1).replaceAll("''", "'");
  }
  return value.replace(/\s+#.*$/u, "").trimEnd();
}

function tokenize(source: string): YamlLine[] {
  if (Buffer.byteLength(source, "utf8") > MAX_DOCUMENT_SIZE) {
    throw yamlError("Contract files cannot exceed 1 MiB.");
  }
  if (source.includes("\t")) {
    throw yamlError("Tabs are not allowed for indentation.");
  }

  const lines: YamlLine[] = [];
  for (const [index, raw] of source.replaceAll("\r\n", "\n").split("\n").entries()) {
    const trimmed = raw.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#") || trimmed === "---") continue;
    const indent = raw.length - raw.trimStart().length;
    if (indent % 2 !== 0)
      throw yamlError("Indentation must use multiples of two spaces.", index + 1);
    lines.push({ content: raw.trim(), indent, line: index + 1 });
  }
  return lines;
}

class StrictYamlParser {
  private index = 0;

  public constructor(private readonly lines: readonly YamlLine[]) {}

  public parse(): unknown {
    if (this.lines.length === 0) throw yamlError("The contract is empty.");
    if (this.lines[0]!.indent !== 0)
      throw yamlError("The document must start at indentation zero.");
    const value = this.parseNode(0);
    if (this.index !== this.lines.length) {
      throw yamlError("Unexpected indentation.", this.lines[this.index]?.line);
    }
    return value;
  }

  private parseNode(indent: number): unknown {
    const current = this.lines[this.index];
    if (current === undefined) return null;
    return current.content.startsWith("- ")
      ? this.parseSequence(indent)
      : this.parseMapping(indent);
  }

  private parseMapping(indent: number): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    while (this.index < this.lines.length) {
      const line = this.lines[this.index]!;
      if (line.indent < indent) break;
      if (line.indent > indent || line.content.startsWith("- ")) break;
      const [key, rawValue] = splitKeyValue(line.content, line.line);
      if (Object.hasOwn(result, key)) throw yamlError(`Duplicate key: ${key}`, line.line);
      this.index += 1;

      if (rawValue === ">" || rawValue === "|") {
        result[key] = this.parseBlockScalar(indent, rawValue === ">");
      } else if (rawValue.length > 0) {
        result[key] = parseScalar(rawValue, line.line);
      } else {
        const next = this.lines[this.index];
        result[key] =
          next !== undefined && next.indent > indent ? this.parseNode(next.indent) : null;
      }
    }
    return result;
  }

  private parseSequence(indent: number): unknown[] {
    const result: unknown[] = [];
    while (this.index < this.lines.length) {
      const line = this.lines[this.index]!;
      if (line.indent !== indent || !line.content.startsWith("- ")) break;
      const item = line.content.slice(2).trim();
      this.index += 1;

      if (item.length === 0) {
        const next = this.lines[this.index];
        result.push(
          next !== undefined && next.indent > indent ? this.parseNode(next.indent) : null,
        );
        continue;
      }

      if (/^[A-Za-z][A-Za-z0-9_-]*:(?:\s|$)/u.test(item)) {
        const [key, rawValue] = splitKeyValue(item, line.line);
        const object: Record<string, unknown> = {};
        object[key] = rawValue.length > 0 ? parseScalar(rawValue, line.line) : null;
        const next = this.lines[this.index];
        if (next !== undefined && next.indent > indent) {
          const continuation = this.parseMapping(next.indent);
          for (const [nestedKey, nestedValue] of Object.entries(continuation)) {
            if (Object.hasOwn(object, nestedKey)) {
              throw yamlError(`Duplicate key: ${nestedKey}`, next.line);
            }
            object[nestedKey] = nestedValue;
          }
        }
        result.push(object);
      } else {
        result.push(parseScalar(item, line.line));
      }
    }
    return result;
  }

  private parseBlockScalar(parentIndent: number, folded: boolean): string {
    const values: string[] = [];
    while (this.index < this.lines.length && this.lines[this.index]!.indent > parentIndent) {
      values.push(this.lines[this.index]!.content);
      this.index += 1;
    }
    return values.join(folded ? " " : "\n");
  }
}

export function parseYaml(source: string): unknown {
  return new StrictYamlParser(tokenize(source)).parse();
}

function quoteScalar(value: string): string {
  if (
    value.length === 0 ||
    /^(?:true|false|null|~|-?(?:0|[1-9]\d*))$/u.test(value) ||
    /[:#\n\r]|^[-?!&*!%@`{}[\],]/u.test(value) ||
    value !== value.trim()
  ) {
    return JSON.stringify(value);
  }
  return value;
}

function serializeNode(value: unknown, indent: number): string[] {
  const prefix = " ".repeat(indent);
  if (Array.isArray(value)) {
    const lines: string[] = [];
    for (const item of value) {
      if (typeof item === "object" && item !== null && !Array.isArray(item)) {
        const entries = Object.entries(item);
        const [firstKey, firstValue] = entries[0] ?? [];
        if (firstKey === undefined) continue;
        if (typeof firstValue === "object" && firstValue !== null) {
          lines.push(`${prefix}- ${firstKey}:`);
          lines.push(...serializeNode(firstValue, indent + 4));
        } else {
          lines.push(`${prefix}- ${firstKey}: ${serializeScalar(firstValue)}`);
        }
        for (const [key, nested] of entries.slice(1)) {
          if (typeof nested === "object" && nested !== null) {
            lines.push(`${prefix}  ${key}:`);
            lines.push(...serializeNode(nested, indent + 4));
          } else {
            lines.push(`${prefix}  ${key}: ${serializeScalar(nested)}`);
          }
        }
      } else {
        lines.push(`${prefix}- ${serializeScalar(item)}`);
      }
    }
    return lines;
  }

  const lines: string[] = [];
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (nested === undefined) continue;
    if (typeof nested === "object" && nested !== null) {
      lines.push(`${prefix}${key}:`);
      lines.push(...serializeNode(nested, indent + 2));
    } else {
      lines.push(`${prefix}${key}: ${serializeScalar(nested)}`);
    }
  }
  return lines;
}

function serializeScalar(value: unknown): string {
  if (typeof value === "string") return quoteScalar(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value === null) return "null";
  throw new TypeError("Unsupported YAML scalar");
}

export function serializeYaml(value: Record<string, unknown>): string {
  return `${serializeNode(value, 0).join("\n")}\n`;
}
