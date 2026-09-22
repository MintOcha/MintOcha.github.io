import { grade } from "./types";

export const BRILLIANT = {
  maximumRegret: 0.005,
  minimumSacrificeChance: 0.5,
  maximumSafeSacrificeChance: 0.1,
  minimumAdvantage: 0.05,
  minimumValue: 0.5,
  maximumValue: 0.95,
};

// A product convention, not a claim of human creativity or information-fair play.
export function classifyMoves(
  values: number[],
  bestValue: number,
  sacrifice: number[],
) {
  const safe = values.filter(
    (_, i) => sacrifice[i] <= BRILLIANT.maximumSafeSacrificeChance,
  );
  return values.map((value, i) => {
    const regret = Math.max(0, bestValue - value);
    const brilliant =
      regret < BRILLIANT.maximumRegret &&
      sacrifice[i] >= BRILLIANT.minimumSacrificeChance &&
      value >= BRILLIANT.minimumValue &&
      value <= BRILLIANT.maximumValue &&
      safe.length > 0 &&
      value - Math.max(...safe) >= BRILLIANT.minimumAdvantage;
    return brilliant
      ? {
          label: "Brilliant",
          symbol: "!!",
          className: "brilliant",
          reason: `${(sacrifice[i] * 100).toFixed(1)}% sacrifice rate with ${(value * 100).toFixed(1)}% win value, ${((value - Math.max(...safe)) * 100).toFixed(1)} pp above safer alternatives.`,
        }
      : {
          ...grade(regret),
          reason: `${(regret * 100).toFixed(1)} pp below the best available move.`,
        };
  });
}
