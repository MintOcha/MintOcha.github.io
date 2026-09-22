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
  equilibrium: number,
  sacrifice: number[],
) {
  const safe = values.filter(
    (_, i) => sacrifice[i] <= BRILLIANT.maximumSafeSacrificeChance,
  );
  return values.map((value, i) => {
    const regret = Math.max(0, equilibrium - value);
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
          reason: `At least ${(sacrifice[i] * 100).toFixed(1)}% chance of losing a Pokémon this step, while preserving ${(value * 100).toFixed(1)}% expected win value and outperforming every low-sacrifice alternative by at least ${((value - Math.max(...safe)) * 100).toFixed(1)} pp against the same equilibrium defense.`,
        }
      : {
          ...grade(regret),
          reason: `${(regret * 100).toFixed(1)} pp expected win value lost against the equilibrium defense.`,
        };
  });
}
