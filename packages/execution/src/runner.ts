import { spawn } from "node:child_process";
import type { CommandRequest, CommandResult, CommandRunner } from "./types.js";

const MAX_CAPTURED_CHARACTERS = 256_000;

function appendBounded(current: string, chunk: string): string {
  if (current.length >= MAX_CAPTURED_CHARACTERS) return current;
  return current + chunk.slice(0, MAX_CAPTURED_CHARACTERS - current.length);
}

/** Execute a binary without a shell and retain bounded stdout/stderr for evidence artifacts. */
export const defaultCommandRunner: CommandRunner = {
  run(request: CommandRequest): Promise<CommandResult> {
    return new Promise((resolve) => {
      const startedAt = Date.now();
      let stderr = "";
      let stdout = "";
      let settled = false;
      let timedOut = false;
      const child = spawn(request.command, [...request.args], {
        cwd: request.cwd,
        env: { ...process.env, ...request.env },
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });

      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        stdout = appendBounded(stdout, chunk);
      });
      child.stderr.on("data", (chunk: string) => {
        stderr = appendBounded(stderr, chunk);
      });

      const finish = (exitCode: number | null): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ durationMs: Date.now() - startedAt, exitCode, stderr, stdout, timedOut });
      };
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill();
      }, request.timeoutMs);
      timer.unref();

      child.once("error", (error) => {
        stderr = appendBounded(stderr, error.message);
        finish(null);
      });
      child.once("close", (code) => finish(code));
    });
  },
};
