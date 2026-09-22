import type { LuckEvent, Side } from "./types";

type Native = any;
const effectLogs =
  /\|(-status|-boost|-unboost|-start|-end|-activate|-curestatus)\|/;

// Observe the original simulator calls without advancing or replacing its PRNG.
export function observeLuck(battle: Native, clone: (state: Native) => Native) {
  const events: LuckEvent[] = [];
  let context:
    { kind: string; source: Native; target: Native; move: Native } | undefined;
  let secondary:
    | {
        target: Native;
        source: Native;
        move: Native;
        effects: Native[];
        index: number;
        self: boolean;
      }
    | undefined;
  const record = (
    kind: string,
    side: Side,
    label: string,
    probability: number,
    occurred: boolean,
    favorable = true,
  ) => {
    if (probability > 0 && probability < 1)
      events.push({ kind, side, label, probability, occurred, favorable });
  };
  const chance = battle.randomChance;
  battle.randomChance = function (numerator: number, denominator: number) {
    const result = chance.call(this, numerator, denominator);
    const probability = numerator / denominator;
    if (context?.kind === "Hits") {
      record(
        "Hits",
        context.source.side.n,
        `${context.source.species.name} · ${context.move.name} ${result ? "hit" : "missed"}`,
        probability,
        result,
      );
    } else if (context?.kind === "Critical hits") {
      context.move = { ...context.move, observedCrit: { probability, result } };
    } else {
      const effect = this.effect?.id;
      const target = this.effectState?.target;
      const kinds: Record<string, [string, boolean]> = {
        par: ["Full paralysis", false],
        frz: ["Thaws", true],
        confusion: ["Confusion self-hits", false],
      };
      if (target?.side && kinds[effect]) {
        const [kind, favorable] = kinds[effect];
        record(
          kind,
          target.side.n,
          `${target.species.name} · ${kind.toLowerCase()} ${result ? "occurred" : "avoided"}`,
          probability,
          result,
          favorable,
        );
      }
    }
    return result;
  };
  for (const [method, kind] of [
    ["hitStepAccuracy", "Hits"],
    ["getDamage", "Critical hits"],
  ]) {
    const original = battle.actions[method];
    battle.actions[method] = function (...args: Native[]) {
      const previous = context;
      const [source, target, move] =
        method === "getDamage" ? args : [args[1], args[0][0], args[2]];
      context = { kind, source, target, move };
      try {
        const result = original.apply(this, args);
        const roll = context.move?.observedCrit;
        if (
          roll &&
          target?.getMoveHitData &&
          typeof result === "number" &&
          result > 0
        ) {
          // Critical-hit immunity is checked by the simulator only on successful rolls.
          const permitted =
            target.getAbility().onCriticalHit === undefined ||
            target.ignoringAbility();
          if (permitted)
            record(
              kind,
              source.side.n,
              `${source.species.name} · ${move.name} ${target.getMoveHitData(move).crit ? "critical hit" : "no critical hit"}`,
              roll.probability,
              !!target.getMoveHitData(move).crit,
            );
        }
        return result;
      } finally {
        context = previous;
      }
    };
  }
  const secondaries = battle.actions.secondaries;
  battle.actions.secondaries = function (
    targets: Native[],
    source: Native,
    move: Native,
    data: Native,
    self: boolean,
  ) {
    const previous = secondary;
    secondary = { target: null, source, move, effects: [], index: 0, self };
    try {
      return secondaries.call(this, targets, source, move, data, self);
    } finally {
      secondary = previous;
    }
  };
  const runEvent = battle.runEvent;
  battle.runEvent = function (...args: Native[]) {
    const result = runEvent.apply(this, args);
    if (args[0] === "ModifySecondaries" && secondary) {
      secondary.target = args[1];
      secondary.effects = result;
      secondary.index = 0;
    }
    return result;
  };
  const random = battle.random;
  battle.random = function (...args: Native[]) {
    const result = random.apply(this, args);
    if (
      secondary &&
      args.length === 1 &&
      args[0] === 100 &&
      secondary.index < secondary.effects.length
    ) {
      const effect = secondary.effects[secondary.index++];
      const probability = effect.chance / 100;
      if (probability > 0 && probability < 1 && secondary.target?.hp > 0) {
        const probe = clone(this.toJSON());
        const source =
          probe.sides[secondary.source.side.n].pokemon[
            secondary.source.position
          ];
        const target =
          probe.sides[secondary.target.side.n].pokemon[
            secondary.target.position
          ];
        const start = probe.log.length;
        probe.actions.moveHit(
          target,
          source,
          { ...secondary.move },
          effect,
          true,
          secondary.self,
        );
        const changes = probe.log
          .slice(start)
          .filter((line: string) => effectLogs.test(line));
        if (changes.length) {
          const detail = changes
            .map((line: string) => {
              const [, kind, actor, effect] = line.split("|");
              const name = actor.split(": ").slice(1).join(": ");
              const status = probe.dex.conditions.get(effect).name || effect;
              if (kind === "-status") return `${name} ${status}`;
              if (kind === "-boost" || kind === "-unboost")
                return `${name} ${probe.dex.stats.names[effect] || effect} ${kind === "-boost" ? "boost" : "drop"}`;
              return `${name} ${status}`;
            })
            .join("; ");
          record(
            "Secondary effects",
            secondary.source.side.n,
            `${secondary.source.species.name} · ${secondary.move.name}: ${detail} ${result < effect.chance ? "triggered" : "did not trigger"}`,
            probability,
            result < effect.chance,
          );
        }
      }
    }
    return result;
  };
  return events;
}

export function summarizeLuck(events: LuckEvent[], perspective: Side) {
  let swing = 0,
    variance = 0;
  for (const event of events) {
    const sign =
      (event.side === perspective ? 1 : -1) * (event.favorable ? 1 : -1);
    swing += sign * (Number(event.occurred) - event.probability);
    variance += event.probability * (1 - event.probability);
  }
  return {
    swing,
    variance,
    score: variance > 0 ? swing / Math.sqrt(variance) : null,
  };
}
