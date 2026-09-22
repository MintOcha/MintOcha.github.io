import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Sprites, Icons } from "@pkmn/img";
import Battlefield from "./Battlefield";
import MoveHistory from "./MoveHistory";
import { accuracy } from "./grading";
import { summarizeLuck } from "./luck";
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Link,
  Settings,
  Info,
  Play,
  Pause,
  ArrowLeftRight,
  Square,
  ExternalLink,
  Check,
  LoaderCircle,
  Eye,
  Clover,
} from "lucide-react";
import type {
  Loaded,
  PositionView,
  Matrix,
  Action,
  Side,
  AnalysisPoint,
  Branch,
  Continuation,
  Replay,
} from "./types";
import { GRADES, grade, percent, points } from "./types";
import "./style.css";

const luckLabel = (value: number | null) =>
  value === null
    ? "No chance events"
    : `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(1)}σ`;
const worker = new Worker(new URL("./analysis.worker.ts", import.meta.url), {
  type: "module",
});
let serial = 0;
const requests = new Map<
  number,
  {
    resolve: (r: any) => void;
    reject: (e: Error) => void;
    promise: Promise<unknown>;
  }
>();
function call<T>(type: string, input: object = {}): Promise<T> {
  const { promise, resolve, reject } = Promise.withResolvers<T>();
  const requestId = ++serial;
  requests.set(requestId, { resolve, reject, promise });
  worker.postMessage({ type, requestId, ...input });
  return promise;
}
worker.addEventListener("message", ({ data }) => {
  if (data.type === "result" || data.type === "error") {
    const promise = requests.get(data.requestId);
    requests.delete(data.requestId);
    if (data.type === "error") promise?.reject(new Error(data.error));
    else promise?.resolve(data.result);
  }
});
function GradeIcon({
  assessment,
}: {
  assessment: { label: string; className: string; symbol: string };
}) {
  return assessment.className === "neutral" ? (
    <span className="grade-icon">{assessment.symbol}</span>
  ) : (
    <img
      className="grade-icon"
      src={`/icons/${assessment.className}.png`}
      alt={assessment.label}
    />
  );
}

function ActionButton({
  action,
  selected,
  best,
  played,
  value,
  regret,
  assessment,
  onClick,
}: {
  action: Action;
  selected: boolean;
  best: boolean;
  played: boolean;
  value?: number;
  regret?: number;
  assessment?: Matrix["grades"][number];
  onClick: () => void;
}) {
  return (
    <button
      className={`action ${action.kind === "switch" ? "switch-action" : `type-${action.type.toLowerCase()}`} ${played ? "played" : ""} ${selected ? "selected" : ""} ${best ? "best-response" : ""}`}
      onClick={onClick}
      aria-pressed={selected}
      title={`${action.label}${assessment ? ` · ${assessment.label}` : ""}${regret !== undefined ? ` · −${(regret * 100).toFixed(1)} pp` : ""}`}
    >
      <span className="action-name">
        {action.kind === "switch" && (
          <span
            className="switch-icon"
            style={Icons.getPokemon(action.label).css}
            aria-hidden="true"
          />
        )}
        {action.label}
        {action.tera && <span className="tera"> Tera</span>}
      </span>
      <span className="action-detail">
        {action.kind === "move"
          ? action.type
          : action.kind === "switch"
            ? "Switch"
            : "No choice"}
        <b>
          {assessment && <GradeIcon assessment={assessment} />}
          {value !== undefined ? percent(value) : ""}
        </b>
      </span>
    </button>
  );
}
function ActionChoices({
  actions,
  selected,
  onSelect,
  className,
  suggested,
  ended,
  children,
}: {
  actions: Action[];
  selected: number | null;
  onSelect: (index: number | null) => void;
  className: string;
  children: (action: Action, index: number) => React.ReactNode;
  suggested?: number;
  ended?: boolean;
}) {
  const [tera, setTera] = useState<boolean | null>(null);
  useEffect(() => setTera(null), [suggested]);
  const choice = selected === null ? undefined : actions[selected];
  const available = actions.some((action) => action.tera);
  const checked =
    available &&
    (choice?.kind === "move"
      ? !!choice.tera
      : (tera ?? (suggested !== undefined && !!actions[suggested]?.tera)));
  if (actions.length === 1 && actions[0].kind === "pass")
    return (
      <p className="note">
        {ended
          ? "Battle ended."
          : "Waiting for the other player’s replacement."}
      </p>
    );
  return (
    <>
      {available && (
        <label className="tera-choice">
          <input
            type="checkbox"
            checked={checked}
            onChange={(event) => {
              const enabled = event.target.checked;
              setTera(enabled);
              if (choice?.kind === "move") {
                const id = choice.id.replace(/ terastallize$/, "");
                const index = actions.findIndex(
                  (action) =>
                    action.id === `${id}${enabled ? " terastallize" : ""}`,
                );
                onSelect(index < 0 ? null : index);
              }
            }}
          />
          Terastallize
        </label>
      )}
      <div className={className}>
        <div className="move-buttons">
          {actions.map((action, index) =>
            action.kind === "move" && !!action.tera === checked
              ? children(action, index)
              : null,
          )}
        </div>
        {actions.some((action) => action.kind === "switch") && (
          <div className="switch-buttons" aria-label="Switch Pokémon">
            {actions.map((action, index) =>
              action.kind === "switch" ? children(action, index) : null,
            )}
          </div>
        )}
      </div>
    </>
  );
}

