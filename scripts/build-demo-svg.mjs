/**
 * Generate the animated terminal demo used at the top of README.md.
 *
 * The script below is a transcript of `node examples/quota-app/run.mjs`, trimmed to the
 * lines that carry the argument. Re-run the example first if MaruCheck's output changes:
 *
 *   node examples/quota-app/run.mjs
 *   node scripts/build-demo-svg.mjs
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const OUTPUT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "docs", "assets", "demo.svg");

const COLORS = {
  bg: "#15161A",
  chrome: "#1E1F25",
  comment: "#7C7C74",
  fail: "#E8705E",
  ink: "#D9D9D3",
  muted: "#9A9A92",
  pass: "#6FBF8B",
  prompt: "#8FAFC4",
  warn: "#D9A441",
};

/** [delay before this line in seconds, color key, text] */
const SCRIPT = [
  [
    0.0,
    "comment",
    "# An agent was asked to fix \u201cpaying users are throttled after upgrading\u201d.",
  ],
  [0.5, "prompt", "$ git diff --stat"],
  [0.4, "ink", " src/quota.test.ts |  7 +++++--"],
  [0.05, "ink", " src/quota.ts      | 15 +++++++++------"],
  [0.6, "prompt", "$ npm test"],
  [0.8, "pass", " Test Files  1 passed (1)"],
  [0.05, "pass", "      Tests  4 passed (4)"],
  [0.5, "comment", "# Green. The suite the agent maintains agrees with the code the agent wrote."],
  [1.2, "prompt", "$ maru verify --diff"],
  [1.0, "muted", "Risk: MODERATE (30/100)  \u00b7  Related contract: usage-quota"],
  [0.3, "fail", "Verification gate: BLOCKED"],
  [0.2, "ink", "Findings: 5 (5 blocking)"],
  [0.5, "fail", "[HIGH] BLOCKING  QUOTA-001 verification failed"],
  [0.2, "ink", "  Expected: Free plan users may perform at most 10 generations per month."],
  [0.1, "ink", '  Actual:   Received: "pro"'],
  [0.4, "fail", "[HIGH] BLOCKING  QUOTA-INV-001 verification failed"],
  [0.2, "ink", "  Expected: The plan tier must be read from the stored subscription record"],
  [0.1, "ink", "            and never from client-supplied request data."],
  [1.2, "prompt", "$ maru drift check --from observations.json"],
  [0.9, "fail", "Semantic drift: BLOCKED   Conflicts: 2 (2 blocking)"],
  [0.3, "muted", "[usage-quota#QUOTA-001]"],
  [0.15, "ink", "  Contract: at most 10 generations per calendar month"],
  [0.1, "warn", "  Observed: at most 1000 generations per calendar month"],
  [0.8, "comment", "# The tests moved. The contract did not. Approval stays human-owned."],
];

const CHARACTER = 8.2;
const LINE = 21;
const PADDING = 26;
const CHROME = 34;
const HOLD = 3.2;
const longest = SCRIPT.reduce((max, [, , text]) => Math.max(max, text.length), 0);
const width = Math.max(760, Math.ceil(longest * CHARACTER + PADDING * 2));
const height = CHROME + PADDING * 2 + SCRIPT.length * LINE;

const starts = [];
let clock = 0.6;
for (const [delay] of SCRIPT) {
  clock += delay;
  starts.push(clock);
}
const total = Number((clock + HOLD).toFixed(2));

const escape = (value) =>
  value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

const percent = (seconds) => Number(((seconds / total) * 100).toFixed(3));

const rules = SCRIPT.map(([, , text], index) => {
  const start = percent(starts[index]);
  const settled = Math.min(percent(starts[index] + 0.12), 100);
  const characters = Math.max(text.length, 1);
  return [
    `.l${index}{animation:a${index} ${total}s steps(${characters},end) infinite;}`,
    `@keyframes a${index}{0%,${start}%{clip-path:inset(0 100% 0 0)}${settled}%,100%{clip-path:inset(0 0 0 0)}}`,
  ].join("");
}).join("\n    ");

const lines = SCRIPT.map(([, color, text], index) => {
  const y = CHROME + PADDING + index * LINE + 14;
  return `  <text class="l${index}" x="${PADDING}" y="${y}" fill="${COLORS[color]}">${escape(text)}</text>`;
}).join("\n");

const dots = ["#E8705E", "#D9A441", "#6FBF8B"]
  .map((fill, index) => `  <circle cx="${24 + index * 18}" cy="17" r="5" fill="${fill}"/>`)
  .join("\n");

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="MaruCheck blocks an AI change that keeps the test suite green">
  <title>maru verify --diff blocks a green-but-wrong AI change</title>
  <style>
    text{font-family:"JetBrains Mono","SFMono-Regular",Consolas,"Liberation Mono",monospace;font-size:13.5px;white-space:pre;}
    ${rules}
  </style>
  <rect width="${width}" height="${height}" rx="10" fill="${COLORS.bg}"/>
  <rect width="${width}" height="${CHROME}" rx="10" fill="${COLORS.chrome}"/>
  <rect y="${CHROME - 10}" width="${width}" height="10" fill="${COLORS.chrome}"/>
${dots}
  <text x="${width / 2}" y="22" fill="${COLORS.muted}" font-size="12" text-anchor="middle">examples/quota-app</text>
${lines}
</svg>
`;

await mkdir(dirname(OUTPUT), { recursive: true });
await writeFile(OUTPUT, svg, "utf8");
console.log(
  `Wrote ${OUTPUT} (${SCRIPT.length} lines, ${String(total)}s loop, ${String(width)}x${String(height)}).`,
);
