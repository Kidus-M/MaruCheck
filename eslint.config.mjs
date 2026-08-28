import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["**/dist/**", "**/node_modules/**", "**/coverage/**"],
  },
  eslint.configs.recommended,
  {
    files: ["scripts/**/*.mjs", "examples/**/*.mjs"],
    languageOptions: {
      globals: { console: "readonly", process: "readonly" },
    },
  },
  ...tseslint.configs.recommended,
  {
    // The Jest example is deliberately plain CommonJS JavaScript: it is what a
    // project that has never adopted TypeScript looks like, which is the point.
    files: ["examples/**/*.js"],
    languageOptions: {
      globals: {
        describe: "readonly",
        expect: "readonly",
        it: "readonly",
        module: "writable",
        require: "readonly",
      },
      sourceType: "commonjs",
    },
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
);
