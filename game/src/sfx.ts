// Placeholder battle sounds, synthesized: a short oscillator tone and/or filtered noise burst per cue.
import type { Cue } from "../logic/replay";
import { isMuted } from "./music";

let ctx: AudioContext | null = null, master: GainNode, noiseBuf: AudioBuffer;

/** One tone: frequency glides f -> f2 over d seconds, `at` seconds after the cue starts. */
type Tone = [type: OscillatorType, f: number, f2: number, d: number, vol: number, at?: number];
/** One noise burst through a filter. */
type Noise = [filter: BiquadFilterType, freq: number, d: number, vol: number, at?: number];
const CUES: Record<Cue, { tones?: Tone[]; noise?: Noise[] }> = {
  swing: { noise: [["bandpass", 1800, 0.22, 0.5]] },
  hit: { tones: [["sine", 160, 60, 0.18, 0.8]], noise: [["lowpass", 900, 0.12, 0.5]] },
  crit: { tones: [["square", 220, 50, 0.22, 0.6], ["sine", 1200, 600, 0.12, 0.3]], noise: [["highpass", 2500, 0.18, 0.6]] },
  guard: { tones: [["square", 900, 880, 0.15, 0.3], ["square", 1330, 1300, 0.15, 0.25]], noise: [["highpass", 4000, 0.06, 0.4]] },
  cover: { tones: [["triangle", 520, 500, 0.35, 0.5], ["square", 1040, 1020, 0.3, 0.2]], noise: [["highpass", 3000, 0.08, 0.4]] },
  miss: { noise: [["bandpass", 3000, 0.12, 0.25]] },
  heal: { tones: [["sine", 660, 660, 0.25, 0.4], ["sine", 880, 880, 0.3, 0.4, 0.1]] },
  support: { tones: [["sine", 440, 440, 0.22, 0.4], ["sine", 660, 660, 0.3, 0.4, 0.1]] },
  cast: { tones: [["sine", 1200, 1800, 0.4, 0.25], ["sine", 1500, 2200, 0.4, 0.2, 0.08]], noise: [["highpass", 5000, 0.3, 0.15]] },
  shot: { tones: [["triangle", 300, 120, 0.16, 0.6]], noise: [["bandpass", 2200, 0.1, 0.3]] },
  march: { tones: [["sine", 90, 50, 0.14, 0.7], ["sine", 90, 50, 0.14, 0.7, 0.2]] },
  stunned: { tones: [["triangle", 300, 120, 0.4, 0.5]] },
  death: { tones: [["sawtooth", 200, 40, 0.6, 0.4]], noise: [["lowpass", 500, 0.3, 0.3]] },
  phase: { tones: [["sawtooth", 220, 220, 0.35, 0.3], ["sawtooth", 330, 330, 0.35, 0.25]] },
  phase_end: { tones: [["sawtooth", 330, 220, 0.5, 0.25], ["sawtooth", 220, 147, 0.5, 0.2]] },
  win: { tones: [523, 659, 784, 1047].map((f, n): Tone => ["triangle", f, f, 0.3, 0.45, n * 0.14]) },
  lose: { tones: [440, 415, 349, 262].map((f, n): Tone => ["triangle", f, f, 0.35, 0.4, n * 0.18]) },
};

function env(c: AudioContext, vol: number, t: number, d: number): GainNode {
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + d);
  g.connect(master);
  return g;
}

export function playCue(cue: Cue): void {
  if (isMuted() || typeof AudioContext === "undefined") return;
  try {
    if (!ctx) {
      ctx = new AudioContext();
      master = ctx.createGain();
      master.gain.value = 0.35;
      master.connect(ctx.destination);
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      noiseBuf.getChannelData(0).forEach((_, i, a) => { a[i] = Math.random() * 2 - 1; });
    }
    if (ctx.state === "suspended") void ctx.resume();
    const t0 = ctx.currentTime, { tones = [], noise = [] } = CUES[cue];
    for (const [type, f, f2, d, vol, at = 0] of tones) {
      const o = ctx.createOscillator(), t = t0 + at;
      o.type = type;
      o.frequency.setValueAtTime(f, t);
      o.frequency.exponentialRampToValueAtTime(f2, t + d);
      o.connect(env(ctx, vol, t, d));
      o.start(t); o.stop(t + d + 0.02);
    }
    for (const [type, freq, d, vol, at = 0] of noise) {
      const s = ctx.createBufferSource(), fl = ctx.createBiquadFilter(), t = t0 + at;
      s.buffer = noiseBuf;
      fl.type = type; fl.frequency.value = freq;
      s.connect(fl); fl.connect(env(ctx, vol, t, d));
      s.start(t); s.stop(t + d + 0.02);
    }
  } catch { /* audio unavailable: stay silent */ }
}
