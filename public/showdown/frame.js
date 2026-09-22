let battle;
let previous;
let observer;
const frame = document.querySelector(".battle");
const log = document.querySelector(".battle-log");
function sendLog() {
  parent.postMessage(
    { type: "battle-log", html: log.innerHTML },
    location.origin,
  );
}
function resize() {
  frame.style.transform = `scale(${innerWidth / 640})`;
}
addEventListener("resize", resize);
addEventListener("message", ({ source, origin, data }) => {
  if (source !== parent || origin !== location.origin || !data) return;
  if (data.type === "playback") {
    if (data.playing) battle?.play();
    else battle?.pause();
    return;
  }
  if (data.type !== "render-battle") return;
  try {
    if (
      battle &&
      previous.id === data.id &&
      previous.side === data.side &&
      previous.index === data.index &&
      previous.log.length === data.log.length &&
      previous.log.every((line, i) => data.log[i] === line)
    ) {
      previous = data;
      if (battle.atQueueEnd) parent.postMessage({ type: "battle-settled", index: data.index }, location.origin);
      return;
    }
    const continuing =
      battle &&
      previous.id === data.id &&
      previous.side === data.side &&
      (data.index < 0 || data.index === previous.index + 1) &&
      data.log.length > previous.log.length &&
      previous.log.every((line, i) => data.log[i] === line);
    observer?.disconnect();
    if (continuing) {
      battle.subscription = null;
      if (!battle.atQueueEnd) battle.seekTurn(Infinity);
      battle.stopSeeking();
      battle.pause();
      for (const line of data.log.slice(previous.log.length)) battle.add(line);
    } else {
      battle?.destroy();
      // A decision's log is intentionally incomplete; it is not a truncated replay.
      battle = new Battle({
        id: data.id,
        $frame: $(frame),
        $logFrame: $(log),
        log: data.log,
        paused: true,
      });
      battle.setMute(true);
      if (data.side === 1) battle.switchViewpoint();
      const tooltips = battle.scene.tooltips;
      const showPokemon = tooltips.showPokemonTooltip.bind(tooltips);
      tooltips.showPokemonTooltip = (
        pokemon,
        serverPokemon,
        active,
        illusion,
      ) => {
        const team = previous?.teams?.[pokemon?.side.n];
        const known = team?.find(
          (mon) =>
            mon.name === pokemon.name && mon.species === pokemon.speciesForme,
        );
        if (known?.stats)
          serverPokemon = {
            ...known,
            speciesForme: known.species,
            terastallized: known.tera,
            baseAbility: known.ability,
          };
        return showPokemon(pokemon, serverPokemon, active, illusion);
      };
    }
    previous = data;
    observer = new MutationObserver(sendLog);
    observer.observe(log, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    battle.subscribe((event) => {
      if (event === "atqueueend") {
        for (const [s, team] of (data.teams || []).entries()) {
          const side = battle.sides[s];
          for (const mon of team) {
            if (
              mon.details &&
              !side.pokemon.some((pokemon) => pokemon.name === mon.name)
            ) {
              const pokemon = side.addPokemon(
                mon.name,
                `p${s + 1}: ${mon.name}`,
                mon.details,
              );
              pokemon.hp = mon.hp;
              pokemon.maxhp = mon.maxhp;
              pokemon.fainted = mon.fainted;
              pokemon.status = mon.status;
            }
          }
          battle.scene.updateSidebar(side);
        }
        sendLog();
        parent.postMessage(
          { type: "battle-settled", index: data.index },
          location.origin,
        );
      }
    });
    parent.postMessage({ type: "battle-rendered" }, location.origin);
    if (continuing) battle.play();
    else battle.seekTurn(Infinity);
    sendLog();
    resize();
  } catch (error) {
    parent.postMessage(
      { type: "battle-render-error", error: error.message },
      location.origin,
    );
  }
});
parent.postMessage({ type: "battle-ready" }, location.origin);
resize();
