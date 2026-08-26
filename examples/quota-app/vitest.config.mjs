import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // `npm test` runs only the suite the agent maintains; MaruCheck selects the
    // contract regression suite in `tests/` on its own.
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
  },
});
