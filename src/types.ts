export type Side = 0 | 1;
export interface Replay {
  id: string;
  log: string;
  inputlog?: string;
  players: string[];
  formatid?: string;
  rating?: number;
}
export interface Action {
  id: string;
  label: string;
  type: string;
  kind: "move" | "switch" | "pass";
  tera?: boolean;
}
export interface PokemonView {
  name: string;
  species: string;
  hp: number;
  maxhp: number;
  level: number;
  status: string;
  active: boolean;
  fainted: boolean;
  tera: string;
  types: string[];
  moves: string[];
  item: string;
  ability: string;
}
export interface PositionView {
  index: number;
  turn: number;
  phase: string;
  teams: PokemonView[][];
  players: string[];
  actions: Action[][];
  played: string[];
  conditions: string[][];
  weather: string;
  log: string[];
}
export interface Matrix {
  provisional: boolean;
  approximate: boolean;
  coverage: number;
  rows: Action[];
  columns: Action[];
  values: number[][];
  counts: number[][];
  grades: {
    label: string;
    symbol: string;
    className: string;
    reason: string;
  }[];
  opponentGrades: {
    label: string;
    symbol: string;
    className: string;
    reason: string;
  }[];
  p: number[];
  q: number[];
  value: number;
  exploitability: number;
  mode: "masked" | "oracle";
  perspective: Side;
  regret: number | null;
  opponentRegret: number | null;
  luck: number | null;
  realized: number | null;
  expected: number | null;
  played: number[];
  best: number;
  events: string[];
}
export interface AnalysisPoint {
  provisional: boolean;
  approximate?: boolean;
  index: number;
  turn: number;
  value: number;
  luck: number | null;
  regret: number | null;
  opponentRegret: number | null;
  grade?: string;
  opponentGrade?: string;
}
export interface Outcome {
  label: string;
  probability: number;
  value: number;
  key: string;
}
export interface Branch {
  approximate: boolean;
  view: PositionView;
  outcomes: Outcome[];
  value: number;
  label: string;
}
export interface Loaded {
  replay: Replay;
  positions: PositionView[];
  outcome: { winner: string; value: number } | null;
  verified: boolean;
  revision: string;
  warnings: string[];
}
export const GRADES = [
  { label: "Best", symbol: "★", className: "best", below: 0.005 },
  { label: "Excellent", symbol: "!", className: "excellent", below: 0.01 },
  { label: "Good", symbol: "✓", className: "good", below: 0.02 },
  { label: "Inaccuracy", symbol: "?!", className: "inaccuracy", below: 0.05 },
  { label: "Mistake", symbol: "?", className: "mistake", below: 0.12 },
  { label: "Blunder", symbol: "??", className: "blunder", below: Infinity },
];
export const grade = (loss: number | null) =>
  loss === null || !Number.isFinite(loss)
    ? { label: "Not graded", symbol: "—", className: "neutral" }
    : GRADES.find((g) => loss < g.below)!;
export const percent = (n: number) => `${(n * 100).toFixed(1)}%`;
export const points = (n: number) =>
  `${n >= 0 ? "+" : ""}${(n * 100).toFixed(1)} pp`;
