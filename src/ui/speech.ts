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
}
const SILENT: SpeechHandle = { done: Promise.resolve(), stop() {} };

let active: SpeechHandle | null = null;
/** Cut off whatever statement is being narrated right now (the mute button mid-read). */
export function stopSpeaking(): void {
  active?.stop();
}

/** Speak a judged line in the narrator voice. Returns immediately; audio starts once the clips
 * load. stop() (wired to the FX fast-forward click) cuts it off; `done` always resolves. */
export function speakStatement(line: Card[]): SpeechHandle {
  const c = !voiceMuted() && line.length ? audioCtx() : null;
  if (!c) return SILENT;
  let stopped = false;
  const sources: AudioBufferSourceNode[] = [];
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
    resolveDone();
  };
  (async () => {
    // Autoplay policy: a context starts suspended until the page has had a user gesture; by
    // resolution time the player has clicked plenty, so resume() normally succeeds.
    if (c.state === 'suspended') await c.resume().catch(() => {});
    const keys = clipKeys(line);
    const buffers = await Promise.all(keys.map((k) => (k ? loadClip(k) : null)));
    if (stopped || c.state !== 'running') return resolveDone();
    let t = c.currentTime + 0.03;
    let last: AudioBufferSourceNode | undefined;
    buffers.forEach((buf, i) => {
      if (!buf) return;
      const role = line[i].role;
      t += PRE_GAP[role] ?? 0;
      const src = c.createBufferSource();
      src.buffer = buf;
      src.connect(c.destination);
      src.start(t);
      t += buf.duration + (POST_GAP[role] ?? 0);
      sources.push(src);
      last = src;
    });
    if (!last) return resolveDone();
    last.onended = () => resolveDone();
    // Safety net: if the context gets interrupted (tab hidden mid-FX), onended may never fire —
    // resolve shortly after the scheduled end so the FX can't hang on `await voice.done`.
    window.setTimeout(resolveDone, (t - c.currentTime + 2) * 1000);
  })().catch(() => resolveDone());
  const handle = { done, stop };
  active = handle;
  return handle;
}
