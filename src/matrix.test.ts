import assert from "node:assert/strict";
import { test } from "node:test";
import { solveMatrix } from "./matrix";

test("recommendation does not select an unsupported best response to a tied defense", () => {
  const result = solveMatrix([
    [0.5, 0],
    [0.5, 0.5],
  ]);
  assert.equal(result.best, 1);
  assert.ok(result.p[result.best] > 0);
  assert.ok(Math.abs(result.value - 0.5) < 1e-7);
});

test("mixed strategy protects its value against every opposing pure action", () => {
  const matrix = [
    [1, 0],
    [0, 0.5],
  ];
  const result = solveMatrix(matrix);
  assert.ok(Math.abs(result.p[0] - 1 / 3) < 1e-7);
  assert.ok(Math.abs(result.p[1] - 2 / 3) < 1e-7);
  for (const value of result.colValues) assert.ok(value >= result.value - 1e-7);
  assert.ok(result.exploitability < 1e-7);
});

test("safest move differs from the most frequent Nash action", () => {
  const result = solveMatrix([
    [1, 0],
    [0, 0.5],
    [0.2, 0.2],
  ]);
  assert.equal(result.best, 2);
  assert.equal(result.safestValue, 0.2);
  assert.ok(Math.abs(result.value - 1 / 3) < 1e-7);
});
