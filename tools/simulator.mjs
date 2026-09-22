import fs from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";

const root =
  process.env.POKEMONBOT_ROOT ||
  path.resolve(import.meta.dirname, "../../../PokemonBot");
export async function bundleSimulator(revision, destination) {
  if (!/^[a-f0-9]{40}$/.test(revision))
    throw new Error("Invalid simulator revision");
  const source = path.join(root, "data/simulators", revision, "dist");
  await fs.access(path.join(source, "sim/battle.js"));
  const modules = new Map();
  async function add(file) {
    file = path.posix.normalize(file);
    if (modules.has(file)) return;
    let text;
    try {
      text = await fs.readFile(path.join(source, file), "utf8");
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
    modules.set(file, text);
    for (const match of text.matchAll(/require\(["'](\.[^"']+)["']\)/g)) {
      const resolved = path.posix.join(path.posix.dirname(file), match[1]);
      if (path.extname(resolved) === ".json") await add(resolved);
      else if (
        await fs.access(path.join(source, resolved + ".js")).then(
          () => true,
          () => false,
        )
      )
        await add(resolved + ".js");
      else await add(resolved + "/index.js");
    }
  }
  const mods = await fs.readdir(path.join(source, "data/mods"));
  const dataFolders = ["data", "data/text"];
  if (
    await fs.access(path.join(source, "data/random-battles/gen9")).then(
      () => true,
      () => false,
    )
  )
    dataFolders.push("data/random-battles/gen9");
  for (const dir of dataFolders) {
    for (const file of await fs.readdir(path.join(source, dir)))
      if (/\.(js|json)$/.test(file)) await add(`${dir}/${file}`);
  }
  for (const file of [
    "sim/battle-stream.js",
    "sim/battle.js",
    "sim/teams.js",
    "sim/dex.js",
    "sim/prng.js",
    "config/formats.js",
  ])
    await add(file);
  const factories = [...modules]
    .map(
      ([id, text]) =>
        `${JSON.stringify("/" + id)}:(module,exports,require,__dirname,__filename)=>{${id.endsWith(".json") ? "module.exports=" + text : text.replace(/\/\/# sourceMappingURL=.*$/gm, "")}\n}`,
    )
    .join(",\n");
  const contents = `import * as chacha from 'ts-chacha20';import isDeepStrictEqual from 'fast-deep-equal/es6/index.js';import * as Streams from '@pkmn/streams';
const process={env:{},cwd:()=>'/'},global=globalThis;
const factories={${factories}},cache={};
const normalize=p=>{const parts=[];for(const part of p.split('/')){if(part==='..')parts.pop();else if(part&&part!=='.')parts.push(part);}return '/'+parts.join('/');};
function load(name,from='/'){
 if(name==='fs')return {readdirSync:()=>${JSON.stringify(mods)}};
 if(name==='path')return {resolve:(...x)=>normalize(x.join('/')),join:(...x)=>normalize(x.join('/')),sep:'/'};
 if(name==='ts-chacha20')return chacha;
 if(name==='node:util')return {isDeepStrictEqual};
 let id=normalize(name.startsWith('.')?from+'/'+name:name);
 if(id==='/lib'||id==='/lib/index')return {Streams,Utils:load('/lib/utils').Utils};
 if(!factories[id])id=factories[id+'.js']?id+'.js':id+'/index.js';
 if(!factories[id]){const e=new Error('Missing simulator module '+name);e.code='MODULE_NOT_FOUND';throw e;}
 if(cache[id])return cache[id].exports;
 const module={exports:{}};cache[id]=module;const dir=id.slice(0,id.lastIndexOf('/'));
 const require=n=>load(n,dir);require.resolve=n=>{load(n,dir);return n;};
 factories[id](module,module.exports,require,dir,id);return module.exports;
}
const {Battle,extractChannelMessages}=load('/sim/battle');const {BattleStream}=load('/sim/battle-stream');const {Dex}=load('/sim/dex');const {Teams}=load('/sim/teams');const {PRNG}=load('/sim/prng');
export {Battle,BattleStream,Dex,Teams,PRNG,extractChannelMessages};export const revision=${JSON.stringify(revision)};`;
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await build({
    stdin: { contents, resolveDir: process.cwd(), sourcefile: "simulator.js" },
    outfile: destination,
    bundle: true,
    format: "esm",
    platform: "browser",
    minify: true,
    keepNames: true,
    logLevel: "silent",
  });
  return destination;
}
if (process.argv[1] === import.meta.filename)
  await bundleSimulator(process.argv[2], process.argv[3]);
