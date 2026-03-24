import fs from "node:fs/promises";
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
  summary: `passed ${passed}/${cases.length}`,
  details,
  generatedAt: new Date().toISOString()
};

await fs.writeFile("result.json", JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
