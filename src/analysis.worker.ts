import { Battle as Tracker } from "@pkmn/client";
import { Generations } from "@pkmn/data";
import { Dex as DataDex } from "@pkmn/dex";
import { solveMatrix } from "./matrix";
import { classifyMoves } from "./grading";
import { initializeCritic, evaluatePositions } from "./critic";
import type {
  Action,
  Replay,
  Side,
  PositionView,
  Matrix,
  Loaded,
  Branch,
  Continuation,
} from "./types";
import { variationStore } from "./variations";
import { observeLuck, summarizeLuck } from "./luck";

type Native = any;
interface Frame {
  state: Native;
  played: string[];
  after?: Native;
  luckEvents?: import("./types").LuckEvent[];
}
let engine: Native;
let replay: Replay;
let frames: Frame[] = [];
let cancelled = false;
let scoring: "safety" | "nash" = "safety";
let branchFrames: Frame[] = [];
let branches: Branch[] = [];
interface Matchup {
  pair: string[];
  values: number[];
  count: number;
  sacrifice: number[];
}
const REVIEW = { samples: 1, batch: 32, seed: [123, 456, 789, 1011] };
const matchups = new Map<string, Matchup>();
const cache = new Map<string, Matrix>();
const evaluations = new Map<string, number>();
const EVALUATION_CACHE_BYTES = 16 * 1024 * 1024;
let evaluationCacheBytes = 0;
const serializedStates = new WeakMap<object, string>();
const gens = new Generations(DataDex);
const id = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const json = <T>(x: T): T => JSON.parse(JSON.stringify(x));
function channel(state: Native, side: number) {
  return engine
    .extractChannelMessages(state.log.join("\n"), [side + 1])
    [side + 1].filter((s: string) => !s.startsWith("|request|"));
}
function clone(state: Native) {
  let serialized = serializedStates.get(state);
  if (serialized === undefined) {
    serialized = JSON.stringify(state);
    serializedStates.set(state, serialized);
  }
  return engine.Battle.fromJSON(serialized);
}
function snapshot(battle: Native) {
  return json(battle.toJSON());
}
function tracker(state: Native, side: Side) {
  const b = new Tracker(gens);
  for (const line of channel(state, side)) b.add(line);
  return b;
}
function actions(battle: Native, side: number): Action[] {
  const s = battle.sides[side],
    request = s.activeRequest;
  if (battle.ended || !request || request.wait)
    return [{ id: "pass", label: "Wait", type: "Normal", kind: "pass" }];
  const list: Action[] = [];
  if (request.active) {
    for (const [i, move] of request.active[0].moves.entries())
      if (!move.disabled && move.pp !== 0) {
        const type = battle.dex.moves.get(move.id).type;
        list.push({
          id: `move ${i + 1}`,
          label: move.move,
          type,
          kind: "move",
        });
        if (request.active[0].canTerastallize)
          list.push({
            id: `move ${i + 1} terastallize`,
            label: move.move,
            type,
            kind: "move",
            tera: true,
          });
      }
  }
  if (s.requestState === "switch" || !s.active[0]?.trapped)
    for (const [i, mon] of s.pokemon.entries())
      if (!mon.isActive && !mon.fainted)
        list.push({
          id: `switch ${i + 1}`,
          label: mon.species.name,
          type: mon.types[0],
          kind: "switch",
        });
  return list.length
    ? list
    : [{ id: "pass", label: "Wait", type: "Normal", kind: "pass" }];
}
function canonical(command: string, battle: Native, side: number) {
  if (!command) return "";
  const match = /^move ([^ ]+)(.*)$/.exec(command);
  if (match && !/^\d+$/.test(match[1])) {
    const moves = battle.sides[side].activeRequest?.active?.[0]?.moves || [];
    const slot = moves.findIndex((m: Native) => id(m.id) === id(match[1]));
    if (slot >= 0) return `move ${slot + 1}${match[2]}`;
  }
  return command;
}
function view(
  frame: Frame,
  index: number,
  perspective: Side,
  oracle: boolean,
): PositionView {
  const battle = clone(frame.state),
    known = tracker(frame.state, perspective);
  const teams = battle.sides.map((side: Native, s: number) => {
    if (oracle || s === perspective)
      return side.pokemon.map((m: Native) => ({
        name: m.name,
        species: m.species.name,
        details: m.details,
        hp: m.hp,
        maxhp: m.maxhp,
        level: m.level,
        status: m.status,
        active: m.isActive,
        fainted: m.fainted,
        tera: m.terastallized || "",
        teraType: m.teraType,
        stats: { ...m.storedStats },
        types: m.types,
        moves: m.moveSlots.map((v: Native) => battle.dex.moves.get(v.id).name),
        item: m.item,
        ability: m.ability,
      }));
    return known.sides[s].team.map((m) => ({
      name: m.name,
      species: m.speciesForme,
      hp: m.hp,
      maxhp: m.maxhp,
      level: m.level,
      status: m.status || "",
      active: m.isActive(),
      fainted: m.fainted,
      tera: m.terastallized || "",
      types: m.types,
      moves: m.moveSlots.map((v) => v.name),
      item: m.item,
      ability: m.ability,
    }));
  });
  return {
    index,
    turn: battle.turn,
    phase: battle.ended ? "ended" : battle.requestState,
    teams,
    players: battle.sides.map((s: Native) => s.name),
    actions: battle.sides.map((_: Native, s: number) =>
      s === perspective || oracle ? actions(battle, s) : [],
    ),
    played: frame.played,
    conditions: known.sides.map((s) =>
      Object.values(s.sideConditions).map((c) => c.name),
    ),
    weather: known.field.weather || known.field.terrain || "",
    log: engine.extractChannelMessages(frame.state.log.join("\n"), [
      perspective + 1,
    ])[perspective + 1],
  };
}
function comparison(log: string[]) {
  return log.filter((l) =>
    /^\|(switch|drag|replace|move|-damage|-heal|-status|-curestatus|-boost|-unboost|-terastallize|faint|turn|win)\|/.test(
      l,
    ),
  );
}
async function load(input: Replay): Promise<Loaded> {
  if (!input.inputlog)
    throw new Error(
      "This replay has no inputlog. Exact team and decision reconstruction needs a Randbats replay with a public inputlog.",
    );
  if (input.formatid && input.formatid !== "gen9randombattle")
    throw new Error("Only Gen 9 Random Battle singles are supported.");
  const revision = /^>version ([a-f0-9]{40})/m.exec(input.inputlog)?.[1];
  if (!revision) throw new Error("Replay is missing its simulator revision.");
  const url = `/simulators/${revision}.mjs.gz`;
  const response = await fetch(url);
  if (
    !response.ok ||
    response.headers.get("content-type")?.includes("text/html")
  )
    throw new Error(
      `Simulator ${revision} is not included in this deployment. This replay cannot be graded accurately until its original simulator is added.`,
    );
  const payload = await response.blob();
  const signature = new Uint8Array(await payload.slice(0, 2).arrayBuffer());
  // Hosts may already decode .gz assets through HTTP Content-Encoding.
  const source =
    signature[0] === 0x1f && signature[1] === 0x8b
      ? await new Response(
          payload.stream().pipeThrough(new DecompressionStream("gzip")),
        ).blob()
      : payload;
  const moduleUrl = URL.createObjectURL(
    new Blob([source], { type: "application/javascript" }),
  );
  try {
    engine = await import(/* @vite-ignore */ moduleUrl);
  } finally {
    URL.revokeObjectURL(moduleUrl);
  }
  replay = input;
  frames = [];
  matchups.clear();
  cache.clear();
  evaluations.clear();
  evaluationCacheBytes = 0;
  branchFrames = [];
  branches = [];
  class ReplayStream extends engine.BattleStream {
    constructor() {
      super({ keepAlive: true, noCatch: true });
    }
    pushMessage(type: string, data: string) {
      if (type === "sideupdate" && data.includes("|error|"))
        throw new Error(data.split("|error|")[1]);
    }
  }
  const stream = new ReplayStream();
  let current: Frame | undefined;
  for (const line of input.inputlog.split("\n")) {
    if (!line.trim() || line.startsWith(">version") || line.startsWith(">chat"))
      continue;
    if (
      !/^>(start|player|p1|p2|forcewin|forcelose|forcetie|tiebreak)(?: |$)/.test(
        line,
      )
    )
      continue;
    const choice = /^>(p[12]) (.+)$/.exec(line);
    if (choice) {
      const s = choice[1] === "p1" ? 0 : 1;
      if (!current) {
        current = { state: snapshot(stream.battle), played: ["", ""] };
        frames.push(current);
      }
      current.played[s] = canonical(choice[2], stream.battle, s);
    }
    await stream.write(line);
    if (
      choice &&
      stream.battle.sides.every((s: Native) => !s.choice.actions.length)
    ) {
      if (current) {
        current.after = snapshot(stream.battle);
        current = undefined;
      }
    }
  }
  if (current) {
    current.after = snapshot(stream.battle);
  }
  const channels = engine.extractChannelMessages(
    stream.battle.log.join("\n"),
    [0, 1, 2, -1],
  );
  const original = JSON.stringify(comparison(input.log.split("\n")));
  const verified = Object.values(channels).some(
    (lines) => JSON.stringify(comparison(lines as string[])) === original,
  );
  if (!verified)
    throw new Error(
      "Replay reconstruction diverged from every supported replay channel. Analysis stopped rather than grading the wrong state.",
    );
  if (!frames.length) throw new Error("No playable decisions in this replay.");
  const warnings: string[] = [];
  try {
    const saved = await variationStore<{
      inputlog: string;
      frames: Frame[];
      branches: Branch[];
    }>(`${revision}:${input.id}`);
    if (saved?.inputlog === input.inputlog) {
      branchFrames = saved.frames;
      branches = saved.branches;
    }
  } catch {
    warnings.push("Saved variations could not be loaded from this browser.");
  }
  return {
    replay: input,
    positions: frames.map((f, i) => view(f, i, 0, true)),
    branches,
    outcome: stream.battle.ended
      ? {
          winner: stream.battle.winner || "Tie",
          value: stream.battle.winner
            ? Number(stream.battle.winner === stream.battle.sides[0].name)
            : 0.5,
        }
      : null,
    verified,
    revision,
    warnings,
  };
}
function apply(battle: Native, pair: string[]) {
  for (let s = 0; s < 2; s++) {
    const side = battle.sides[s];
    if (
      battle.ended ||
      !side.activeRequest ||
      side.activeRequest.wait ||
      side.isChoiceDone()
    )
      continue;
    if (!side.choose(pair[s]))
      throw new Error(side.choice.error || `Illegal action: ${pair[s]}`);
  }
  if (battle.allChoicesDone()) battle.commitChoices();
  battle.sendUpdates();
}
async function evaluate(
  states: Native[],
  perspective: Side,
  oracle: boolean,
  live = false,
  both = false,
) {
  const values: number[] = [];
  for (let start = 0; start < states.length; start += 32) {
    if (cancelled) throw new Error("Analysis cancelled");
    const positions = states.slice(start, start + 32).flatMap((state, i) => {
      const b = live ? state : clone(state);
      return (both ? ([0, 1] as Side[]) : [perspective]).map((side) => {
        const player = `p${side + 1}`;
        if (b.ended) {
          const winner = b.winner;
          return {
            id: `${i}:${side}`,
            terminal: winner
              ? Number(winner === b.sides[side].name || winner === player)
              : 0.5,
          };
        }
        return {
          id: `${i}:${side}`,
          perspective: `p${side + 1}`,
          messages: channel(state, side).filter(
            (line: string) => !line.startsWith("|t:|"),
          ),
          request: b.sides[side].activeRequest,
          oracle: oracle
            ? b.sides.map((s: Native) => ({
                messages: channel(state, s.n).filter(
                  (line: string) => !line.startsWith("|t:|"),
                ),
                request: { ...s.activeRequest, side: s.getRequestData() },
              }))
            : undefined,
        };
      });
    });
    const results = new Map<string, number>();
    const identities = new Map<string, string>();
    const unique = new Map<string, (typeof positions)[number]>();
    for (const position of positions) {
      if (position.terminal !== undefined) continue;
      const { id, ...input } = position;
      const identity = JSON.stringify(input);
      identities.set(id, identity);
      const cached = evaluations.get(identity);
      if (cached !== undefined) results.set(id, cached);
      else if (!unique.has(identity)) unique.set(identity, position);
    }
    const pending = [...unique.values()];
    if (pending.length) {
      for (const result of await evaluatePositions(pending)) {
        if (
          !Number.isFinite(result.winProbability) ||
          result.winProbability < 0 ||
          result.winProbability > 1
        )
          throw new Error("Critic returned an invalid payoff");
        results.set(result.id, result.winProbability);
        const identity = identities.get(result.id);
        if (identity && identity.length * 2 <= EVALUATION_CACHE_BYTES) {
          while (
            evaluationCacheBytes + identity.length * 2 >
            EVALUATION_CACHE_BYTES
          ) {
            const oldest = evaluations.keys().next().value!;
            evaluations.delete(oldest);
            evaluationCacheBytes -= oldest.length * 2;
          }
          if (!evaluations.has(identity))
            evaluationCacheBytes += identity.length * 2;
          evaluations.set(identity, result.winProbability);
        }
      }
    }
    for (const [identity, representative] of unique) {
      const value = results.get(representative.id);
      if (value === undefined) throw new Error("Critic omitted a payoff");
      for (const [id, key] of identities)
        if (key === identity) results.set(id, value);
    }
    for (const position of positions) {
      const value = position.terminal ?? results.get(position.id);
      if (value === undefined) throw new Error("Critic omitted a payoff");
      values.push(value);
    }
  }
  return values;
}
function rollout(state: Native, pair: string[]) {
  const battle = clone(state);
  battle.prng = new engine.PRNG(REVIEW.seed);
  apply(battle, pair);
  return battle;
}
async function analyze(
  index: number,
  perspective: Side,
  oracle: boolean,
  notify = true,
  onProgress?: (coverage: number) => void,
  batchLimit = Infinity,
): Promise<Matrix> {
  const key = `${index}:${perspective}:${oracle}`;
  if (cache.has(key)) return cache.get(key)!;
  const frame = index < 0 ? branchFrames[-index - 1] : frames[index];
  if (!frame) throw new Error("Position no longer exists");
  const root = clone(frame.state),
    foe = (1 - perspective) as Side;
  const rows = actions(root, perspective),
    columns = actions(root, foe);
  const values = rows.map(() => columns.map(() => 0));
  const counts = rows.map(() => columns.map(() => 0));
  const cells: Matchup[] = [];
  let baseline: number[] | undefined;
  for (let i = 0; i < rows.length; i++) {
    for (let j = 0; j < columns.length; j++) {
      const pair = ["", ""];
      pair[perspective] = rows[i].id;
      pair[foe] = columns[j].id;
      const matchupKey = `${index}:${oracle}:${pair.join("|")}`;
      let cell = matchups.get(matchupKey);
      if (!cell) {
        baseline ??= await evaluate([root], perspective, oracle, true);
        const estimates = [0.5, 0.5];
        estimates[perspective] = baseline[0];
        cell = {
          pair,
          values: estimates,
          count: 0,
          sacrifice: [0, 0],
        };
        matchups.set(matchupKey, cell);
      }
      cells.push(cell);
    }
  }
  const refresh = async () => {
    for (let i = 0; i < rows.length; i++)
      for (let j = 0; j < columns.length; j++) {
        const cell = cells[i * columns.length + j];
        values[i][j] = cell.values[perspective];
        counts[i][j] = cell.count;
      }
    const coverage =
      cells.reduce((sum, cell) => sum + cell.count, 0) /
      (cells.length * REVIEW.samples);
    onProgress?.(coverage);
    if (!notify) return;
    const result = await assemble();
    if (notify) {
      postMessage({ type: "estimate", index, matrix: result });
      if (!onProgress)
        postMessage({
          type: "progress",
          progress: result.coverage,
          text: result.provisional
            ? `Comparing actions · ${(result.coverage * 100).toFixed(1)}% review complete`
            : "Evaluation complete",
        });
    }
    return result;
  };
  await refresh();
  let batches = 0;
  while (cells.some((cell) => cell.count < REVIEW.samples)) {
    if (cancelled) throw new Error("Analysis cancelled");
    const batch = cells
      .filter((cell) => cell.count < REVIEW.samples)
      .slice(0, REVIEW.batch);
    const states = batch.map((cell) => rollout(frame.state, cell.pair));
    const paired = await evaluate(states, 0, oracle, true, true);
    for (let k = 0; k < batch.length; k++) {
      const cell = batch[k];
      cell.count++;
      for (const side of [0, 1] as Side[]) {
        const p1 = (paired[2 * k] + 1 - paired[2 * k + 1]) / 2;
        cell.values[side] = oracle ? (side === 0 ? p1 : 1 - p1) : paired[2 * k + side];
        if (
          states[k].sides[side].pokemonLeft <
          frame.state.sides[side].pokemonLeft
        )
          cell.sacrifice[side] += 1 / REVIEW.samples;
      }
    }
    await refresh();
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (++batches >= batchLimit) break;
  }
  const result = await assemble();
  if (!result.provisional) cache.set(key, result);
  return result;

  async function assemble(): Promise<Matrix> {
    const provisional = cells.some((cell) => cell.count < REVIEW.samples);
    const coverage =
      cells.reduce((sum, cell) => sum + cell.count, 0) /
      (cells.length * REVIEW.samples);
    const solved = solveMatrix(values);
    const moveValues = scoring === "safety" ? solved.worstValues : solved.rowValues;
    const positionValue = scoring === "safety" ? solved.safestValue : solved.value;
    if (solved.exploitability > 1e-5)
      throw new Error(
        "Not graded: payoff equilibrium failed numerical verification.",
      );
    const playedRow = rows.findIndex((a) => a.id === frame.played[perspective]);
    const playedCol = columns.findIndex((a) => a.id === frame.played[foe]);
    const regret =
      playedRow < 0 ? null : Math.max(0, positionValue - moveValues[playedRow]);
    const opponentValues = columns.map((column) =>
      rows.map((row) => {
        const pair = ["", ""];
        pair[perspective] = row.id;
        pair[foe] = column.id;
        return matchups.get(`${index}:${oracle}:${pair.join("|")}`)!.values[
          foe
        ];
      }),
    );
    const opponentSolved = solveMatrix(opponentValues);
    const opponentMoveValues = scoring === "safety" ? opponentSolved.worstValues : opponentSolved.rowValues;
    const opponentValue = scoring === "safety" ? opponentSolved.safestValue : opponentSolved.value;
    if (opponentSolved.exploitability > 1e-5)
      throw new Error("Opponent equilibrium failed numerical verification.");
    const opponentRegret =
      playedCol < 0
        ? null
        : Math.max(0, opponentValue - opponentMoveValues[playedCol]);
    const sacrifice = rows.map((row, i) =>
      columns.reduce((sum, column, j) => {
        const weight = scoring === "safety"
          ? Number(j === values[i].indexOf(solved.worstValues[i]))
          : solved.q[j];
        if (!weight) return sum;
        const pair = ["", ""];
        pair[perspective] = row.id;
        pair[foe] = column.id;
        return (
          sum +
          weight *
            matchups.get(`${index}:${oracle}:${pair.join("|")}`)!.sacrifice[
              perspective
            ]
        );
      }, 0),
    );
    const opponentSacrifice = columns.map((column, j) =>
      rows.reduce((sum, row, i) => {
        const weight = scoring === "safety"
          ? Number(i === opponentValues[j].indexOf(opponentSolved.worstValues[j]))
          : opponentSolved.q[i];
        if (!weight) return sum;
        const pair = ["", ""];
        pair[perspective] = row.id;
        pair[foe] = column.id;
        return (
          sum +
          weight *
            matchups.get(`${index}:${oracle}:${pair.join("|")}`)!.sacrifice[foe]
        );
      }, 0),
    );
    const grades = classifyMoves(moveValues, positionValue, sacrifice);
    const opponentGrades = classifyMoves(
      opponentMoveValues,
      opponentValue,
      opponentSacrifice,
    );
    if (!provisional && frame.after && !frame.luckEvents) {
      const battle = clone(frame.state);
      const events = observeLuck(battle, clone);
      apply(battle, frame.played);
      if (
        JSON.stringify(comparison(battle.log)) !==
        JSON.stringify(comparison(frame.after.log))
      )
        throw new Error(
          "RNG event reconstruction diverged from the recorded turn.",
        );
      frame.luckEvents = events;
    }
    const luckEvents = frame.luckEvents ?? [];
    const stats = summarizeLuck(luckEvents, perspective);
    const result: Matrix = {
      provisional,
      approximate: true,
      coverage,
      rows,
      columns,
      values,
      moveValues,
      opponentMoveValues,
      counts,
      grades: provisional
        ? rows.map(() => ({
            label: "Provisional",
            symbol: "…",
            className: "neutral",
            reason:
              "Review in progress; recommendations can change as more outcomes are evaluated.",
          }))
        : grades,
      opponentGrades: provisional
        ? columns.map(() => ({
            label: "Provisional",
            symbol: "…",
            className: "neutral",
            reason: "Unexplored outcomes can change this evaluation.",
          }))
        : opponentGrades,
      p: solved.p,
      q: solved.q,
      value: positionValue,
      nashValue: solved.value,
      exploitability: solved.exploitability,
      mode: oracle ? "oracle" : "masked",
      perspective,
      regret: provisional ? null : regret,
      opponentRegret: provisional ? null : opponentRegret,
      luck: stats.score,
      luckVariance: frame.luckEvents ? stats.variance : null,
      luckSwing: frame.luckEvents ? stats.swing : null,
      luckEvents,
      played: [playedRow, playedCol],
      best: scoring === "safety" ? solved.best : moveValues.indexOf(Math.max(...moveValues)),
      events: frame.after
        ? channel(frame.after, perspective)
            .slice(channel(frame.state, perspective).length)
            .filter((l: string) =>
              /\|(move|-crit|-miss|cant|-status|faint)\|/.test(l),
            )
        : [],
    };
    return result;
  }
}
async function branch(
  index: number,
  perspective: Side,
  oracle: boolean,
  ownAction: string,
  opponentAction: string,
) {
  const frame = index < 0 ? branchFrames[-index - 1] : frames[index];
  const root = clone(frame.state);
  const chosen: Action[] = [];
  chosen[perspective] = actions(root, perspective).find((action) => action.id === ownAction)!;
  chosen[1 - perspective] = actions(root, 1 - perspective).find((action) => action.id === opponentAction)!;
  if (chosen.some((action) => !action))
    throw new Error("Selected action is not legal in this position");
  const existing = branches.find(
    (entry) =>
      entry.parent === index &&
      entry.actions.every((action, side) => action.id === chosen[side].id),
  );
  if (existing) return existing;
  const state = snapshot(
    rollout(
      frame.state,
      chosen.map((action) => action.id),
    ),
  );
  const next = { state, played: ["", ""] };
  const selected = -branchFrames.push(next);
  const result: Branch = {
    parent: index,
    actions: chosen,
    view: view(next, selected, perspective, oracle),
  };
  branches.push(result);
  try {
    const revision = /(?:^|\n)>version ([^\n]+)/
      .exec(replay.inputlog!)?.[1]
      ?.trim();
    await variationStore(`${revision}:${replay.id}`, {
      inputlog: replay.inputlog,
      frames: branchFrames,
      branches,
    });
  } catch (error) {
    branches.pop();
    branchFrames.pop();
    throw new Error(`Could not save variation: ${(error as Error).message}`);
  }
  return result;
}
async function continuations(index: number, perspective: Side, oracle: boolean) {
  const root = await analyze(index, perspective, oracle, false);
  const ranked = root.rows.map((_, row) => ({ row, value: Math.min(...root.values[row]) }))
    .sort((a, b) => b.value - a.value || root.moveValues[b.row] - root.moveValues[a.row]).slice(0, 3);
  const lines: Continuation[] = [];
  for (const candidate of ranked) {
    const steps: Branch[] = [];
    let current = index;
    for (let depth = 0; depth < 2; depth++) {
      if (cancelled) throw new Error("Analysis cancelled");
      const matrix = depth === 0 ? root : await analyze(current, perspective, oracle, false);
      const row = depth === 0 ? candidate.row : matrix.best;
      const col = matrix.values[row].indexOf(Math.min(...matrix.values[row]));
      const next = await branch(current, perspective, oracle, matrix.rows[row].id, matrix.columns[col].id);
      steps.push(next);
      current = next.view.index;
      if (next.view.phase === "ended") break;
    }
    lines.push({ value: candidate.value, steps });
  }
  return lines;
}
onmessage = async (event) => {
  const { type, requestId, ...input } = event.data;
  if (type === "cancel") {
    cancelled = true;
    return;
  }
  try {
    cancelled = false;
    let result: unknown;
    if (type === "initialize") {
      const runtime = await initializeCritic();
      result = { backend: runtime.backend };
    } else if (type === "scoring") {
      if (input.scoring !== "safety" && input.scoring !== "nash")
        throw new Error("Unknown scoring mode");
      scoring = input.scoring;
      cache.clear();
      result = { scoring };
    } else if (type === "load") result = await load(input.replay);
    else if (type === "view") {
      const f =
        input.index < 0 ? branchFrames[-input.index - 1] : frames[input.index];
      result = view(f, input.index, input.perspective, input.oracle);
    } else if (type === "overview") {
      const states = frames.map((frame) => frame.state);
      const values = await evaluate(states, input.perspective, input.oracle);
      const points = [];
      for (const [index, value] of values.entries()) {
        const key = `${index}:${input.perspective}:${input.oracle}`;
        let matrix = cache.get(key);
        if (!matrix) {
          const root = clone(frames[index].state);
          const columns = actions(root, 1);
          const complete = actions(root, 0).every((row) =>
            columns.every(
              (column) =>
                matchups.get(`${index}:${input.oracle}:${row.id}|${column.id}`)
                  ?.count === REVIEW.samples,
            ),
          );
          if (complete)
            matrix = await analyze(
              index,
              input.perspective,
              input.oracle,
              false,
            );
        }
        points.push({
          index,
          turn: frames[index].state.turn,
          value: matrix?.value ?? value,
          provisional: !matrix,
          approximate: matrix?.approximate,
          luck: matrix?.luck ?? null,
          luckVariance: matrix?.luckVariance ?? null,
          luckSwing: matrix?.luckSwing ?? null,
          regret: matrix?.regret ?? null,
          opponentRegret: matrix?.opponentRegret ?? null,
          grade: matrix?.grades[matrix.played[0]]?.label,
          opponentGrade: matrix?.opponentGrades[matrix.played[1]]?.label,
          events: matrix?.events,
          luckEvents: matrix?.luckEvents ?? [],
        });
      }
      result = points;
    } else if (type === "analyze") {
      result = await analyze(
        input.index,
        input.perspective,
        input.oracle,
        true,
      );
    } else if (type === "continuations") {
      result = await continuations(input.index, input.perspective, input.oracle);
    } else if (type === "branch")
      result = await branch(
        input.index,
        input.perspective,
        input.oracle,
        input.ownAction,
        input.opponentAction,
      );
    else if (type === "timeline") {
      const order = frames.map((_, i) => i);
      const selected = input.index ?? 0;
      order.splice(order.indexOf(selected), 1);
      order.unshift(selected);
      const coverageByPosition: number[] = frames.map((_, i) =>
        cache.has(`${i}:${input.perspective}:${input.oracle}`) ? 1 : 0,
      );
      const remaining = new Set(order.filter((i) => coverageByPosition[i] < 1));
      while (remaining.size && !cancelled) {
        for (const i of order) {
          if (cancelled) break;
          if (!remaining.has(i)) continue;
          const result = await analyze(
            i,
            input.perspective,
            input.oracle,
            i === selected,
            (coverage) => {
              coverageByPosition[i] = coverage;
              postMessage({
                type: "progress",
                progress:
                  coverageByPosition.reduce((sum, value) => sum + value, 0) /
                  frames.length,
                text: `Analysing battle · ${frames.length - remaining.size} / ${frames.length} decisions reviewed · turn ${frames[i].state.turn}`,
              });
            },
            i === selected ? Infinity : 1,
          );
          if (!result.provisional) remaining.delete(i);
          postMessage({
            type: "point",
            point: {
              index: i,
              turn: frames[i].state.turn,
              provisional: result.provisional,
              approximate: result.approximate,
              value: result.value,
              luck: result.luck,
              luckVariance: result.luckVariance,
              luckSwing: result.luckSwing,
              regret: result.regret,
              opponentRegret: result.opponentRegret,
              grade: result.grades[result.played[0]]?.label,
              opponentGrade: result.opponentGrades[result.played[1]]?.label,
              events: result.events,
              luckEvents: result.luckEvents,
            },
          });
          postMessage({
            type: "progress",
            progress:
              coverageByPosition.reduce((sum, value) => sum + value, 0) /
              frames.length,
            text: `Analysing battle · ${frames.length - remaining.size} / ${frames.length} decisions reviewed`,
          });
        }
      }
      result = { complete: !cancelled };
    }
    postMessage({ type: "result", requestId, result });
  } catch (error) {
    postMessage({
      type: "error",
      requestId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
