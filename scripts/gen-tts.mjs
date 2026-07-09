// Offline TTS clip generator for Debate Simulator (phase-1 voice scaffolding).
//
//   npm run gentts                     # synthesize every manifest clip that's missing/stale
//   npm run gentts -- --sample=12      # a small role-diverse subset (cheap voice audition)
//   npm run gentts -- --voice=onyx     # audition a different narrator voice
//   npm run gentts -- --only=s_opp     # regenerate one clip
//   npm run gentts -- --force          # ignore the cache, regenerate everything selected
//   npm run gentts -- --preview        # stitch sample statements into voice-preview/ and LISTEN
//
// Reads voice-manifest.json (run `npm run genclips` first if cards.ts changed) and writes
// committed mp3s under public/voice/ (served verbatim, fetched by URL at playback — see
// src/ui/speech.ts), one per surface form, keyed by the manifest `file` name.
// Reads OPENAI_API_KEY from the environment or the gitignored .env at repo root — this NEVER
// runs in the game; the app only plays the baked clips (static, backend-free, key stays out
// of the bundle). Mirrors scripts/genart.mjs.
//
// PROVIDER SEAM (decision 2026-07-09): OpenAI-first (`gpt-4o-mini-tts`, ~$0.50 per full-deck
// pass) because the key already exists and iteration is near-free while cards keep changing.
// All provider-specific code lives in synthesize() — if stitched seams disappoint, swap in an
// ElevenLabs implementation and `--force` a regeneration; the manifest, cache, ffmpeg post
// and preview harness are provider-agnostic. A bad first voice is a reason to change VOICE,
// never a verdict on statement narration itself.
//
// Post-processing (ffmpeg): trim edge silence, RMS-normalize (NOT loudnorm — integrated-loudness
// measurement is statistically unstable on sub-3s clips and produced audibly uneven levels, the
// first playtest's main complaint; plain measured gain toward a target mean with a peak ceiling
// is rock-stable for short speech), tempo-up (`--tempo`, default 1.1 — pitch-preserving; the
// deadpan read tested slower than natural), tiny tail pad, mono mp3.
// Raw synthesized wavs are kept in gitignored voice-raw/ so every post knob (trim, gain, tempo)
// can be re-tuned WITHOUT re-calling the API — `npm run gentts` re-posts from the raw cache.

