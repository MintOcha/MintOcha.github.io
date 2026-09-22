import assert from "node:assert/strict";
import { test } from "node:test";
import { Battle, Dex, Teams } from "@pkmn/sim";
import { observeLuck, summarizeLuck } from "./luck";

function scenario(
  move: string,
  target = "Snorlax",
  ability = "Immunity",
  seed = 1,
) {
  const battle = new Battle({
    formatid: Dex.toID("gen9customgame"),
    seed: `${seed},2,3,4`,
  });
  battle.setPlayer("p1", {
    name: "A",
    team: Teams.import(`Mew\nAbility: Synchronize\nEVs: 252 Spe\n- ${move}`)!,
  });
  battle.setPlayer("p2", {
    name: "B",
    team: Teams.import(`${target}\nAbility: ${ability}\n- Splash`)!,
  });
  battle.makeChoices("team 1", "team 1");
  const control = Battle.fromJSON(battle.toJSON());
  const events = observeLuck(battle, (state) => Battle.fromJSON(state));
  battle.makeChoices("move 1", "move 1");
  control.makeChoices("move 1", "move 1");
  assert.deepEqual(
    battle.log,
    control.log,
    "observation must not change recorded outcomes",
  );
  assert.equal(battle.prng.getSeed(), control.prng.getSeed());
  return { battle, events };
}

test("chance accuracy and secondary probabilities come from the simulator", () => {
  const { events } = scenario("scald");
  assert(
    events.some(
      (event) =>
        event.kind === "Secondary effects" && event.probability === 0.3,
    ),
  );
  assert(!events.some((event) => event.kind === "Hits"));
  const missable = scenario("focusblast").events;
  assert(
    missable.some(
      (event) => event.kind === "Hits" && event.probability === 0.7,
    ),
  );
});

test("guaranteed effects, setup and blocked status do not create luck", () => {
  assert(
    !scenario("flamecharge").events.some(
      (event) => event.kind === "Secondary effects",
    ),
  );
  assert.equal(scenario("quiverdance").events.length, 0);
  assert(
    !scenario("scald", "Arcanine", "Intimidate").events.some(
      (event) => event.kind === "Secondary effects",
    ),
  );
  assert(
    !scenario("tackle", "Lapras", "Shell Armor").events.some(
      (event) => event.kind === "Critical hits",
    ),
  );
});

test("recorded critical hits match the ledger and perspective reverses luck", () => {
  let found = false;
  for (let seed = 1; seed <= 100 && !found; seed++) {
    const { battle, events } = scenario("slash", "Snorlax", "Immunity", seed);
    const crit = battle.log.some((line) => line.startsWith("|-crit|"));
    assert.equal(
      events.some((event) => event.kind === "Critical hits" && event.occurred),
      crit,
    );
    const own = summarizeLuck(events, 0),
      foe = summarizeLuck(events, 1);
    assert.equal(own.score, -foe.score!);
    found = crit;
  }
  assert(found, "exercise an actual critical hit");
});
