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
  details?: string;
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
  teraType?: string;
  stats?: Record<string, number>;
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
export interface LuckEvent {
  kind: string;
  side: Side;
  label: string;
  probability: number;
  occurred: boolean;
  favorable: boolean;
}
export interface Matrix {
  provisional: boolean;
  approximate: boolean;
  coverage: number;
  rows: Action[];
  columns: Action[];
  values: number[][];
  moveValues: number[];
  opponentMoveValues: number[];
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
  nashValue: number;
  exploitability: number;
  mode: "masked" | "oracle";
  perspective: Side;
  regret: number | null;
  opponentRegret: number | null;
  luck: number | null;
  luckVariance: number | null;
  luckSwing: number | null;
  luckEvents: LuckEvent[];
  played: number[];
  best: number;
  events: string[];
}
export interface AnalysisPoint {
  provisional: boolean;
  approximate?: boolean;
  index: number;
  turn: number;
  events?: string[];
  value: number;
  luck: number | null;
  luckVariance: number | null;
  luckSwing: number | null;
  luckEvents: LuckEvent[];
  regret: number | null;
  opponentRegret: number | null;
  grade?: string;
  opponentGrade?: string;
}
export interface Branch {
  parent: number;
  actions: Action[];
  view: PositionView;
}
export interface Continuation {
  value: number;
  steps: Branch[];
}
export interface Loaded {
  replay: Replay;
  positions: PositionView[];
  branches: Branch[];
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
