import solver from "javascript-lp-solver";

export function solveMatrix(matrix: number[][]) {
  const n = matrix.length,
    m = matrix[0].length;
  function strategy(payoff: number[][]) {
    const rows = payoff.length,
      cols = payoff[0].length;
    const constraints: Record<string, { min?: number; equal?: number }> = {
      sum: { equal: 1 },
    };
    const variables: Record<string, Record<string, number>> = {
      v: { objective: 1 },
    };
    for (let j = 0; j < cols; j++) {
      constraints[`c${j}`] = { min: 0 };
      variables.v[`c${j}`] = -1;
    }
    for (let i = 0; i < rows; i++) {
      const variable: Record<string, number> = { sum: 1 };
      for (let j = 0; j < cols; j++) variable[`c${j}`] = payoff[i][j] + 1;
      variables[`p${i}`] = variable;
    }
    const result = solver.Solve({
      optimize: "objective",
      opType: "max",
      constraints,
      variables,
    }) as Record<string, number | boolean>;
    if (!result.feasible || !result.bounded)
      throw new Error("The payoff game could not be solved.");
    const p = Array.from({ length: rows }, (_, i) =>
      Math.max(0, Number(result[`p${i}`] || 0)),
    );
    const total = p.reduce((a, b) => a + b, 0);
    if (!total) throw new Error("Invalid equilibrium strategy");
    return p.map((x) => x / total);
  }
  const p = strategy(matrix),
    q = strategy(
      Array.from({ length: m }, (_, j) =>
        Array.from({ length: n }, (_, i) => 1 - matrix[i][j]),
      ),
    );
  const rowValues = matrix.map((row) =>
    row.reduce((sum, x, j) => sum + x * q[j], 0),
  );
  const colValues = Array.from({ length: m }, (_, j) =>
    matrix.reduce((sum, row, i) => sum + p[i] * row[j], 0),
  );
  const value = rowValues.reduce((sum, x, i) => sum + p[i] * x, 0);
  const worstValues = matrix.map((row) => Math.min(...row));
  const safestValue = Math.max(...worstValues);
  return {
    p,
    q,
    best: worstValues.indexOf(safestValue),
    worstValues,
    safestValue,
    value,
    exploitability: Math.max(...rowValues) - Math.min(...colValues),
    rowValues,
    colValues,
  };
}
