import fs from "node:fs/promises";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { bundleSimulator } from "./simulator.mjs";

const root =
  process.env.POKEMONBOT_ROOT ||
  path.resolve(import.meta.dirname, "../../../PokemonBot");
const destination = path.resolve("public/simulators");
await fs.mkdir(destination, { recursive: true });
const entries = await fs.readdir(path.join(root, "data/simulators"), {
  withFileTypes: true,
});
const revisions = entries
  .filter((entry) => entry.isDirectory() && /^[a-f0-9]{40}$/.test(entry.name))
  .map((entry) => entry.name)
  .sort();
let bytes = 0;
for (const [index, revision] of revisions.entries()) {
  const output = path.join(destination, `${revision}.mjs.gz`);
  try {
    await fs.access(output);
  } catch {
    const temporary = path.join(destination, `${revision}.building.mjs`);
    try {
      await bundleSimulator(revision, temporary);
      await fs.writeFile(output, gzipSync(await fs.readFile(temporary)));
    } finally {
      await fs.rm(temporary, { force: true });
    }
  }
  bytes += (await fs.stat(output)).size;
  console.log(`${index + 1}/${revisions.length} ${revision}`);
}
await fs.writeFile(
  path.join(destination, "catalog.json"),
  JSON.stringify({ revisions, bytes }),
);
console.log(JSON.stringify({ revisions: revisions.length, bytes }));