function App() {
  const [link, setLink] = useState("");
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [position, setPosition] = useState<PositionView | null>(null);
  const [analysisMatrix, setMatrix] = useState<Matrix | null>(null);
  const [side, setSide] = useState<Side>(0);
  const oracle = false;
  const [positionValue, setPositionValue] = useState<number | null>(null);
  const [battleLog, setBattleLog] = useState("");
  const [playing, setPlaying] = useState(false);
  const [settled, setSettled] = useState<number | null>(null);
  const [displayed, setDisplayed] = useState<{
    position: PositionView;
    matrix: Matrix | null;
    value: number | null;
  } | null>(null);
  const matrix =
    settled === position?.index ? analysisMatrix : (displayed?.matrix ?? null);
  const displayPosition =
    settled === position?.index ? position : displayed?.position;
  const displayValue =
    settled === position?.index ? positionValue : (displayed?.value ?? null);
  useEffect(() => {
    if (position && settled === position.index)
      setDisplayed({ position, matrix: analysisMatrix, value: positionValue });
  }, [position, settled, analysisMatrix, positionValue]);
  const logElement = useRef<HTMLDivElement>(null);
  const workspaceElement = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState("");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [health, setHealth] = useState<any>(null);
  const [row, setRow] = useState<number | null>(null);
  const [col, setCol] = useState<number | null>(null);
  const [tab, setTab] = useState("review");
  const [showMatrix, setShowMatrix] = useState(false);
  const [timeline, setTimeline] = useState<AnalysisPoint[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [lines, setLines] = useState<Continuation[]>([]);
  const linesPosition = useRef("");
  const [settings, setSettings] = useState(false);
  const [help, setHelp] = useState(false);
  const [replayIndex, setReplayIndex] = useState(0);
  const file = useRef<HTMLInputElement>(null);
  const latest = useRef(0);
  const reviewingBattle = useRef(false);
  const evaluationContext = useRef({
    index: 0,
    perspective: 0 as Side,
    oracle,
  });
  useEffect(() => {
    call<{ backend: string }>("initialize")
      .then(setHealth)
      .catch((error) =>
        setError(`Local critic failed to load: ${error.message}`),
      );
    const listener = ({ data }: MessageEvent) => {
      if (
        data.type === "estimate" &&
        data.index === evaluationContext.current.index &&
        data.matrix.perspective === evaluationContext.current.perspective &&
        data.matrix.mode ===
          (evaluationContext.current.oracle ? "oracle" : "masked")
      ) {
        setMatrix(data.matrix);
        if (!data.matrix.provisional) setPositionValue(data.matrix.value);
      }
      if (data.type === "progress") {
        setProgress(data.progress);
        setBusy(data.text);
      }
      if (data.type === "point")
        setTimeline((old) =>
          [...old.filter((p) => p.index !== data.point.index), data.point].sort(
            (a, b) => a.index - b.index,
          ),
        );
    };
    worker.addEventListener("message", listener);
    return () => worker.removeEventListener("message", listener);
  }, []);
  useEffect(() => {
    if (
      busy ||
      playing ||
      tab !== "review" ||
      !position ||
      !matrix ||
      matrix.provisional ||
      position.phase === "ended" ||
      settled !== position.index
    )
      return;
    const key = `${loaded?.replay.id}:${position.index}:${side}:${oracle}`;
    if (linesPosition.current === key) return;
    linesPosition.current = key;
    const token = latest.current;
    setBusy("Finding best lines…");
    call<Continuation[]>("continuations", {
      index: position.index,
      perspective: side,
      oracle,
    })
      .then((result) => {
        if (token !== latest.current) return;
        setLines(result);
        setBranches((old) => [
          ...old,
          ...result
            .flatMap((line) => line.steps)
            .filter(
              (entry, index, all) =>
                !old.some((item) => item.view.index === entry.view.index) &&
                all.findIndex(
                  (item) => item.view.index === entry.view.index,
                ) === index,
            ),
        ]);
      })
      .catch((error) => {
        if (token === latest.current && error.message !== "Analysis cancelled")
          setError(error.message);
      })
      .finally(() => {
        if (token === latest.current) setBusy("");
      });
  }, [busy, playing, tab, position, matrix, side, oracle, loaded, settled]);
  useLayoutEffect(() => {
    const element = workspaceElement.current;
    if (!element) return;
    let width = element.clientWidth;
    let height = element.getBoundingClientRect().height;
    element.style.minHeight = `${height}px`;
    const observer = new ResizeObserver(() => {
      if (element.clientWidth !== width) {
        width = element.clientWidth;
        height = 0;
        element.style.minHeight = "";
      }
      height = Math.max(height, element.getBoundingClientRect().height);
      element.style.minHeight = `${height}px`;
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [loaded]);
  useEffect(() => {
    const element = logElement.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [battleLog]);
  const previousIndex =
    position && position.index < 0
      ? branches.find((branch) => branch.view.index === position.index)?.parent
      : Math.max(0, (position?.index ?? 0) - 1);
  useEffect(() => {
    if (!playing || busy || !position || !loaded || settled !== position.index)
      return;
    if (
      position.index >= loaded.positions.length ||
      position.phase === "ended"
    ) {
      setPlaying(false);
      return;
    }
    if (position.index < 0) void continueLine(undefined, true);
    else void review(position.index + 1, side, oracle, true);
  }, [playing, busy, position, loaded, settled, matrix]);
  useEffect(() => {
    const navigate = (event: KeyboardEvent) => {
      if (
        !loaded ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        (event.target instanceof Element &&
          event.target.closest(
            'input, select, textarea, button, [contenteditable="true"]',
          ))
      )
        return;
      if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
        event.preventDefault();
        if (event.key === "ArrowLeft") {
          if (previousIndex !== undefined) void review(previousIndex);
        } else if (position && position.index < 0) {
          void continueLine();
        } else {
          void review(
            Math.max(
              0,
              Math.min(loaded.positions.length, (position?.index ?? 0) + 1),
            ),
          );
        }
      } else if (event.code === "Space") {
        event.preventDefault();
        setPlaying((value) => !value);
      }
    };
    window.addEventListener("keydown", navigate);
    return () => window.removeEventListener("keydown", navigate);
  }, [loaded, position, side, oracle, previousIndex]);
  function switchSide(next: Side) {
    setPlaying(false);
    setSide(next);
    setTimeline([]);
    void review(position?.index ?? 0, next, oracle);
  }
  async function openReplay(replay: Replay) {
    setPlaying(false);
    evaluationContext.current = { index: 0, perspective: 0, oracle };
    setSettled(null);
    reviewingBattle.current = true;
    setError("");
    setBusy("Reconstructing replay in your browser…");
    setProgress(0);
    setMatrix(null);
    setPositionValue(null);
    setTimeline([]);
    setBranches([]);
    try {
      const result = await call<Loaded>("load", { replay });
      setLoaded(result);
      setBranches(result.branches);
      setSide(0);
      setPosition(await call<PositionView>("view", { index: 0, perspective: 0, oracle }));
      setRow(null);
      setCol(null);
      setBusy("Analysing replay positions…");
      const overview = await call<AnalysisPoint[]>("overview", {
        perspective: 0,
        oracle,
      });
      setTimeline(overview);
      await reviewAll(0, oracle, 0);
    } catch (e) {
      setError(String((e as Error).message));
      setBusy("");
    }
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    try {
      const url = new URL(link.includes("://") ? link : `https://${link}`);
      if (url.hostname !== "replay.pokemonshowdown.com")
        throw new Error("Paste a replay.pokemonshowdown.com replay link.");
      const path = url.pathname.replace(/\.(json|log)$/, "").replace(/\/$/, "");
      if (!/^\/gen9randombattle-[a-z0-9-]+$/i.test(path))
        throw new Error("Please use a Gen 9 Random Battle replay.");
      setBusy("Fetching replay…");
      const response = await fetch(
        `https://replay.pokemonshowdown.com${path}.json`,
      );
      if (!response.ok)
        throw new Error(
          `Replay not found (${response.status}). Check the link or import its JSON file.`,
        );
      await openReplay(await response.json());
    } catch (e) {
      setError((e as Error).message);
      setBusy("");
    }
  }
  async function interruptReview() {
    const token = ++latest.current;
    if (requests.size) {
      worker.postMessage({ type: "cancel" });
      await Promise.allSettled(
        [...requests.values()].map((request) => request.promise),
      );
    }
    return token;
  }
  async function review(
    index: number,
    perspective = side,
    reveal = oracle,
    autoplay = false,
  ) {
    if (!autoplay) setPlaying(false);
    evaluationContext.current = { index, perspective, oracle: reveal };
    setSettled(null);
    setLines([]);
    linesPosition.current = "";
    const immediate =
      index >= 0
        ? loaded?.positions[index]
        : branches.find((branch) => branch.view.index === index)?.view;
    const token = await interruptReview();
    if (token !== latest.current) return;
    setError("");
    setBusy("Building one-turn payoff matrix…");
    setProgress(0);
    setRow(null);
    setCol(null);
    setMatrix(null);
    setPositionValue(null);
    if (index >= 0) setReplayIndex(index);
    if (loaded && index === loaded.positions.length) {
      setPosition({
        ...loaded.positions.at(-1)!,
        index,
        phase: "ended",
        log: loaded.replay.log.split("\n"),
        actions: [[], []],
        played: [],
      });
      setPositionValue(
        loaded.outcome
          ? perspective === 0
            ? loaded.outcome.value
            : 1 - loaded.outcome.value
          : null,
      );
      setBusy("");
      return;
    }
    try {
      const view =
        immediate && oracle && reveal && perspective === side
          ? immediate
          : await call<PositionView>("view", {
              index,
              perspective,
              oracle: reveal,
            });
      if (token !== latest.current) return;
      setPosition(view);
      if (perspective !== side || reveal !== oracle || !timeline.length) {
        setTimeline(
          await call<AnalysisPoint[]>("overview", {
            perspective,
            oracle: reveal,
          }),
        );
      }
      const result = await call<Matrix>("analyze", {
        index,
        perspective,
        oracle: reveal,
      });
      if (token !== latest.current) return;
      setMatrix(result);
      setPositionValue(result.value);
      if (index >= 0)
        setTimeline((old) =>
          [
            ...old.filter((p) => p.index !== index),
            {
              index,
              turn: view.turn,
              provisional: result.provisional,
              approximate: result.approximate,
              value: result.value,
              luck: result.luck,
              luckVariance: result.luckVariance,
              luckSwing: result.luckSwing,
              luckEvents: result.luckEvents,
              regret: result.regret,
              opponentRegret: result.opponentRegret,
              grade: result.grades[result.played[0]]?.label,
              opponentGrade: result.opponentGrades[result.played[1]]?.label,
              events: result.events,
            },
          ].sort((a, b) => a.index - b.index),
        );
      if (index >= 0 && reviewingBattle.current)
        await reviewAll(perspective, reveal, index);
    } catch (e) {
      if (
        token === latest.current &&
        (e as Error).message !== "Analysis cancelled"
      )
        setError((e as Error).message);
    } finally {
      if (token === latest.current) setBusy("");
    }
  }
  async function example() {
    setBusy("Loading example replay…");
    try {
      const r = await fetch("/example.json");
      await openReplay(await r.json());
    } catch (e) {
      setError((e as Error).message);
      setBusy("");
    }
  }
  function chooseAction(index: number | null, opponentChoice = false) {
    if (
      !matrix ||
      settled !== position?.index ||
      (matrix.rows[0]?.kind === "pass" && matrix.columns[0]?.kind === "pass")
    )
      return;
    const nextRow = opponentChoice ? row : index;
    const nextCol = opponentChoice ? index : col;
    setRow(nextRow);
    setCol(nextCol);
    const r = nextRow ?? (matrix.rows[0]?.kind === "pass" ? 0 : null);
    const c = nextCol ?? (matrix.columns[0]?.kind === "pass" ? 0 : null);
    if (r !== null && c !== null) void continueLine({ row: r, col: c });
  }
  async function continueLine(
    pair?: { row: number; col: number },
    autoplay = false,
  ) {
    if (!autoplay) setPlaying(false);
    if (
      !matrix ||
      (!pair && matrix.provisional) ||
      !position ||
      position.phase === "ended"
    )
      return;
    const r = pair?.row ?? matrix.best;
    const c =
      pair?.col ??
      matrix.opponentMoveValues.indexOf(Math.max(...matrix.opponentMoveValues));
    setRow(null);
    setCol(null);
    reviewingBattle.current = false;
    const pending = interruptReview();
    setBusy("Exploring continuation…");
    setError("");
    try {
      const token = await pending;
      if (token !== latest.current) return;
      const branch = await call<Branch>("branch", {
        index: position.index,
        perspective: side,
        oracle,
        ownAction: matrix.rows[r].id,
        opponentAction: matrix.columns[c].id,
      });
      if (token !== latest.current) return;
      setBranches((old) =>
        old.some((entry) => entry.view.index === branch.view.index)
          ? old
          : [...old, branch],
      );
      await review(branch.view.index, side, oracle, autoplay);
    } catch (e) {
      if ((e as Error).message !== "Analysis cancelled")
        setError((e as Error).message);
      setPlaying(false);
      if (!requests.size) setBusy("");
    }
  }
  async function reviewAll(
    perspective = side,
    reveal = oracle,
    index = position?.index ?? 0,
  ) {
    const token = latest.current;
    reviewingBattle.current = true;
    setBusy("Analysing battle…");
    setProgress(0);
    try {
      const result = await call<{ complete: boolean }>("timeline", {
        perspective,
        oracle: reveal,
        index: Math.max(0, index),
      });
      if (token === latest.current && result.complete)
        reviewingBattle.current = false;
    } catch (e) {
      if (
        token === latest.current &&
        (e as Error).message !== "Analysis cancelled"
      )
        setError((e as Error).message);
    } finally {
      if (token === latest.current) setBusy("");
    }
  }
  const opponent = (1 - side) as Side;
  const names = position?.players ||
    loaded?.replay.players || ["Player 1", "Player 2"];
  const bestRow = matrix
    ? col === null
      ? matrix.best
      : matrix.values
          .map((v) => v[col])
          .indexOf(Math.max(...matrix.values.map((v) => v[col])))
    : 0;
  const bestCol = matrix
    ? row === null
      ? matrix.opponentMoveValues.indexOf(
          Math.max(...matrix.opponentMoveValues),
        )
      : matrix.values[row].indexOf(Math.min(...matrix.values[row]))
    : 0;
  const reviewed = timeline.filter((point) => !point.provisional);
  const chanceEvents = reviewed.flatMap((point) =>
    point.luckEvents.map((event, eventIndex) => ({
      ...point,
      event,
      eventIndex,
      luck: summarizeLuck([event], side).score!,
    })),
  );
  const netLuck = summarizeLuck(
    chanceEvents.map(({ event }) => event),
    side,
  ).score;
  const luckGroups = new Map<
    string,
    { kind: string; side: Side; events: typeof chanceEvents }
  >();
  for (const event of chanceEvents) {
    const key = `${event.event.side}:${event.event.kind}`;
    const group = luckGroups.get(key) ?? {
      kind: event.event.kind,
      side: event.event.side,
      events: [],
    };
    group.events.push(event);
    luckGroups.set(key, group);
  }
  const rankedMoments = [
    { title: "Unlucky events", sign: -1 },
    { title: "Lucky events", sign: 1 },
  ].map((group) => ({
    ...group,
    moments: chanceEvents
      .filter((point) => group.sign * point.luck >= 1)
      .sort((a, b) => group.sign * (b.luck - a.luck)),
  }));
  const ownScore = timeline.filter((p) => p.regret !== null);
  const foeScore = timeline.filter((p) => p.opponentRegret !== null);
  const a1 = accuracy(ownScore.map((point) => point.regret!)),
    a2 = accuracy(foeScore.map((point) => point.opponentRegret!));
  return (
    <>
      <header className="site-header">
        <div className="brand">
          <span className="pokeball" />
          <strong>
            Poke<span>Critic</span>
          </strong>
          <small>replay analysis</small>
        </div>
        <nav>
          <button className="nav-active">Analyze</button>
          <a
            href="https://replay.pokemonshowdown.com/"
            target="_blank"
            rel="noreferrer"
          >
            Replays <ExternalLink size={12} />
          </a>
          <button onClick={() => setHelp(true)}>How it works</button>
          <button aria-label="Settings" onClick={() => setSettings(!settings)}>
            <Settings size={17} />
          </button>
        </nav>
      </header>
      <main>
        <form className="replay-form" onSubmit={submit}>
          <Link size={17} />
          <select aria-label="Format" defaultValue="gen9randombattle">
            <option value="gen9randombattle">Gen 9 Random Battle</option>
          </select>
          <input
            aria-label="Replay link"
            value={link}
            onChange={(e) => setLink(e.target.value)}
            placeholder="Paste a Pokémon Showdown replay link…"
          />
          <button className="primary" disabled={!!busy}>
            Analyze replay
          </button>
          <button
            type="button"
            className="plain"
            disabled={!!busy}
            onClick={() => file.current?.click()}
          >
            Import JSON
          </button>
          <input
            hidden
            ref={file}
            type="file"
            accept=".json"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (f) {
                try {
                  await openReplay(JSON.parse(await f.text()));
                } catch {
                  setError("This is not a valid replay JSON file.");
                }
                e.target.value = "";
              }
            }}
          />
        </form>
        {settings && (
          <section className="settings">
            <b>Analysis settings</b>
            <span>
              Fixed-seed review. Each action pair is simulated once, without
              rerolls.
            </span>
            <span>
              Depth: one simultaneous turn. Continuations are explored on
              demand.
            </span>
            <span>
              Local BCE critic · {health?.backend || "Loading model…"}
            </span>
            {position && (
              <button disabled={!!busy} onClick={() => review(position.index)}>
                Recalculate position
              </button>
            )}
          </section>
        )}
        {error && (
          <div role="alert" className="error">
            <b>Analysis stopped.</b> {error}
            <button onClick={() => setError("")} aria-label="Dismiss error">
              ×
            </button>
          </div>
        )}
        {!loaded ? (
          <section className="welcome">
            <div className="welcome-battle">
              <img
                src={Sprites.getPokemon("gengar", { gen: "gen5" }).url}
                alt="Gengar"
              />
              <span>??</span>
              <img
                src={Sprites.getPokemon("alakazam", { gen: "gen5" }).url}
                alt="Alakazam"
              />
            </div>
            <h1>A second look at your battle.</h1>
            <p>Review your moves. Explore what you could have played.</p>
            <button className="primary" disabled={!!busy} onClick={example}>
              Analyze an example replay
            </button>
            <small className={health ? "connected" : "disconnected"}>
              {health ? "Ready · runs on your device" : "Loading engine…"}
            </small>
          </section>
        ) : (
          <>
            <section className="match-header">
              <div>
                <span className="verified">
                  <Check size={12} /> Replay verified
                </span>
                <a
                  href={`https://replay.pokemonshowdown.com/${loaded.replay.id}`}
                  target="_blank"
                  rel="noreferrer"
                  title="Open original replay"
                >
                  <ExternalLink size={12} />
                </a>
              </div>
              <div className="player-heading">
                <strong>{names[side]}</strong>
                <span className="versus">vs.</span>
                <strong>{names[opponent]}</strong>
              </div>
              <div className="match-options">
                <label>
                  Viewing{" "}
                  <select
                    value={side}
                    onChange={(e) => switchSide(Number(e.target.value) as Side)}
                  >
                    <option value={0}>{names[0]}</option>
                    <option value={1}>{names[1]}</option>
                  </select>
                </label>
                <div>
                  <label>
                    <input type="checkbox" checked={oracle} disabled aria-describedby="oracle-unavailable" />{" "}
                    Oracle · all revealed
                  </label>
                  <small id="oracle-unavailable" style={{ display: "block" }}>
                    Unavailable until Oracle model training is complete.
                  </small>
                </div>
              </div>
            </section>
            <div className="workspace" ref={workspaceElement}>
              <section className="battle-panel panel">
                <div className="panel-title">
                  <b>Battlefield</b>
                  <span>
                    {position && position.index < 0
                      ? "Exploring variation"
                      : `Turn ${position?.turn || 1}`}{" "}
                    <small>/ {loaded.positions.at(-1)?.turn}</small>
                  </span>
                  <span className={`mode ${oracle ? "oracle" : ""}`}>
                    <Eye size={12} />
                    {oracle
                      ? "Oracle · experimental"
                      : "Masked critic · hindsight-assisted"}
                  </span>
                </div>
                <div className="opponent-choices">
                  <div className="section-caption">
                    <b>Opponent's reply</b>
                    <button
                      className="plain"
                      disabled={row === null && col === null}
                      onClick={() => {
                        setRow(null);
                        setCol(null);
                      }}
                    >
                      Clear choices
                    </button>
                  </div>
                  <ActionChoices
                    key={`${loaded.replay.id}:${position?.index}:${opponent}`}
                    actions={
                      matrix?.columns ||
                      displayPosition?.actions[opponent] ||
                      []
                    }
                    selected={col}
                    onSelect={(index) => chooseAction(index, true)}
                    className="reply-grid"
                    suggested={matrix ? bestCol : undefined}
                    ended={
                      matrix?.rows[0]?.kind === "pass" &&
                      matrix?.columns[0]?.kind === "pass"
                    }
                  >
                    {(a, i) => (
                      <ActionButton
                        key={a.id}
                        action={a}
                        selected={col === i}
                        best={
                          !!matrix &&
                          (row !== null
                            ? Math.abs(
                                matrix.values[row][i] -
                                  matrix.values[row][bestCol],
                              ) < 1e-7
                            : Math.abs(
                                matrix.opponentMoveValues[i] -
                                  matrix.opponentMoveValues[bestCol],
                              ) < 1e-7)
                        }
                        played={matrix?.played[1] === i}
                        value={
                          matrix
                            ? row !== null
                              ? 1 - matrix.values[row][i]
                              : matrix.opponentMoveValues[i]
                            : undefined
                        }
                        assessment={row === null ? matrix?.opponentGrades[i] : undefined}
                        onClick={() => chooseAction(col === i ? null : i, true)}
                      />
                    )}
                  </ActionChoices>
                  {!matrix && (
                    <p className="muted">
                      {busy
                        ? "Calculating legal replies…"
                        : "Select a position to analyze."}
                    </p>
                  )}
                </div>
                <div className="battle-body">
                  <div
                    className="eval-bar"
                    aria-label={`${oracle ? "Oracle" : "Masked"} win probability for ${names[side]} ${displayValue === null ? "unavailable" : percent(displayValue)}`}
                    title={`White: ${names[side]}; black: ${names[opponent]}. ${oracle ? "All information revealed" : "Player-visible information"}.`}
                  >
                    <span>100%</span>
                    <div className="eval-track">
                      <div
                        style={{
                          height: `${(displayValue ?? 0.5) * 100}%`,
                        }}
                      />
                      <i />
                      <b
                        style={{
                          bottom: `${Math.min(93, Math.max(4, (displayValue ?? 0.5) * 100))}%`,
                        }}
                      >
                        {displayValue === null ? "—" : percent(displayValue)}
                      </b>
                    </div>
                    <span>0%</span>
                  </div>
                  {position && (
                    <Battlefield
                      position={position}
                      side={side}
                      oracle={oracle}
                      replay={loaded.replay.id}
                      onLog={setBattleLog}
                      playing={playing}
                      onSettled={setSettled}
                    />
                  )}
                </div>
                <div className="replay-controls">
                  <button
                    aria-label={playing ? "Pause replay" : "Play replay"}
                    onClick={() => {
                      if (
                        !playing &&
                        position?.index === loaded.positions.length
                      )
                        void review(0, side, oracle, true);
                      setPlaying(!playing);
                    }}
                  >
                    {playing ? <Pause size={17} /> : <Play size={17} />}
                  </button>
                  <button aria-label="First turn" onClick={() => review(0)}>
                    <ChevronsLeft size={17} />
                  </button>
                  <button
                    aria-label="Previous turn"
                    disabled={
                      position?.index === 0 || previousIndex === undefined
                    }
                    onClick={() =>
                      previousIndex !== undefined && void review(previousIndex)
                    }
                  >
                    <ChevronLeft size={17} />
                  </button>
                  <select
                    aria-label="Select turn"
                    value={Math.max(0, position?.index || 0)}
                    onChange={(e) => {
                      void review(Number(e.target.value));
                    }}
                  >
                    {loaded.positions.map((p) => (
                      <option key={p.index} value={p.index}>
                        Turn {p.turn}
                        {p.phase === "switch" ? " · switch" : ""}
                      </option>
                    ))}
                    <option value={loaded.positions.length}>
                      Battle ended
                    </option>
                  </select>
                  <button
                    aria-label="Next turn"
                    disabled={position?.index === loaded.positions.length}
                    onClick={() =>
                      position && position.index < 0
                        ? void continueLine()
                        : review(
                            Math.min(
                              loaded.positions.length,
                              (position?.index || 0) + 1,
                            ),
                          )
                    }
                  >
                    <ChevronRight size={17} />
                  </button>
                  <button
                    aria-label="Last turn"
                    onClick={() => review(loaded.positions.length)}
                  >
                    <ChevronsRight size={17} />
                  </button>
                  <button
                    onClick={() => switchSide(opponent)}
                    title="Switch sides"
                  >
                    <ArrowLeftRight size={15} /> Switch sides
                  </button>
                  <span>
                    {position?.phase === "ended"
                      ? "Battle ended"
                      : position && position.index < 0
                        ? `Exploring · ${branches.length} decisions`
                        : `Decision ${(position?.index ?? 0) + 1} / ${loaded.positions.length}`}
                  </span>
                </div>
                {matrix && (
                  <div
                    className="played-grades"
                    aria-label="Played move grades"
                  >
                    {[0, 1].map((player) => {
                      const played = matrix.played[player];
                      const action = (player ? matrix.columns : matrix.rows)[
                        played
                      ];
                      const assessment = (
                        player ? matrix.opponentGrades : matrix.grades
                      )[played];
                      return (
                        <div
                          key={player}
                          title={names[player ? opponent : side]}
                        >
                          {action && assessment && (
                            <>
                              <GradeIcon assessment={assessment} />
                              <span>
                                {player ? "Opp move: " : "Your move: "}
                                {action.label}
                                {action.tera ? " + Tera" : ""} ·{" "}
                                {assessment.label}
                              </span>
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
                <div className="choices">
                  <div className="section-caption">
                    <b>Your choices</b>
                  </div>
                  <ActionChoices
                    key={`${loaded.replay.id}:${position?.index}:${side}`}
                    actions={
                      matrix?.rows || displayPosition?.actions[side] || []
                    }
                    selected={row}
                    onSelect={(index) => chooseAction(index)}
                    className="action-grid"
                    suggested={matrix ? bestRow : undefined}
                    ended={
                      matrix?.rows[0]?.kind === "pass" &&
                      matrix?.columns[0]?.kind === "pass"
                    }
                  >
                    {(a, i) => (
                      <ActionButton
                        key={a.id}
                        action={a}
                        selected={row === i}
                        best={
                          !!matrix &&
                          (col !== null
                            ? Math.abs(
                                matrix.values[i][col] -
                                  matrix.values[bestRow][col],
                              ) < 1e-7
                            : Math.abs(
                                matrix.moveValues[i] -
                                  matrix.moveValues[bestRow],
                              ) < 1e-7)
                        }
                        played={matrix?.played[0] === i}
                        regret={
                          matrix && !matrix.provisional && col === null
                            ? Math.max(
                                0,
                                Math.max(...matrix.moveValues) -
                                  matrix.moveValues[i],
                              )
                            : undefined
                        }
                        assessment={
                          col === null ? matrix?.grades[i] : undefined
                        }
                        value={
                          matrix
                            ? col !== null
                              ? matrix.values[i][col]
                              : matrix.moveValues[i]
                            : undefined
                        }
                        onClick={() => chooseAction(row === i ? null : i)}
                      />
                    )}
                  </ActionChoices>
                </div>
              </section>
              <aside className="review-panel panel">
                <div className="panel-title">
                  <b>Battle log</b>
                </div>
                <div
                  ref={logElement}
                  role="log"
                  aria-label="Battle log"
                  className="battle-log"
                  dangerouslySetInnerHTML={{ __html: battleLog }}
                />
                <div className="panel-title">
                  <b>Engine review</b>
                  {position && position.index < 0 && (
                    <button
                      className="plain"
                      disabled={!!busy}
                      onClick={() => {
                        void review(replayIndex);
                      }}
                    >
                      Return to replay
                    </button>
                  )}
                </div>
                <div className="review-tabs">
                  <button
                    className={tab === "review" ? "active" : ""}
                    onClick={() => setTab("review")}
                  >
                    Move review
                  </button>
                  <button
                    className={tab === "moves" ? "active" : ""}
                    onClick={() => setTab("moves")}
                  >
                    Moves {branches.length > 0 && `(${branches.length} saved)`}
                  </button>
                </div>
                {tab === "review" && (
                  <div className="review-content">
                    {matrix ? (
                      <>
                        {matrix.provisional && (
                          <p className="note" role="status">
                            Comparing actions · {percent(matrix.coverage)}{" "}
                            complete
                          </p>
                        )}
                        <div className="continuation-controls">
                          <button
                            className="continue-button best-next"
                            disabled={
                              matrix.provisional ||
                              settled !== position?.index ||
                              (!!busy && !reviewingBattle.current) ||
                              playing ||
                              position?.phase === "ended"
                            }
                            onClick={() => void continueLine()}
                          >
                            <ChevronRight size={15} /> Best next move
                          </button>
                          <button
                            className="continue-button best-until"
                            disabled={
                              matrix.provisional ||
                              settled !== position?.index ||
                              (!!busy && !reviewingBattle.current) ||
                              playing ||
                              position?.phase === "ended"
                            }
                            onClick={() => {
                              setPlaying(true);
                              void continueLine(undefined, true);
                            }}
                          >
                            <Play size={15} /> Best until end
                          </button>
                        </div>
                        <section className="best-lines" aria-label="Best lines">
                          <h3>Best lines</h3>
                          <p className="note">Each line shows the strongest reply to that move; its percentage evaluates the first action pair. Move grades use the opponent’s Nash mixture instead. Up to two decisions shown, evaluated one turn at a time.</p>
                          {!lines.length && <p role="status">{position?.phase === "ended" ? "Battle ended" : "Finding best lines…"}</p>}
                          {lines.map((line, rank) => (
                            <article key={rank}>
                              <header>
                                <b>Line {rank + 1}</b>
                                <strong>{percent(line.value)}</strong>
                              </header>
                              {line.steps.map((step) => (
                                <button
                                  key={step.view.index}
                                  className="move-row"
                                  onClick={() => {
                                    reviewingBattle.current = false;
                                    void review(step.view.index);
                                  }}
                                >
                                  <small>
                                    Turn{" "}
                                    {step.parent >= 0
                                      ? loaded.positions[step.parent]?.turn
                                      : branches.find(
                                          (entry) =>
                                            entry.view.index === step.parent,
                                        )?.view.turn}
                                  </small>
                                  {[side, opponent].map((player) => (
                                    <span key={player}>
                                      <small>{names[player]}</small>
                                      <br />
                                      {step.actions[player].kind === "switch"
                                        ? "Switch → "
                                        : ""}
                                      {step.actions[player].label}
                                      {step.actions[player].tera
                                        ? " + Tera"
                                        : ""}
                                    </span>
                                  ))}
                                </button>
                              ))}
                            </article>
                          ))}
                        </section>
                      </>
                    ) : (
                      <div className="calculating">
                        {busy ? <LoaderCircle className="spin" /> : <Info />}
                        <p>
                          {busy
                            ? "Evaluating action pairs…"
                            : "Engine results will appear here."}
                        </p>
                      </div>
                    )}
                  </div>
                )}
                {tab === "moves" && loaded && (
                  <MoveHistory
                    loaded={loaded}
                    branches={branches}
                    selected={position?.index ?? 0}
                    onSelect={(index) => {
                      reviewingBattle.current = false;
                      void review(index);
                    }}
                  />
                )}
              </aside>
            </div>
            <section className="panel timeline-panel">
              <div className="panel-title">
                <b>
                  Win probability <small>— {names[side]}'s perspective</small>
                </b>
                <div className="legend">
                  <span>
                    <i className="line-swatch" /> Evaluation
                  </span>
                  <span>
                    <Clover size={12} /> Luck
                  </span>
                </div>
                <button disabled={!!busy} onClick={() => reviewAll()}>
                  <Play size={12} /> Resume battle review
                </button>
              </div>
              <div className="chart">
                <div className="chart-labels">
                  <span>100%</span>
                  <span>50%</span>
                  <span>0%</span>
                </div>
                <svg
                  viewBox="0 0 1000 130"
                  preserveAspectRatio="none"
                  aria-label="Win probability by decision"
                >
                  <line x1="0" x2="1000" y1="65" y2="65" className="gridline" />
                  <line x1="0" x2="1000" y1="5" y2="5" className="gridline" />
                  <line
                    x1="0"
                    x2="1000"
                    y1="125"
                    y2="125"
                    className="gridline"
                  />
                  {timeline.map((p, i) => {
                    const x =
                        (p.index /
                          Math.max(
                            1,
                            loaded.positions.length - (loaded.outcome ? 0 : 1),
                          )) *
                          980 +
                        10,
                      y = 125 - p.value * 120;
                    const previous = timeline[i - 1];
                    return (
                      <g
                        key={p.index}
                        onClick={() => review(p.index)}
                        className="chart-point"
                      >
                        <title>{`Turn ${p.turn}: ${percent(p.value)}${p.provisional ? " · provisional position estimate" : p.approximate ? " · approximate review" : ""}${p.luck === null ? "" : `, luck ${luckLabel(p.luck)}`}`}</title>
                        {previous && previous.index === p.index - 1 && (
                          <line
                            x1={
                              (previous.index /
                                Math.max(
                                  1,
                                  loaded.positions.length -
                                    (loaded.outcome ? 0 : 1),
                                )) *
                                980 +
                              10
                            }
                            x2={x}
                            y1={125 - previous.value * 120}
                            y2={y}
                            className="probability-line"
                          />
                        )}
                        <circle
                          cx={x}
                          cy={y}
                          r={p.index === position?.index ? 5 : 3}
                          className="probability-dot"
                          opacity={p.provisional ? 0.5 : 1}
                        />
                        {p.luck !== null && Math.abs(p.luck) >= 1 && (
                          <Clover
                            x={x - 7}
                            y={
                              p.luck > 0
                                ? Math.max(0, y - 25)
                                : Math.min(109, y + 5)
                            }
                            width={14}
                            height={14}
                            className="luck-marker"
                          />
                        )}
                        {((p.regret ?? 0) > 0.02 ||
                          p.grade === "Great" ||
                          p.grade === "Brilliant") && (
                          <text
                            x={x}
                            y="16"
                            textAnchor="middle"
                            className="grade-marker"
                          >
                            {p.grade === "Brilliant"
                              ? "!!"
                              : p.grade === "Great"
                                ? "!"
                                : grade(p.regret).symbol}
                          </text>
                        )}
                      </g>
                    );
                  })}
                  {loaded.outcome && timeline.length > 0 && (
                    <g className="battle-result">
                      <title>
                        {loaded.outcome.winner === "Tie"
                          ? "Tie"
                          : `${loaded.outcome.winner} won`}
                      </title>
                      <line
                        x1={
                          10 +
                          (timeline.at(-1)!.index /
                            Math.max(1, loaded.positions.length)) *
                            980
                        }
                        y1={125 - timeline.at(-1)!.value * 120}
                        x2={990}
                        y2={
                          125 -
                          (side === 0
                            ? loaded.outcome.value
                            : 1 - loaded.outcome.value) *
                            120
                        }
                        className="probability-line"
                      />
                      <circle
                        cx={990}
                        cy={
                          125 -
                          (side === 0
                            ? loaded.outcome.value
                            : 1 - loaded.outcome.value) *
                            120
                        }
                        r={4}
                        className="probability-dot"
                      />
                    </g>
                  )}
                </svg>
              </div>
              <div className="turn-axis">
                {loaded.positions
                  .filter(
                    (_, i) =>
                      i %
                        Math.max(
                          1,
                          Math.floor(loaded.positions.length / 12),
                        ) ===
                      0,
                  )
                  .map((p) => (
                    <button key={p.index} onClick={() => review(p.index)}>
                      {p.turn}
                    </button>
                  ))}
              </div>
              <div className="timeline-caption">
                <span>
                  {timeline.length} / {loaded.positions.length} positions
                  evaluated · {timeline.filter((p) => !p.provisional).length}{" "}
                  reviewed.
                  {timeline.some((p) => p.provisional) &&
                    " Faded points are provisional position estimates."}
                </span>
                <span>Click a point to review that turn</span>
              </div>
            </section>
            <div className="bottom-grid">
              <section className="panel luck-panel">
                <div className="panel-title">
                  <b>
                    <Clover size={15} /> Luck-o-meter
                  </b>
                </div>
                <div className="luck-total">
                  <strong
                    className={(netLuck ?? 0) < 0 ? "negative" : "positive"}
                  >
                    {reviewed.length > 0 ? luckLabel(netLuck) : "—"}
                  </strong>
                  <span>
                    {reviewed.length === loaded.positions.length
                      ? `Whole game · ${names[side]}`
                      : `Partial total · ${reviewed.length} / ${loaded.positions.length} decisions reviewed`}
                  </span>
                </div>
                <div className="luck-track">
                  <span>Favors opponent</span>
                  <div>
                    <i
                      style={{
                        left: `${50 + Math.max(-2, Math.min(2, netLuck ?? 0)) * 23}%`,
                      }}
                    />
                    <b />
                  </div>
                  <span>Favors you</span>
                </div>
                <table className="luck-counts">
                  <thead>
                    <tr>
                      <th>Chance checks</th>
                      <th>Actual / Expected</th>
                      <th>Luck</th>
                    </tr>
                  </thead>
                  {[side, opponent].map((player) => (
                    <tbody
                      key={player}
                      className={player === side ? "luck-own" : "luck-opponent"}
                    >
                      <tr className="luck-player">
                        <th colSpan={3} scope="rowgroup">
                          {player === side ? "Your side" : "Opponent"} ·{" "}
                          {names[player]}
                        </th>
                      </tr>
                      {[...luckGroups.values()]
                        .filter((group) => group.side === player)
                        .map((group) => {
                          const events = group.events.map(
                            (entry) => entry.event,
                          );
                          return (
                            <tr key={`${group.side}:${group.kind}`}>
                              <th scope="row">{group.kind}</th>
                              <td>
                                {
                                  events.filter((event) => event.occurred)
                                    .length
                                }{" "}
                                /{" "}
                                {events
                                  .reduce(
                                    (sum, event) => sum + event.probability,
                                    0,
                                  )
                                  .toFixed(2)}{" "}
                                <small>({events.length} checks)</small>
                              </td>
                              <td>
                                {luckLabel(summarizeLuck(events, side).score)}
                              </td>
                            </tr>
                          );
                        })}
                    </tbody>
                  ))}
                </table>
              </section>
              <section className="panel scorecard">
                <div className="panel-title">
                  <b>Match scorecard</b>
                  <span>
                    {timeline.filter((p) => !p.provisional).length} decisions
                    reviewed
                  </span>
                </div>
                <table>
                  <thead>
                    <tr>
                      <th>{names[side]}</th>
                      <th>Move quality</th>
                      <th>{names[opponent]}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="accuracy-row">
                      <td>
                        <strong>
                          {a1 === null ? "—" : `${a1.toFixed(1)}%`}
                        </strong>
                      </td>
                      <th>Accuracy</th>
                      <td>
                        <strong>
                          {a2 === null ? "—" : `${a2.toFixed(1)}%`}
                        </strong>
                      </td>
                    </tr>
                    {[
                      {
                        label: "Brilliant",
                        symbol: "!!",
                        className: "brilliant",
                      },
                      { label: "Great", symbol: "!", className: "great" },
                      ...GRADES,
                    ].map((g) => {
                      const label = g.label;
                      return (
                        <tr key={label}>
                          <td>
                            {
                              timeline.filter(
                                (p) =>
                                  (p.grade || grade(p.regret).label) === label,
                              ).length
                            }
                          </td>
                          <th>
                            <GradeIcon assessment={g} />
                            {label}
                          </th>
                          <td>
                            {foeScore.length
                              ? timeline.filter(
                                  (p) =>
                                    (p.opponentGrade ||
                                      grade(p.opponentRegret).label) === label,
                                ).length
                              : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <details className="note">
                  <summary>How grades work</summary>
                  <small>
                    Review score = 100 × exp(−5 × root-mean-square regret).
                    Squared losses penalize blunders more than small
                    inaccuracies. Unobserved decisions are excluded. This is not
                    Chess.com’s proprietary CAPS2 formula. Thresholds: Best
                    &lt;0.5 pp; Excellent &lt;1 pp; Good &lt;2 pp; Inaccuracy
                    &lt;5 pp; Mistake &lt;12 pp; Blunder ≥12 pp. These are
                    product conventions, not calibrated skill ratings. Brilliant
                    is a low-regret sacrifice: ≥50% expected chance of losing a
                    Pokémon, ≥5 pp better than every low-sacrifice alternative,
                    and 50–95% expected win value. Great is the only
                    Good-or-better choice when alternatives exist; Brilliant
                    takes precedence.
                  </small>
                </details>
              </section>
            </div>
            <section className="panel luck-events-panel">
              <div className="panel-title">
                <b>Luck events</b>
              </div>
              <div className="luck-split">
                {rankedMoments.map((group) => (
                  <section key={group.sign}>
                    <h3>{group.title}</h3>
                    {group.moments.length === 0 && (
                      <p className="note">
                        No events at least 1σ from expectation.
                      </p>
                    )}
                    {group.moments.map((point, rank) => (
                      <button
                        className="luck-event"
                        key={`${point.index}:${point.eventIndex}`}
                        onClick={() => review(point.index)}
                      >
                        <span>
                          {rank + 1}. Turn {point.turn} · decision{" "}
                          {point.index + 1}
                          <br />
                          {point.event.label} ·{" "}
                          {percent(point.event.probability)} chance
                        </span>
                        <b className={group.sign < 0 ? "negative" : "positive"}>
                          {luckLabel(point.luck)}
                        </b>
                      </button>
                    ))}
                  </section>
                ))}
              </div>
            </section>
            <section className="panel matrix-panel">
              <button
                className="matrix-toggle"
                onClick={() => setShowMatrix(!showMatrix)}
              >
                <span>▦ &nbsp; Inspect payoff matrix</span>
                <span>
                  {matrix
                    ? `${matrix.rows.length} × ${matrix.columns.length}`
                    : ""}{" "}
                  {showMatrix ? "▴" : "▾"}
                </span>
              </button>
              {showMatrix && matrix && (
                <>
                  <p>
                    Your win estimate after each pair. Click to select both
                    actions.
                  </p>
                  <div className="matrix-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Your action ↓ / Opponent →</th>
                          {matrix.columns.map((a, j) => (
                            <th key={a.id}>
                              <button
                                className={col === j ? "selected" : ""}
                                onClick={() => setCol(col === j ? null : j)}
                              >
                                {a.label}
                                {a.tera ? " + Tera" : ""}
                              </button>
                            </th>
                          ))}
                          <th>Mix</th>
                        </tr>
                      </thead>
                      <tbody>
                        {matrix.rows.map((a, i) => (
                          <tr key={a.id}>
                            <th>
                              <button
                                className={row === i ? "selected" : ""}
                                onClick={() => setRow(row === i ? null : i)}
                              >
                                {a.label}
                                {a.tera ? " + Tera" : ""}
                                {matrix.played[0] === i ? " · played" : ""}
                              </button>
                            </th>
                            {matrix.values[i].map((v, j) => (
                              <td key={j}>
                                <button
                                  className={`${row === i && col === j ? "selected" : ""} ${col === j && i === bestRow ? "best-cell" : ""}`}
                                  onClick={() => {
                                    setRow(i);
                                    setCol(j);
                                  }}
                                  title={
                                    matrix.counts[i][j]
                                      ? "Evaluated"
                                      : "Pending: this action pair has not been evaluated"
                                  }
                                >
                                  {matrix.counts[i][j] ? percent(v) : "…"}
                                </button>
                              </td>
                            ))}
                            <td>
                              {matrix.provisional ? "…" : percent(matrix.p[i])}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr>
                          <th>Opponent mix</th>
                          {matrix.q.map((q, i) => (
                            <td key={i}>
                              {matrix.provisional ? "…" : percent(q)}
                            </td>
                          ))}
                          <td>
                            {matrix.provisional ? "…" : percent(matrix.value)}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </>
              )}
            </section>
          </>
        )}
        {busy && (
          <div className="status-bar" role="status">
            <LoaderCircle size={15} className="spin" />
            <div className="analysis-progress">
              <div className="analysis-caption">
                <strong>Analysing…</strong>
                <span>{percent(Math.min(1, progress))}</span>
              </div>
              <progress
                aria-label="Analysis progress"
                value={Math.min(1, progress)}
                max={1}
              />
              <small>{busy}</small>
            </div>
            <button
              onClick={() => {
                reviewingBattle.current = false;
                worker.postMessage({ type: "cancel" });
              }}
            >
              <Square size={12} /> Stop
            </button>
          </div>
        )}
        <footer>
          <span>PokeCritic · Made for Random Battles.</span>
          <span>
            Pokémon sprites © their respective owners · Showdown assets{" "}
            <a
              href="https://github.com/smogon/pokemon-showdown-client"
              target="_blank"
              rel="noreferrer"
            >
              source
            </a>
          </span>
          <button className="plain" onClick={() => setHelp(true)}>
            About the numbers
          </button>
        </footer>
      </main>
      {help && (
        <div className="modal-backdrop" onClick={() => setHelp(false)}>
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="help-title"
            className="modal"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="close"
              onClick={() => setHelp(false)}
              aria-label="Close help"
            >
              ×
            </button>
            <h2 id="help-title">What the engine is measuring</h2>
            <p>
              <b>Search runs in your browser.</b> Recorded replay inputs
              reconstruct history. Analysis uses one fixed seed for every action
              pair, with no rerolls. The BCE critic also runs locally, using
              WebGPU when available or WebAssembly on the CPU.
            </p>
            <p>
              <b>The whole replay appears first.</b> The bottom graph initially
              shows critic estimates for every recorded position, plus the
              verified final result. Faded points are provisional. One-turn
              payoff reviews compare actions in the background using one
              fixed-seed outcome per pair. Grades are estimates, not
              RNG-averaged expectations. The loading bar measures work, not
              certainty. Browsing prioritizes the selected turn and then resumes
              background review unless you pressed Stop. Exploring a
              continuation pauses battle review; use Resume battle review to
              continue.
            </p>
            <p>
              <b>One decision, simultaneous choices.</b> Each matrix cell
              simulates once up to the next decision request. KO and pivot
              replacements are separate decisions, even within the same turn.
              The critic values those states without recursively searching them.
              The Nash mixture is solved from the resulting payoff matrix.
            </p>
            <p>
              <b>Information modes.</b> Both modes simulate actual teams. Masked
              mode restricts critic inputs, but simulated outcomes can leak
              hindsight. Oracle gives the critic both private observations;
              full-information calibration has not been validated. Oracle
              combines both perspective estimates into one complementary payoff
              matrix. Both modes grade against the equilibrium defense.
              Selecting a reply displays that specific matchup instead.
            </p>
            <p>
              <b>Luck measures actual RNG checks.</b> Hits, critical hits,
              secondary effects, full paralysis, thawing and confusion checks
              use the original simulator’s effective probabilities and recorded
              RNG. Guaranteed or blocked effects are excluded. The score sums
              signed (actual − expected) counts and divides by √Σp(1−p).
              Opponent luck has the opposite sign. This is an event-count score,
              not win equity or a normal-distribution probability. Damage rolls,
              speed ties, sleep duration, multi-hit counts and chance-based
              ability/item activations are not scored.
            </p>
            <p>
              <b>Estimates have limits.</b> A one-step critic is not perfect
              play. A fixed seed makes results reproducible, not representative
              of all possible rolls. Grades can reward an action that benefits
              from this particular roll. Best means low regret within this
              matrix.
            </p>
            <button className="primary" onClick={() => setHelp(false)}>
              Got it
            </button>
          </section>
        </div>
      )}
    </>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
