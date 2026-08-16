import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import { MaruMcpServer, handleJsonLine } from "./server.js";
import type { MaruToolDependencies } from "./tools.js";

export interface StdioMcpOptions extends MaruToolDependencies {
  readonly input?: Readable;
  readonly output?: Writable;
}

/** Run the local newline-delimited MCP transport until the client closes stdin. */
export async function runStdioMcpServer(options: StdioMcpOptions): Promise<void> {
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;
  const server = new MaruMcpServer(options);
  const lines = createInterface({ crlfDelay: Infinity, input, terminal: false });

  for await (const line of lines) {
    if (line.trim().length === 0) continue;
    const serialized = await handleJsonLine(server, line);
    if (serialized !== undefined) output.write(`${serialized}\n`);
  }
}