import { writeFileSync, mkdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// --- minimal .env loader (no dependency) ---
function loadEnv() {
  const p = join(root, '.env');
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
loadEnv();

const API_KEY = process.env.OPENAI_API_KEY;
if (!API_KEY) {
  console.error('Missing OPENAI_API_KEY (set it in .env or the environment).');
  process.exit(1);
}

// --- CLI ---
const args = process.argv.slice(2);
const flag = (name) => {
  const a = args.find((x) => x === `--${name}` || x.startsWith(`--${name}=`));
  if (!a) return undefined;
  return a.includes('=') ? a.slice(a.indexOf('=') + 1) : true;
};
const MODEL = flag('model') || process.env.GENTTS_MODEL || 'gpt-4o-mini-tts';
const VOICE = flag('voice') || process.env.GENTTS_VOICE || 'ash';
const FORCE = !!flag('force');
const ONLY = flag('only');
const SAMPLE = flag('sample') ? parseInt(flag('sample'), 10) : null;
const PREVIEW = !!flag('preview');
const TEMPO = parseFloat(flag('tempo') || process.env.GENTTS_TEMPO || '1.1'); // pitch-preserving speed-up
const CONCURRENCY = 4;
if (!Number.isFinite(TEMPO) || TEMPO < 0.5 || TEMPO > 2) {
  console.error(`--tempo must be 0.5–2 (got ${flag('tempo')}).`);
  process.exit(1);
}

// The single deadpan moderator/announcer voice (see the voice-scoping decision in gen-clips.ts).
// Role-aware tail: most chunks sit MID-sentence when stitched, so fight the model's instinct to
// read each fragment as a complete sentence with a final falling cadence; finishers really do
// end the sentence and may cadence naturally.
const BASE_INSTRUCTIONS =
  'You are the deadpan moderator-announcer of a televised political debate, reading a statement ' +
  'into the record. Flat, dry, matter-of-fact public-broadcast delivery — neutral American ' +
  'accent, a brisk businesslike pace (never sluggish, breathy, or drawn out), no excitement, ' +
  'no comedy, no emphasis swings, no whispering. Volume steady and consistent.';
const ROLE_INSTRUCTIONS = {
  intensifier:
    ' This fragment is the final flourish that ENDS the sentence; a natural closing cadence is appropriate.',
  powerup: ' Read this short card title plainly.',
};
const MID_SENTENCE =
  ' This text is a FRAGMENT of a longer sentence already in progress: keep the intonation open ' +
  'and level, as if more words follow immediately — do not add a sentence-final falling cadence.';
const instructionsFor = (role) => BASE_INSTRUCTIONS + (ROLE_INSTRUCTIONS[role] ?? MID_SENTENCE);

// What is actually SPOKEN. Power-up labels are UI text ("🎤 Teleprompter Typo — REPLACE their
// last word with yours") — speak only the card name; and strip emoji everywhere.
function speakable(clip) {
  let t = clip.text;
  if (clip.role === 'powerup') t = t.split('—')[0];
  return t.replace(/[\p{Extended_Pictographic}️]/gu, '').replace(/\s+/g, ' ').trim();
}

// --- manifest + cache ---
const manifestPath = join(root, 'voice-manifest.json');
if (!existsSync(manifestPath)) {
  console.error('voice-manifest.json not found — run `npm run genclips` first.');
  process.exit(1);
}
const cardsPath = join(root, 'src/data/cards.ts');
if (existsSync(cardsPath) && statSync(cardsPath).mtimeMs > statSync(manifestPath).mtimeMs) {
  console.warn('⚠ voice-manifest.json is OLDER than src/data/cards.ts — run `npm run genclips` to refresh it.');
}
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

const outDir = join(root, 'public/voice');
const rawDir = join(root, 'voice-raw'); // gitignored raw synth cache — post knobs re-run for free
mkdirSync(outDir, { recursive: true });
mkdirSync(rawDir, { recursive: true });
const cachePath = join(outDir, 'voice-cache.json');
const cache = existsSync(cachePath) ? JSON.parse(readFileSync(cachePath, 'utf8')) : {};
const saveCache = () => writeFileSync(cachePath, JSON.stringify(cache, null, 2) + '\n');

// Two staleness axes, cached per clip as { s, p }: the SYNTH hash (what the API produced — text,
// voice, model, instructions; a mismatch or missing raw wav costs an API call) and the POST hash
// (the ffmpeg knobs — a mismatch just re-encodes from the cached raw). Old-format string entries
// (pre raw-cache) count as fully stale.
const sha1 = (s) => createHash('sha1').update(s).digest('hex');
const synthHash = (clip) => sha1([speakable(clip), VOICE, MODEL, instructionsFor(clip.role)].join('|'));
const rawPathOf = (clip) => join(rawDir, `${clip.key}.wav`);
function isStale(clip) {
  const e = cache[clip.key];
  if (FORCE || !e || typeof e !== 'object') return true;
  return e.s !== synthHash(clip) || e.p !== POST_HASH || !existsSync(join(outDir, clip.file));
}
function needsSynth(clip) {
  const e = cache[clip.key];
  return FORCE || !e || typeof e !== 'object' || e.s !== synthHash(clip) || !existsSync(rawPathOf(clip));
}

// --- selection ---
let selected = manifest.clips;
if (ONLY) {
  selected = selected.filter((c) => c.key === ONLY);
  if (!selected.length) {
    console.error(`No manifest clip with key "${ONLY}".`);
    process.exit(1);
  }
}
if (SAMPLE) {
  // Deterministic role-diverse subset: round-robin across roles in manifest order.
  const byRole = new Map();
  for (const c of manifest.clips) {
    if (!byRole.has(c.role)) byRole.set(c.role, []);
    byRole.get(c.role).push(c);
  }
  const picked = [];
  for (let i = 0; picked.length < SAMPLE; i++) {
    let added = false;
    for (const list of byRole.values()) {
      if (i < list.length && picked.length < SAMPLE) {
        picked.push(list[i]);
        added = true;
      }
    }
    if (!added) break;
  }
  selected = picked;
}

// --- synthesis (THE PROVIDER SEAM — everything OpenAI-specific lives here) ---
async function synthesize(text, role) {
  const res = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      voice: VOICE,
      input: text,
      instructions: instructionsFor(role),
      response_format: 'wav',
    }),
  });
  if (!res.ok) {
    let detail = '';
    try {
      detail = JSON.stringify((await res.json()).error ?? '');
    } catch {}
    throw new Error(`${res.status} ${detail}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

// --- ffmpeg post: trim edges → RMS gain → tempo → pad → mono mp3 ---
// Trim keeps 20ms at each edge with a gentle -50dB threshold (the old -45dB shaved soft onsets);
// gain is measured per clip (volumedetect over the TRIMMED audio) toward a fixed mean, clamped so
// peaks stay under the ceiling — uniform loudness is what makes per-chunk stitching viable.
const TRIM = 'silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.02';
const TRIM_CHAIN = `${TRIM},areverse,${TRIM},areverse`;
const TARGET_MEAN_DB = -20;
const PEAK_CEIL_DB = -1.5;
const PAD = 'apad=pad_dur=0.02';
const POST_HASH = sha1(['post-v2', TRIM_CHAIN, TARGET_MEAN_DB, PEAK_CEIL_DB, TEMPO, PAD, '24000/q7'].join('|'));

function measureLevels(rawPath) {
  const res = spawnSync(
    'ffmpeg',
    ['-hide_banner', '-i', rawPath, '-af', `${TRIM_CHAIN},volumedetect`, '-f', 'null', '-'],
    { encoding: 'utf8' },
  );
  const err = res.stderr ?? '';
  return {
    mean: parseFloat(/mean_volume:\s*(-?[\d.]+) dB/.exec(err)?.[1] ?? 'NaN'),
    max: parseFloat(/max_volume:\s*(-?[\d.]+) dB/.exec(err)?.[1] ?? 'NaN'),
  };
}

function postProcess(rawPath, mp3Path) {
  const { mean, max } = measureLevels(rawPath);
  let gain = Number.isFinite(mean) ? TARGET_MEAN_DB - mean : 0;
  if (Number.isFinite(max) && max + gain > PEAK_CEIL_DB) gain = PEAK_CEIL_DB - max;
  const filters = [
    TRIM_CHAIN,
    `volume=${gain.toFixed(1)}dB`,
    ...(TEMPO !== 1 ? [`atempo=${TEMPO}`] : []),
    PAD,
  ].join(',');
  execFileSync('ffmpeg', [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-i', rawPath,
    '-af', filters,
    // gpt-4o-mini-tts sources are 24 kHz — keep the native rate (upsampling only wastes bits).
    '-ar', '24000', '-ac', '1', '-codec:a', 'libmp3lame', '-q:a', '7',
    mp3Path,
  ]);
}

async function generate(clip) {
  const rawPath = rawPathOf(clip);
  if (needsSynth(clip)) {
    const wav = await synthesize(speakable(clip), clip.role);
    writeFileSync(rawPath, wav);
  }
  postProcess(rawPath, join(outDir, clip.file));
  cache[clip.key] = { s: synthHash(clip), p: POST_HASH };
}

// --- preview: stitch representative statements so the seams can be JUDGED BY EAR ---
// Chosen to cover the risky joins: additive predicate chain, comma-set aside, finisher cadence,
// a because-clause with a plural second subject, and a reward-connector pivot back to "I".
const PREVIEW_STATEMENTS = [
  { name: 'namesake-chain', keys: ['s_opp', 'p_kick_pup.3sg', 'c_and', 'p_lie.3sg'] },
  { name: 'aside', keys: ['s_opp', 'm_crook.3sg', 'p_kick_pup.3sg'] },
  { name: 'finisher', keys: ['s_i', 'p_fight_for_you', 'x_believe'] },
  { name: 'because-plural', keys: ['s_opp', 'p_lie.3sg', 'c_because', 's_career', 'p_kick_pup.pl'] },
  { name: 'pivot', keys: ['s_opp', 'p_kick_pup.3sg', 'r_conj_unlikecertain', 's_i', 'p_protect_vets.pl', 'x_guarantee'] },
];

async function runPreview() {
  const byKey = new Map(manifest.clips.map((c) => [c.key, c]));
  const previewDir = join(root, 'voice-preview');
  mkdirSync(previewDir, { recursive: true });
  for (const stmt of PREVIEW_STATEMENTS) {
    const clips = stmt.keys.map((k) => byKey.get(k));
    const missing = stmt.keys.filter((k, i) => !clips[i]);
    if (missing.length) {
      console.warn(`  ! ${stmt.name}: keys not in manifest (${missing.join(', ')}) — skipped`);
      continue;
    }
    // Generate any clips the statement needs that don't exist yet.
    for (const clip of clips) {
      if (isStale(clip)) {
        console.log(`  … regenerating missing/stale clip ${clip.key}`);
        await generate(clip);
      }
    }
    const list = clips.map((c) => `file '${join(outDir, c.file)}'`).join('\n');
    const listPath = join(tmpdir(), `gentts-${stmt.name}.txt`);
    writeFileSync(listPath, list + '\n');
    const out = join(previewDir, `${stmt.name}.mp3`);
    execFileSync('ffmpeg', [
      '-y', '-hide_banner', '-loglevel', 'error',
      '-f', 'concat', '-safe', '0', '-i', listPath,
      '-codec:a', 'libmp3lame', '-q:a', '6',
      out,
    ]);
    console.log(`  ✓ ${stmt.name}: "${clips.map((c) => speakable(c)).join(' ')}" → voice-preview/${stmt.name}.mp3`);
  }
  saveCache();
  console.log('Listen to voice-preview/*.mp3 — this is the OpenAI-vs-ElevenLabs verdict input.');
}

// --- main ---
async function main() {
  if (PREVIEW) {
    await runPreview();
    return;
  }

  const stale = selected.filter(isStale);
  const skipped = selected.length - stale.length;
  if (!stale.length) {
    console.log(`Nothing to do — all ${selected.length} selected clip(s) are current (use --force to regenerate).`);
    return;
  }
  const apiClips = stale.filter(needsSynth);
  const chars = apiClips.reduce((n, c) => n + speakable(c).length, 0);
  console.log(
    `Processing ${stale.length} clip(s): ${apiClips.length} via ${MODEL} voice=${VOICE} (~${chars} chars), ` +
      `${stale.length - apiClips.length} re-posted from voice-raw/ (free)` +
      `${skipped ? `; ${skipped} already current` : ''}…`,
  );

  const failures = [];
  let done = 0;
  const queue = [...stale];
  async function worker() {
    for (let clip = queue.shift(); clip; clip = queue.shift()) {
      try {
        await generate(clip);
        done++;
        console.log(`  ✓ [${done}/${stale.length}] ${clip.key} — "${clip.text}"`);
        if (done % 25 === 0) saveCache(); // survive an interrupt without losing progress
      } catch (e) {
        failures.push(clip.key);
        console.error(`  ✗ ${clip.key}: ${e.message}`);
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  saveCache();
  console.log(`Done: ${done} generated, ${failures.length} failed.`);
  if (failures.length) {
    console.error(`Failed clips (re-run to retry): ${failures.join(', ')}`);
    process.exitCode = 1;
  }
}

await main();
