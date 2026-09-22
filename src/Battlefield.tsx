import { useEffect, useRef, useState } from "react";
import type { PositionView, Side } from "./types";

export default function Battlefield({
  position,
  side,
  replay,
  playing,
  onLog,
  onSettled,
}: {
  position: PositionView;
  side: Side;
  replay: string;
  playing: boolean;
  onLog: (html: string) => void;
  onSettled: (index: number) => void;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (
        event.source !== frame.current?.contentWindow ||
        event.origin !== location.origin ||
        !event.data
      )
        return;
      if (event.data.type === "battle-ready") setReady(true);
      if (event.data.type === "battle-log") onLog(event.data.html);
      if (event.data.type === "battle-settled") onSettled(event.data.index);
      if (event.data.type === "battle-rendered") setError("");
      if (event.data.type === "battle-render-error") setError(event.data.error);
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [onLog, onSettled]);
  useEffect(() => {
    if (!ready) return;
    frame.current?.contentWindow?.postMessage(
      {
        type: "render-battle",
        id: replay,
        side,
        log: position.log,
        index: position.index,
        teams: position.teams.map((team, player) => player === side ? team : []),
      },
      location.origin,
    );
  }, [position, side, replay, ready]);
  useEffect(() => {
    if (ready)
      frame.current?.contentWindow?.postMessage(
        { type: "playback", playing },
        location.origin,
      );
  }, [playing, ready]);
  return (
    <div className="showdown-field">
      <iframe
        ref={frame}
        title="Pokémon Showdown battlefield"
        src="/showdown/frame.html?v=settled-2"
      />
      {error && <p role="alert">Battle renderer: {error}</p>}
    </div>
  );
}
