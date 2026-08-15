import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const packageSource = (name: string) =>
  fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@maru/contracts": packageSource("contracts"),
      "@maru/core": packageSource("core"),
      "@maru/git": packageSource("git"),
      "@maru/mcp-server": packageSource("mcp-server"),
      "@maru/shared": packageSource("shared"),
    },
  },
  test: {
    include: ["packages/*/src/**/*.test.ts"],
  },
});
