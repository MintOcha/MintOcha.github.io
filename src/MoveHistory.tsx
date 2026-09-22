import { Fragment } from "react";
import type { Action, Branch, Loaded } from "./types";

const actionLabel = (action?: Action) =>
  action
    ? `${action.kind === "switch" ? "↔ " : ""}${action.label}${action.tera ? " + Tera" : ""}`
    : "—";

export default function MoveHistory({
  loaded,
  branches,
  selected,
  onSelect,
}: {
  loaded: Loaded;
  branches: Branch[];
  selected: number;
  onSelect: (index: number) => void;
}) {
  const children = new Map<number, Branch[]>();
  for (const branch of branches) {
    const siblings = children.get(branch.parent) ?? [];
    siblings.push(branch);
    children.set(branch.parent, siblings);
  }
  function variations(parent: number) {
    return children.get(parent)?.map((branch) => (
      <div className="variation" key={branch.view.index}>
        <button
          className="move-row"
          aria-current={selected === branch.view.index ? "step" : undefined}
          onClick={() => onSelect(branch.view.index)}
          title="Open saved position after these actions"
        >
          <small>
            ↳{" "}
            {branch.parent >= 0
              ? loaded.positions[branch.parent].turn
              : branches.find((entry) => entry.view.index === branch.parent)
                  ?.view.turn}
            .
          </small>
          {branch.actions.map((action, side) => (
            <span key={side}>{actionLabel(action)}</span>
          ))}
        </button>
        {variations(branch.view.index)}
      </div>
    ));
  }
  return (
    <div className="move-history">
      <p className="note">
        Select a move to jump to its decision. Variations open the resulting
        position and are saved in this browser.
      </p>
      <div className="move-row move-head">
        <small>Turn</small>
        {loaded.replay.players.map((name, side) => (
          <b key={side}>{name}</b>
        ))}
      </div>
      <div className="move-list" aria-label="Replay moves and saved variations">
        {loaded.positions.map((view) => (
          <Fragment key={view.index}>
            <button
              className="move-row"
              aria-current={selected === view.index ? "step" : undefined}
              onClick={() => onSelect(view.index)}
              title={`Turn ${view.turn} · decision ${view.index + 1}`}
            >
              <small>
                {view.turn}.{view.phase === "switch" ? " ↔" : ""}
              </small>
              {[0, 1].map((side) => (
                <span key={side}>
                  {actionLabel(
                    view.actions[side].find(
                      (action) => action.id === view.played[side],
                    ),
                  )}
                </span>
              ))}
            </button>
            {variations(view.index)}
          </Fragment>
        ))}
        {loaded.outcome && (
          <button
            className="move-row"
            aria-current={
              selected === loaded.positions.length ? "step" : undefined
            }
            onClick={() => onSelect(loaded.positions.length)}
          >
            <small>End</small>
            <span>
              {loaded.outcome.winner === "Tie"
                ? "Tie"
                : `${loaded.outcome.winner} won`}
            </span>
          </button>
        )}
      </div>
    </div>
  );
}
