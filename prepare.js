import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const workspaceDir = path.join(__dirname, "workspace");
const stateDir = path.join(__dirname, ".autoresearch");
const runsDir = path.join(stateDir, "runs");
const resetWorkspace = process.argv.includes("--reset-workspace");

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function exists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function writeFileIfMissing(filePath, content, force = false) {
  if (!force && (await exists(filePath))) {
    return false;
  }

  await fs.writeFile(filePath, content, "utf8");
  return true;
}

async function main() {
  await ensureDir(workspaceDir);
  await ensureDir(stateDir);
  await ensureDir(runsDir);

  const files = [
    {
      target: path.join(workspaceDir, "solution.js"),
      content: `export function solve(items) {
  return [...items].sort((a, b) => a - b);
}
`,
    },
    {
      target: path.join(workspaceDir, "evaluate.js"),
      content: `import fs from "node:fs/promises";
import { solve } from "./solution.js";

const cases = [
  { input: [3, 1, 2], expected: [1, 2, 3] },
  { input: [9, -1, 4, 4], expected: [-1, 4, 4, 9] },
  { input: [10, 2, 8, 6, 1], expected: [1, 2, 6, 8, 10] }
];

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

let passed = 0;
const details = [];

for (const testCase of cases) {
  const actual = solve(testCase.input);
  const ok = deepEqual(actual, testCase.expected);
  if (ok) {
    passed += 1;
  }

  details.push({
    input: testCase.input,
    expected: testCase.expected,
    actual,
    ok
  });
}

const score = cases.length - passed;
const result = {
  score,
  summary: \`passed \${passed}/\${cases.length}\`,
  details,
  generatedAt: new Date().toISOString()
};

await fs.writeFile("result.json", JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
`,
    },
    {
      target: path.join(workspaceDir, "README.md"),
      content: `# Workspace

这里是 agent 允许修改的工作区。

- \`solution.js\`：候选实现
- \`evaluate.js\`：评估脚本，必须输出 \`result.json\`

\`result.json\` 至少需要包含：

\`\`\`json
{
  "score": 0
}
\`\`\`

默认规则是分数越低越好。
`,
    },
  ];

  for (const file of files) {
    await writeFileIfMissing(file.target, file.content, resetWorkspace);
  }

  const bestResultPath = path.join(stateDir, "best.json");
  if (!(await exists(bestResultPath))) {
    await fs.writeFile(
      bestResultPath,
      JSON.stringify(
        {
          score: null,
          runId: null,
          summary: "no accepted run yet",
        },
        null,
        2,
      ),
      "utf8",
    );
  }

  console.log("Workspace prepared.");
  console.log(`- workspace: ${workspaceDir}`);
  console.log(`- state: ${stateDir}`);
  if (resetWorkspace) {
    console.log("- workspace template was reset");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
