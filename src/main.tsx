import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Sprites } from "@pkmn/img";
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Link,
  Settings,
  Info,
  RotateCcw,
  Play,
  Square,
  ExternalLink,
  Check,
  LoaderCircle,
  Eye,
  GitBranch,
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
  Replay,
  PokemonView,
} from "./types";
import { GRADES, grade, percent, points } from "./types";
import "./style.css";

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
function Sprite({
  mon,
  back = false,
  small = false,
}: {
  mon: PokemonView;
  back?: boolean;
  small?: boolean;
}) {
  const image = Sprites.getPokemon(mon.species, {
    gen: "gen5",
    side: back ? "p1" : "p2",
  });
  return (
    <img
      className={`sprite ${small ? "small" : ""} ${mon.fainted ? "fainted" : ""}`}
      src={image.url}
      alt={mon.species}
      style={{ imageRendering: image.pixelated ? "pixelated" : "auto" }}
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
      className={`action type-${action.type.toLowerCase()} ${selected ? "selected" : ""} ${best ? "best-response" : ""}`}
      onClick={onClick}
      aria-pressed={selected}
      title={`${action.label}${best ? " — best response" : ""}`}
    >
      <span className="action-name">
        {action.kind === "switch" ? "↪ " : ""}
        {action.label}
        {action.tera && <span className="tera"> Tera</span>}
      </span>
      <span className="action-detail">
        {action.kind === "move"
          ? action.type
          : action.kind === "switch"
            ? "Switch"
            : "No choice"}
        {played && " · played"}
        <b>
          {best ? "★ " : ""}
          {value !== undefined ? percent(value) : ""}
        </b>
      </span>
      {regret !== undefined && (
        <span
          title={assessment?.reason}
          className={`action-detail ${(assessment || grade(regret)).className}`}
        >
          {(assessment || grade(regret)).label} · {(regret * 100).toFixed(1)} pp
          lost vs equilibrium
        </span>
      )}
    </button>
  );
}
function App() {
  const [link, setLink] = useState("");
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [position, setPosition] = useState<PositionView | null>(null);
  const [matrix, setMatrix] = useState<Matrix | null>(null);
  const [side, setSide] = useState<Side>(0);
  const [oracle, setOracle] = useState(true);
  const [positionValue, setPositionValue] = useState<number | null>(null);
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
  const [settings, setSettings] = useState(false);
  const [help, setHelp] = useState(false);
  const [replayIndex, setReplayIndex] = useState(0);
  const file = useRef<HTMLInputElement>(null);
  const latest = useRef(0);
  const reviewingBattle = useRef(false);
  useEffect(() => {
    call<{ backend: string }>("initialize")
      .then(setHealth)
      .catch((error) =>
        setError(`Local critic failed to load: ${error.message}`),
      );
    const listener = ({ data }: MessageEvent) => {
      if (data.type === "estimate") setMatrix(data.matrix);
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
  async function openReplay(replay: Replay) {
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
      setSide(0);
      setOracle(true);
      setPosition(result.positions[0]);
      setRow(null);
      setCol(null);
      setPositionValue(
        await call<number>("evaluation", { index: 0, perspective: 0 }),
      );
      setBusy("Analysing replay positions…");
      const overview = await call<AnalysisPoint[]>("overview", {
        perspective: 0,
        oracle: true,
      });
      setTimeline(overview);
      await reviewAll(0, true, 0);
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
  async function review(index: number, perspective = side, reveal = oracle) {
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
    try {
      const view = await call<PositionView>("view", {
        index,
        perspective,
        oracle: reveal,
      });
      if (token !== latest.current) return;
      setPosition(view);
      const evaluation = await call<number>("evaluation", {
        index,
        perspective,
      });
      if (token !== latest.current) return;
      setPositionValue(evaluation);
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
              regret: result.regret,
              opponentRegret: result.opponentRegret,
              grade: result.grades[result.played[0]]?.label,
              opponentGrade: result.opponentGrades[result.played[1]]?.label,
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
  async function continueLine(pair?: { row: number; col: number }) {
    if (!matrix || matrix.provisional || !position) return;
    const r =
      pair?.row ??
      row ??
      (col === null
        ? matrix.best
        : matrix.values
            .map((v) => v[col])
            .indexOf(Math.max(...matrix.values.map((v) => v[col]))));
    const c =
      pair?.col ??
      col ??
      matrix.values[r].indexOf(Math.min(...matrix.values[r]));
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
        row: r,
        col: c,
      });
      if (token !== latest.current) return;
      setBranches((old) => [...old, branch]);
      setTab("line");
      if (token === latest.current) setBusy("");
    } catch (e) {
      if ((e as Error).message !== "Analysis cancelled")
        setError((e as Error).message);
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
  const selectedRow = row ?? matrix?.best ?? 0;
  const bestRow = matrix
    ? col === null
      ? matrix.best
      : matrix.values
          .map((v) => v[col])
          .indexOf(Math.max(...matrix.values.map((v) => v[col])))
    : 0;
  const bestCol = matrix
    ? row === null
      ? matrix.q.indexOf(Math.max(...matrix.q))
      : matrix.values[row].indexOf(Math.min(...matrix.values[row]))
    : 0;
  const selectedValue = matrix
    ? row !== null && col !== null
      ? matrix.values[row][col]
      : col !== null
        ? Math.max(...matrix.values.map((v) => v[col]))
        : row !== null
          ? matrix.values[row].reduce((sum, v, j) => sum + v * matrix.q[j], 0)
          : matrix.value
    : (timeline.find((point) => point.index === position?.index)?.value ??
      null);
  const advantage = (value: number) => {
    const score = Number((200 * value - 100).toFixed(2));
    return `${score > 0 ? "+" : ""}${score.toFixed(2)}`;
  };
  const topLines =
    matrix && !matrix.provisional
      ? matrix.rows
          .map((action, row) => {
            const values = matrix.values[row];
            const col = values.indexOf(Math.min(...values));
            return {
              action,
              row,
              col,
              value: values[col],
              strategyValue: values.reduce(
                (sum, value, j) => sum + value * matrix.q[j],
                0,
              ),
            };
          })
          .sort(
            (a, b) =>
              matrix.p[b.row] - matrix.p[a.row] ||
              b.strategyValue - a.strategyValue ||
              b.value - a.value,
          )
          .slice(0, 3)
      : [];
  const currentGrade = matrix?.grades[matrix.played[0]] || grade(null);
  const netLuck = timeline.reduce((sum, p) => sum + (p.luck ?? 0), 0);
  const own = position?.teams[side].find((p) => p.active);
  const opp = position?.teams[opponent].find((p) => p.active);
  const ownScore = timeline.filter((p) => p.regret !== null);
  const foeScore = timeline.filter((p) => p.opponentRegret !== null);
  const accuracy = (list: AnalysisPoint[], foe = false) =>
    list.length
      ? 100 *
        Math.exp(
          (-5 *
            list.reduce(
              (s, p) => s + (foe ? p.opponentRegret! : p.regret!),
              0,
            )) /
            list.length,
        )
      : null;
  const a1 = accuracy(ownScore),
    a2 = accuracy(foeScore, true);
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
                <span className="accuracy">
                  {a1 === null ? "—" : a1.toFixed(1) + "%"}{" "}
                  <small>review score</small>
                </span>
                <span className="versus">vs.</span>
                <strong>{names[opponent]}</strong>
                <span className="accuracy">
                  {a2 === null ? "—" : a2.toFixed(1) + "%"}{" "}
                  <small>review score</small>
                </span>
              </div>
              <div className="match-options">
                <label>
                  Viewing{" "}
                  <select
                    value={side}
                    onChange={(e) => {
                      const next = Number(e.target.value) as Side;
                      setSide(next);
                      setTimeline([]);
                      setBranches([]);
                      void review(
                        Math.max(0, position?.index ?? 0),
                        next,
                        oracle,
                      );
                    }}
                  >
                    <option value={0}>{names[0]}</option>
                    <option value={1}>{names[1]}</option>
                  </select>
                </label>
                <label title="Give the critic both teams’ private information. Experimental: full-information calibration is not established.">
                  <input
                    type="checkbox"
                    checked={oracle}
                    onChange={(e) => {
                      setOracle(e.target.checked);
                      setTimeline([]);
                      setBranches([]);
                      void review(
                        Math.max(0, position?.index ?? 0),
                        side,
                        e.target.checked,
                      );
                    }}
                  />{" "}
                  Oracle · all revealed
                </label>
              </div>
            </section>
            <div className="workspace">
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
                <div className="battle-body">
                  <div
                    className="eval-bar"
                    aria-label={`Full-information win probability ${positionValue === null ? "unavailable" : percent(positionValue)}`}
                    title="Current position, evaluated with both teams revealed in either review mode"
                  >
                    <span>+100</span>
                    <div className="eval-track">
                      <div
                        style={{
                          bottom: `${Math.min(50, (positionValue ?? 0.5) * 100)}%`,
                          height: `${Math.abs((positionValue ?? 0.5) * 100 - 50)}%`,
                          background:
                            (positionValue ?? 0.5) >= 0.5
                              ? "var(--eval-blue)"
                              : "var(--eval-red)",
                        }}
                      />
                      <i />
                      <b
                        style={{
                          bottom: `${Math.min(93, Math.max(4, (positionValue ?? 0.5) * 100))}%`,
                        }}
                      >
                        {positionValue === null
                          ? "—"
                          : advantage(positionValue)}
                      </b>
                    </div>
                    <span>−100</span>
                  </div>
                  <div className="arena">
                    <div className="trainer opponent">
                      <b>{names[opponent]}</b>
                      <div className="team-icons">
                        {Array.from({ length: 6 }, (_, i) => {
                          const mon = position?.teams[opponent][i];
                          return mon ? (
                            <span
                              key={i}
                              title={`${mon.species} · ${Math.round((mon.hp / mon.maxhp) * 100)}%`}
                            >
                              <Sprite mon={mon} small />
                            </span>
                          ) : (
                            <span
                              className="unknown"
                              key={i}
                              title="Unrevealed Pokémon"
                            >
                              ?
                            </span>
                          );
                        })}
                      </div>
                      <small>
                        {position?.conditions[opponent].join(" · ") ||
                          "No hazards"}
                      </small>
                    </div>
                    {opp && (
                      <>
                        <div className="hp-card opp-hp">
                          <b>{opp.species}</b>
                          <small> L{opp.level}</small>
                          <div className="hp">
                            <i
                              style={{
                                width: `${(opp.hp / opp.maxhp) * 100}%`,
                              }}
                            />
                          </div>
                          <span>
                            {Math.ceil((opp.hp / opp.maxhp) * 100)}%{" "}
                            {opp.status || ""}
                            {opp.tera && ` · Tera ${opp.tera}`}
                          </span>
                        </div>
                        <div className="opp-sprite">
                          <Sprite mon={opp} />
                        </div>
                      </>
                    )}
                    <div className="field-condition">{position?.weather}</div>
                    {own && (
                      <>
                        <div className="own-sprite">
                          <Sprite mon={own} back />
                        </div>
                        <div className="hp-card own-hp">
                          <b>{own.species}</b>
                          <small> L{own.level}</small>
                          <div
                            className={`hp ${own.hp / own.maxhp < 0.5 ? "low" : ""}`}
                          >
                            <i
                              style={{
                                width: `${(own.hp / own.maxhp) * 100}%`,
                              }}
                            />
                          </div>
                          <span>
                            {own.hp} / {own.maxhp} {own.status || ""}
                            {own.tera && ` · Tera ${own.tera}`}
                          </span>
                        </div>
                      </>
                    )}
                    <div className="trainer own">
                      <b>{names[side]}</b>
                      <div className="team-icons">
                        {position?.teams[side].map((mon, i) => (
                          <span
                            key={i}
                            title={`${mon.species} · ${Math.round((mon.hp / mon.maxhp) * 100)}%`}
                          >
                            <Sprite mon={mon} small />
                          </span>
                        ))}
                      </div>
                      <small>
                        {position?.conditions[side].join(" · ") || "No hazards"}
                      </small>
                    </div>
                  </div>
                </div>
                <div className="replay-controls">
                  <button aria-label="First turn" onClick={() => review(0)}>
                    <ChevronsLeft size={17} />
                  </button>
                  <button
                    aria-label="Previous turn"
                    disabled={position?.index === 0}
                    onClick={() =>
                      review(Math.max(0, (position?.index || 0) - 1))
                    }
                  >
                    <ChevronLeft size={17} />
                  </button>
                  <select
                    aria-label="Select turn"
                    value={Math.max(0, position?.index || 0)}
                    onChange={(e) => {
                      setBranches([]);
                      void review(Number(e.target.value));
                    }}
                  >
                    {loaded.positions.map((p) => (
                      <option key={p.index} value={p.index}>
                        Turn {p.turn}
                        {p.phase === "switch" ? " · switch" : ""}
                      </option>
                    ))}
                  </select>
                  <button
                    aria-label="Next turn"
                    disabled={position?.index === loaded.positions.length - 1}
                    onClick={() =>
                      review(
                        Math.min(
                          loaded.positions.length - 1,
                          (position?.index || 0) + 1,
                        ),
                      )
                    }
                  >
                    <ChevronRight size={17} />
                  </button>
                  <button
                    aria-label="Last turn"
                    onClick={() => review(loaded.positions.length - 1)}
                  >
                    <ChevronsRight size={17} />
                  </button>
                  <span>
                    Decision {Math.max(0, position?.index || 0) + 1} /{" "}
                    {loaded.positions.length}
                  </span>
                </div>
                <div className="choices">
                  <div className="section-caption">
                    <b>
                      {col !== null ? "Your best response" : "Your choices"}
                    </b>
                    <span>
                      {col !== null && matrix
                        ? `against ${matrix.columns[col].label}`
                        : "Click a move to see their strongest reply"}
                    </span>
                  </div>
                  <div className="action-grid">
                    {(matrix?.rows || position?.actions[side] || []).map(
                      (a, i) => (
                        <ActionButton
                          key={a.id}
                          action={a}
                          selected={row === i}
                          best={!!matrix && i === bestRow}
                          played={matrix?.played[0] === i}
                          regret={
                            matrix && !matrix.provisional
                              ? Math.max(
                                  0,
                                  matrix.value -
                                    matrix.values[i].reduce(
                                      (sum, value, j) =>
                                        sum + value * matrix.q[j],
                                      0,
                                    ),
                                )
                              : undefined
                          }
                          assessment={matrix?.grades[i]}
                          value={
                            matrix
                              ? col !== null
                                ? matrix.values[i][col]
                                : matrix.values[i].reduce(
                                    (s, v, j) => s + v * matrix.q[j],
                                    0,
                                  )
                              : undefined
                          }
                          onClick={() => setRow(row === i ? null : i)}
                        />
                      ),
                    )}
                  </div>
                </div>
              </section>
              <aside className="review-panel panel">
                <div className="panel-title">
                  <b>Engine review</b>
                  <span className="depth">1-turn search</span>
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
                  <div className="reply-grid">
                    {(matrix?.columns || position?.actions[opponent] || []).map(
                      (a, i) => (
                        <ActionButton
                          key={a.id}
                          action={a}
                          selected={col === i}
                          best={!!matrix && i === bestCol}
                          played={matrix?.played[1] === i}
                          value={
                            row !== null && matrix
                              ? 1 - matrix.values[row][i]
                              : undefined
                          }
                          onClick={() => setCol(col === i ? null : i)}
                        />
                      ),
                    )}
                  </div>
                  {!matrix && (
                    <p className="muted">
                      {busy
                        ? "Calculating legal replies…"
                        : "Select a position to analyze."}
                    </p>
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
                    className={tab === "line" ? "active" : ""}
                    onClick={() => setTab("line")}
                  >
                    Continuation {branches.length > 0 && `(${branches.length})`}
                  </button>
                  <button
                    className={tab === "log" ? "active" : ""}
                    onClick={() => setTab("log")}
                  >
                    Battle log
                  </button>
                </div>
                {tab === "review" && (
                  <div className="review-content">
                    <div
                      className="engine-score"
                      title="Full-information position score: 200 × win probability − 100"
                    >
                      <strong
                        className={
                          (positionValue ?? 0.5) >= 0.5
                            ? "score-positive"
                            : "score-negative"
                        }
                      >
                        {positionValue === null
                          ? "0.00"
                          : advantage(positionValue)}
                      </strong>
                      <span>
                        {positionValue === null
                          ? "Evaluating position…"
                          : `${percent(positionValue)} win · full information`}
                      </span>
                      <small>Depth 1 · fixed seed</small>
                    </div>
                    {matrix ? (
                      <>
                        {matrix.provisional && (
                          <p className="note" role="status">
                            Comparing actions · {percent(matrix.coverage)}{" "}
                            complete
                          </p>
                        )}
                        <div className="move-grade">
                          <span
                            className={`grade-icon ${currentGrade.className}`}
                          >
                            {currentGrade.symbol}
                          </span>
                          <div>
                            <strong>
                              {matrix.played[0] >= 0
                                ? matrix.rows[matrix.played[0]].label
                                : "No recorded decision"}
                            </strong>
                            <span className={currentGrade.className}>
                              {currentGrade.label}
                              {matrix.approximate &&
                                !matrix.provisional &&
                                " (estimated)"}
                              {matrix.regret !== null &&
                                ` · ${points(-matrix.regret)} lost`}
                            </span>
                          </div>
                        </div>
                        {matrix.played[0] >= 0 && (
                          <p className="note">
                            {matrix.grades[matrix.played[0]]?.reason}
                          </p>
                        )}
                        <div className="recommendation">
                          <span className="grade-icon best">★</span>
                          <div>
                            <strong>
                              {matrix.rows[bestRow].label}
                              {matrix.rows[bestRow].tera ? " + Tera" : ""}
                            </strong>
                            <p>
                              {matrix.provisional
                                ? "Comparing actions; recommendation may change."
                                : col !== null
                                  ? "Best estimated response to the selected opponent action."
                                  : "Highest-frequency action in the lines below. Compare its strongest opposing reply before exploring."}
                            </p>
                          </div>
                          <b>
                            {percent(
                              col !== null
                                ? matrix.values[bestRow][col]
                                : matrix.values[bestRow].reduce(
                                    (s, v, j) => s + v * matrix.q[j],
                                    0,
                                  ),
                            )}
                          </b>
                        </div>
                        {topLines.length > 0 && (
                          <div className="top-lines">
                            <b>Analysis lines · depth 1</b>
                            <small>
                              Frequency · your choice / opponent’s strongest
                              reply. Scores value that fixed-seed pair, not the
                              whole mix.
                            </small>
                            {topLines.map((line) => (
                              <button
                                key={line.row}
                                disabled={!!busy && !reviewingBattle.current}
                                onClick={() => {
                                  setRow(line.row);
                                  setCol(line.col);
                                  void continueLine(line);
                                }}
                              >
                                <strong title="Score against the strongest reply">
                                  {advantage(line.value)}
                                </strong>
                                <small title="Recommended choice frequency">
                                  {percent(matrix.p[line.row])}
                                </small>
                                <span
                                  title={`${names[side]} / ${names[opponent]}`}
                                >
                                  {position?.turn}.{" "}
                                  {line.action.kind === "switch"
                                    ? "Switch → "
                                    : ""}
                                  {line.action.label}
                                  {line.action.tera ? " + Tera" : ""}
                                  {" / … "}
                                  {matrix.columns[line.col].kind === "switch"
                                    ? "Switch → "
                                    : ""}
                                  {matrix.columns[line.col].label}
                                  {matrix.columns[line.col].tera
                                    ? " + Tera"
                                    : ""}
                                </span>
                              </button>
                            ))}
                          </div>
                        )}
                        <dl className="metrics">
                          <div>
                            <dt>
                              {matrix.provisional
                                ? "Estimated value"
                                : "Equilibrium value"}
                            </dt>
                            <dd>{percent(matrix.value)}</dd>
                          </div>
                          <div>
                            <dt>
                              {row !== null && col !== null
                                ? "Selected matchup"
                                : col !== null
                                  ? "Best response value"
                                  : row !== null
                                    ? "Selected action"
                                    : "Recommendation"}
                            </dt>
                            <dd>{percent(selectedValue!)}</dd>
                          </div>
                          <div>
                            <dt>Outcome swing</dt>
                            <dd
                              className={
                                (matrix.luck ?? 0) < 0 ? "negative" : "positive"
                              }
                            >
                              {matrix.luck === null
                                ? "Not available"
                                : points(matrix.luck)}
                            </dd>
                          </div>
                        </dl>
                        <p className="note">
                          <Info size={13} />
                          {oracle
                            ? "Model estimates · all information revealed"
                            : "Masked inputs · hindsight may influence analysis"}
                        </p>
                        <button
                          className="continue-button"
                          disabled={
                            matrix.provisional ||
                            (!!busy && !reviewingBattle.current)
                          }
                          onClick={() => void continueLine()}
                        >
                          <GitBranch size={15} /> Explore this continuation{" "}
                          <ChevronRight size={15} />
                        </button>
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
                {tab === "line" && (
                  <div className="continuations">
                    <p className="note">
                      Select a line to explore the next decision.
                    </p>
                    {branches.length === 0 && (
                      <button
                        disabled={
                          !matrix ||
                          matrix.provisional ||
                          (!!busy && !reviewingBattle.current)
                        }
                        onClick={() => void continueLine()}
                      >
                        Explore best continuation
                      </button>
                    )}
                    {branches.map((branch, i) => (
                      <article key={i}>
                        <div className="line-heading">
                          <b>
                            {i + 1}. {branch.label}
                          </b>
                          <span>{percent(branch.value)}</span>
                        </div>
                        {branch.approximate && (
                          <p className="note">
                            One fixed-seed continuation, not a prediction of the
                            actual roll.
                          </p>
                        )}
                        {branch.outcomes.map((o) => (
                          <button
                            className="outcome"
                            key={o.key}
                            disabled={!!busy}
                            onClick={() => review(-Number(o.key))}
                          >
                            <span>{o.label}</span>
                            <small>
                              Fixed-seed outcome · {percent(o.value)} win
                            </small>
                            <ChevronRight size={13} />
                          </button>
                        ))}
                      </article>
                    ))}
                    {position && position.index < 0 && (
                      <button
                        disabled={!!busy}
                        onClick={() => void continueLine()}
                      >
                        <GitBranch size={14} /> Add next decision
                      </button>
                    )}
                    <button
                      className="plain"
                      disabled={!!busy}
                      onClick={() => {
                        setBranches([]);
                        void review(replayIndex);
                      }}
                    >
                      <RotateCcw size={13} /> Return to replay
                    </button>
                  </div>
                )}
                {tab === "log" && (
                  <div className="battle-log">
                    {position?.log
                      .filter((l) => l && !l.startsWith("|t:"))
                      .map((l, i) => (
                        <div key={i}>
                          {l.split("|").filter(Boolean).join(" · ")}
                        </div>
                      ))}
                  </div>
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
                        <title>{`Turn ${p.turn}: ${percent(p.value)}${p.provisional ? " · provisional position estimate" : p.approximate ? " · approximate review" : ""}${p.luck === null ? "" : `, luck ${points(p.luck)}`}`}</title>
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
                        {p.luck !== null && Math.abs(p.luck) > 0.02 && (
                          <text
                            x={x}
                            y={
                              p.luck > 0
                                ? Math.max(13, y - 12)
                                : Math.min(123, y + 18)
                            }
                            textAnchor="middle"
                            className="luck-marker"
                          >
                            ♧
                          </text>
                        )}
                        {(p.regret ?? 0) > 0.02 && (
                          <text
                            x={x}
                            y="16"
                            textAnchor="middle"
                            className="grade-marker"
                          >
                            {p.grade === "Brilliant"
                              ? "!!"
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
                  <span>Outcome swing · fixed-seed baseline</span>
                </div>
                <div className="luck-total">
                  <strong className={netLuck < 0 ? "negative" : "positive"}>
                    {timeline.some((p) => p.luck !== null)
                      ? points(netLuck)
                      : "—"}
                  </strong>
                  <span>
                    {!timeline.some((p) => p.luck !== null)
                      ? "Awaiting reviewed outcomes"
                      : netLuck < -0.01
                        ? "Replay outcome below the fixed-seed baseline"
                        : netLuck > 0.01
                          ? "Replay outcome above the fixed-seed baseline"
                          : "About even so far"}
                  </span>
                </div>
                <div className="luck-track">
                  <span>Worse</span>
                  <div>
                    <i style={{ left: `${50 + Math.tanh(netLuck) * 46}%` }} />
                    <b />
                  </div>
                  <span>Better</span>
                </div>
                <p>
                  Outcome swing against one fixed roll—not statistical luck.
                </p>
                {timeline
                  .filter((p) => p.luck !== null && Math.abs(p.luck) > 0.01)
                  .sort((a, b) => Math.abs(b.luck!) - Math.abs(a.luck!))
                  .slice(0, 3)
                  .map((p) => (
                    <button
                      className="luck-event"
                      key={p.index}
                      onClick={() => review(p.index)}
                    >
                      <span>Turn {p.turn}</span>
                      <b className={p.luck! < 0 ? "negative" : "positive"}>
                        {points(p.luck!)}
                      </b>
                      <ChevronRight size={13} />
                    </button>
                  ))}
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
                    {[
                      {
                        label: "Brilliant",
                        symbol: "!!",
                        className: "brilliant",
                      },
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
                            <span className={`grade-icon ${g.className}`}>
                              {g.symbol}
                            </span>
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
                    Review score = 100 × exp(−5 × mean regret). Unobserved
                    decisions are excluded. Thresholds: Best &lt;0.5 pp;
                    Excellent &lt;1 pp; Good &lt;2 pp; Inaccuracy &lt;5 pp;
                    Mistake &lt;12 pp; Blunder ≥12 pp. These are product
                    conventions, not calibrated skill ratings. Brilliant is a
                    low-regret sacrifice: ≥50% expected chance of losing a
                    Pokémon, ≥5 pp better than every low-sacrifice alternative,
                    and 50–95% expected win value.
                  </small>
                </details>
              </section>
            </div>
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
                                      ? "1 fixed-seed successor evaluated"
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
                  <small>
                    Expected payoff to the next decision boundary · equilibrium
                    gap {(matrix.exploitability * 100).toFixed(3)} pp. Uses
                    actual teams; critic error and hindsight bias remain. Each
                    player's grades use their own critic perspective.
                  </small>
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
              full-information calibration has not been validated. The
              evaluation bar always evaluates the current position with both
              teams revealed, independently of the selected matrix actions.
            </p>
            <p>
              <b>Luck-o-meter shows outcome swing.</b> It compares the replay’s
              successor with the fixed-seed successor for the same played
              actions. It is not a statistical measure of luck.
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
