import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyMoves } from "./grading";
import { solveMatrix } from "./matrix";

test("the best available move has zero regret even in a losing position", () => {
  const result = solveMatrix([
    [0.4, 0.35],
    [0.3, 0.25],
  ]);
  assert(result.exploitability < 1e-6);
  const grades = classifyMoves(result.rowValues, result.value, [0, 0]);
  assert.equal(grades[0].label, "Best");
  assert.equal(grades[1].label, "Mistake");
});

test("mixed equilibrium support is not mistaken for a bad move", () => {
  const result = solveMatrix([
    [1, 0],
    [0, 1],
  ]);
  assert(Math.abs(result.value - 0.5) < 1e-6);
  assert.deepEqual(
    classifyMoves(result.rowValues, result.value, [0, 0]).map((g) => g.label),
    ["Best", "Best"],
  );
});

test("Brilliant requires sound sacrifice evidence and a meaningful safer alternative", () => {
  assert.equal(
    classifyMoves([0.65, 0.55], 0.65, [0.7, 0.05])[0].label,
    "Brilliant",
  );
  assert.equal(
    classifyMoves([0.65, 0.55], 0.65, [0.05, 0.05])[0].label,
    "Best",
  );
  assert.equal(classifyMoves([0.65, 0.64], 0.65, [0.7, 0.05])[0].label, "Best");
  assert.equal(classifyMoves([0.4, 0.3], 0.4, [0.7, 0.05])[0].label, "Best");
  assert.equal(
    classifyMoves([0.65, 0.75], 0.75, [0.7, 0.05])[0].label,
    "Mistake",
  );
});
