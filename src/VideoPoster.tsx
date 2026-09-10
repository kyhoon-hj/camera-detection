import { useState } from "react";
import type { WakeUpVideoId } from "./wakeUpVideos";

export function VideoPoster({ id, eager = false }: { id: WakeUpVideoId; eager?: boolean }) {
  return <PosterImage key={id} id={id} eager={eager} />;
}

function PosterImage({ id, eager }: { id: WakeUpVideoId; eager: boolean }) {
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  return <div className={`video-poster is-${state}`} aria-hidden="true">
    <span className="video-poster-fallback">{state === "error" ? "이미지 준비 중" : "WAKE UP"}</span>
    <img src={`/posters/${id}.webp`} alt="" loading={eager ? "eager" : "lazy"} decoding="async"
      onLoad={() => setState("ready")} onError={() => setState("error")} />
  </div>;
}
