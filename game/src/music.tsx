// One looping track for the whole client. Browsers block autoplay, so playback starts on the first key or click.
import { useEffect, useState } from "react";
import { SCENES, trackUrl, type Track } from "./scenes";

const audio = new Audio();
audio.volume = 0.4;
let muted = false;
try { muted = localStorage.getItem("muted") === "1"; } catch { /* storage blocked */ }
audio.muted = muted;
let armed = false;
const listen = () => { addEventListener("pointerdown", arm, { once: true }); addEventListener("keydown", arm, { once: true }); };
const play = () => { if (audio.src) audio.play().catch((e) => { if (e.name === "NotAllowedError") { armed = false; listen(); } }); }; // AbortError (track switch) or a bad file: ignore
const arm = () => { armed = true; removeEventListener("pointerdown", arm); removeEventListener("keydown", arm); play(); };
listen();

function setTrack(name: string, loop: boolean): void {
  const url = trackUrl(name);
  audio.loop = loop;
  if (!url) { audio.pause(); audio.removeAttribute("src"); return; }
  if (!audio.src.endsWith(url)) { audio.src = url; if (armed) play(); }
}

/** Plays a track by scene key (its music file) or "victory" (once). Same track again keeps playing. */
export function useMusic(track: Track): void {
  useEffect(() => setTrack(track === "victory" ? "victory" : SCENES[track].music, track !== "victory"), [track]);
}

export function MuteButton({ fixed }: { fixed?: boolean }) {
  const [m, setM] = useState(muted);
  const toggle = () => {
    muted = audio.muted = !m;
    setM(muted);
    try { localStorage.setItem("muted", muted ? "1" : "0"); } catch { /* storage blocked */ }
  };
  return <button className={`btn btn-small mute${fixed ? " mute-fixed" : ""}`} aria-pressed={m} aria-label="Mute music" onClick={toggle}>{m ? "Sound off" : "Sound on"}</button>;
}
