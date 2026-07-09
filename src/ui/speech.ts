import type { Card } from '../engine/types';
import { clipKeys } from '../engine/morphology';

// Statement narration: stitch the per-card voice clips (public/voice/*.mp3, generated offline by
// `npm run gentts` — one deadpan narrator) into one spoken statement at resolution. Clips are
// loudness-normalized with trimmed edges + a small tail pad, so straight back-to-back Web Audio
// scheduling reads as continuous speech; the GAP knobs add breathing room around comma-set asides
// and the finisher. Everything is lazy: no clip is fetched until a statement actually speaks, and
// decoded buffers are cached for the session (the same cards recur constantly).
// The clips live in public/ (fetched by URL), NOT under import.meta.glob — globbing 575 mp3s
// makes Vite emit a JS chunk per clip and base64-inline the small ones (~70KB bundle bloat).

// Extra seconds of silence inserted before/after a clip by the card's role (on top of the ~90ms
// the clips already carry at their edges). Tune by ear; regenerating audio isn't needed.
const PRE_GAP: Partial<Record<Card['role'], number>> = { modifier: 0.15, intensifier: 0.22 };
const POST_GAP: Partial<Record<Card['role'], number>> = { modifier: 0.15 };

const MUTE_KEY = 'voiceMuted';
export function voiceMuted(): boolean {
  return localStorage.getItem(MUTE_KEY) === '1';
}
export function setVoiceMuted(muted: boolean): void {
  localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
}

let ctx: AudioContext | null = null;
function audioCtx(): AudioContext | null {
  if (!ctx) {
    try {
      ctx = new AudioContext();
    } catch {
      /* no Web Audio — narration stays silent */
    }
  }
  return ctx;
}

/** Play a one-sample silent buffer — forces the output stream/device open so it isn't spinning
 * up (and swallowing audio) when the first real word plays. */
function blip(c: AudioContext): void {
  const src = c.createBufferSource();
  src.buffer = c.createBuffer(1, 1, c.sampleRate);
  src.connect(c.destination);
  src.start();
}

// Warm the context + output device on the very first gesture of the session (playtest bug: the
// first narrated word faded in / was clipped — the sink takes a few hundred ms to wake, and the
// first statement used to be the thing that woke it). Not gated on mute: unmuting later should
// still start clean, and a silent one-sample blip is free.
document.addEventListener(
  'pointerdown',
  function warmOnce() {
    document.removeEventListener('pointerdown', warmOnce, true);
    const c = audioCtx();
    if (!c) return;
    c.resume().catch(() => {});
    blip(c);
  },
  true,
);

const clipCache = new Map<string, Promise<AudioBuffer | null>>();
function loadClip(key: string): Promise<AudioBuffer | null> {
  let p = clipCache.get(key);
  if (!p) {
    p = fetch(`${import.meta.env.BASE_URL}voice/${encodeURIComponent(key)}.mp3`)
      .then((res) => (res.ok ? res.arrayBuffer() : Promise.reject(new Error(String(res.status)))))
      .then((buf) => audioCtx()!.decodeAudioData(buf))
      .catch(() => null); // a missing/failed clip skips its word — never blocks the resolution FX
    clipCache.set(key, p);
  }
  return p;
}

export interface SpeechHandle {
  /** Resolves when the narration finishes — or was stopped, muted, or unavailable. */
  done: Promise<void>;
  stop(): void;
  /** False when nothing will be spoken (muted / no Web Audio) — the FX falls back to its own timing. */
  live: boolean;
}
const SILENT: SpeechHandle = { done: Promise.resolve(), stop() {}, live: false };

let active: SpeechHandle | null = null;
/** Cut off whatever statement is being narrated right now (the mute button mid-read). */
export function stopSpeaking(): void {
  active?.stop();
}

/** Speak a judged line in the narrator voice. Returns immediately; audio starts once the clips
 * load. stop() (wired to the FX fast-forward click) cuts it off; `done` always resolves.
 * `onClip(lineIdx)` fires as each card's clip starts playing — the FX uses it to light the words
 * and pop the grading chips in sync with the narration. */
export function speakStatement(line: Card[], onClip?: (lineIdx: number) => void): SpeechHandle {
  const c = !voiceMuted() && line.length ? audioCtx() : null;
  if (!c) return SILENT;
  let stopped = false;
  const sources: AudioBufferSourceNode[] = [];
  const timers: number[] = [];
  let resolveDone!: () => void;
  const done = new Promise<void>((r) => (resolveDone = r));
  const stop = () => {
    stopped = true;
    for (const s of sources) {
      try {
        s.stop();
      } catch {
        /* already ended */
      }
    }
    for (const t of timers) window.clearTimeout(t);
    resolveDone();
  };
  (async () => {
    // Autoplay policy: a context starts suspended until the page has had a user gesture; by
    // resolution time the player has clicked plenty, so resume() normally succeeds.
    if (c.state === 'suspended') await c.resume().catch(() => {});
    blip(c); // reopen an idle output during the load window (see the warm-up note above)
    const keys = clipKeys(line);
    const buffers = await Promise.all(keys.map((k) => (k ? loadClip(k) : null)));
    if (stopped || c.state !== 'running') return resolveDone();
    let t = c.currentTime + 0.12; // small lead-in so even a slow sink catches the first syllable
    let last: AudioBufferSourceNode | undefined;
    buffers.forEach((buf, i) => {
      if (!buf) return;
      const role = line[i].role;
      t += PRE_GAP[role] ?? 0;
      const src = c.createBufferSource();
      src.buffer = buf;
      src.connect(c.destination);
      src.start(t);
      if (onClip) timers.push(window.setTimeout(() => onClip(i), Math.max(0, (t - c.currentTime) * 1000)));
      t += buf.duration + (POST_GAP[role] ?? 0);
      sources.push(src);
      last = src;
    });
    if (!last) return resolveDone();
    last.onended = () => resolveDone();
    // Safety net: if the context gets interrupted (tab hidden mid-FX), onended may never fire —
    // resolve shortly after the scheduled end so the FX can't hang on `await voice.done`.
    timers.push(window.setTimeout(resolveDone, (t - c.currentTime + 2) * 1000));
  })().catch(() => resolveDone());
  const handle = { done, stop, live: true };
  active = handle;
  return handle;
}
