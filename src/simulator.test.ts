import assert from "node:assert/strict";
import { test } from "node:test";

// Pin the replay fixture's simulator, not the current upstream mechanics.
const revision = "aa6d5f0856d24679be8f5df167d1b528c2dcbd71";
const engine = await import(`../public/simulators/${revision}.mjs`);

test("a knockout stops at replacement choice without selecting a bench Pokémon", async () => {
  const stream = new engine.BattleStream({ keepAlive: true, noCatch: true });
  await stream.write(
    ">start " +
      JSON.stringify({ formatid: "gen9randombattle", seed: [1, 2, 3, 4] }),
  );
  await stream.write(
    ">player p1 " +
      JSON.stringify({
        name: "p1",
        team: [
          {
            species: "Scizor",
            ability: "Swarm",
            moves: ["Swords Dance"],
            level: 50,
          },
          {
            species: "Blissey",
            ability: "Natural Cure",
            moves: ["Soft-Boiled"],
            level: 50,
          },
        ],
      }),
  );
  await stream.write(
    ">player p2 " +
      JSON.stringify({
        name: "p2",
        team: [
          {
            species: "Dragonite",
            ability: "Inner Focus",
            moves: ["Dragon Rage"],
            level: 100,
          },
        ],
      }),
  );
  stream.battle.sides[0].pokemon[0].hp = 1;
  const root = JSON.parse(JSON.stringify(stream.battle.toJSON()));
  const battle = engine.Battle.fromJSON(root);
  for (const side of battle.sides) assert(side.choose("move 1"));
  battle.commitChoices();
  battle.sendUpdates();
  assert.equal(battle.sides[0].active[0].species.name, "Scizor");
  assert.equal(battle.sides[0].active[0].hp, 0);
  assert.equal(battle.sides[0].active[0].boosts.atk, 0);
  assert.deepEqual(battle.sides[0].activeRequest.forceSwitch, [true]);
  assert.equal(battle.sides[0].pokemon[1].isActive, false);
});
