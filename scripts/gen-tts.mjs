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
// committed mp3s under src/ui/voice/, one per surface form, keyed by the manifest `file` name.
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
// Post-processing (ffmpeg): trim edge silence, EBU loudness-normalize (uniform level is what
// makes per-chunk stitching viable), tiny tail pad for crossfade material, mono mp3.

import { writeFileSync, mkdirSync, readFileSync, existsSync, statSync, rmSync, mkdtempSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
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
const CONCURRENCY = 4;

// The single deadpan moderator/announcer voice (see the voice-scoping decision in gen-clips.ts).
// Role-aware tail: most chunks sit MID-sentence when stitched, so fight the model's instinct to
// read each fragment as a complete sentence with a final falling cadence; finishers really do
// end the sentence and may cadence naturally.
const BASE_INSTRUCTIONS =
  'You are the deadpan moderator-announcer of a televised political debate, reading a statement ' +
  'into the record. Flat, dry, perfectly measured public-broadcast delivery — neutral American ' +
  'accent, even unhurried pacing, no excitement, no comedy, no emphasis swings, no whispering. ' +
  'Volume steady and consistent.';
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

const outDir = join(root, 'src/ui/voice');
mkdirSync(outDir, { recursive: true });
const cachePath = join(outDir, 'voice-cache.json');
const cache = existsSync(cachePath) ? JSON.parse(readFileSync(cachePath, 'utf8')) : {};
const saveCache = () => writeFileSync(cachePath, JSON.stringify(cache, null, 2) + '\n');

// A clip is stale when anything that shaped its audio changed: the words, the voice, the model,
// or the delivery instructions.
const clipHash = (clip) =>
  createHash('sha1')
    .update([speakable(clip), VOICE, MODEL, instructionsFor(clip.role)].join(' '))
    .digest('hex');

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

// --- ffmpeg post: trim edge silence, loudness-normalize, pad tail, mono mp3 ---
const FILTERS = [
  'silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.05',
  'areverse',
  'silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.05',
  'areverse',
  'loudnorm=I=-16:TP=-1.5:LRA=11',
  'apad=pad_dur=0.04',
].join(',');
function postProcess(wavPath, mp3Path) {
  execFileSync('ffmpeg', [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-i', wavPath,
    '-af', FILTERS,
    // gpt-4o-mini-tts sources are 24 kHz — keep the native rate (upsampling only wastes bits).
    '-ar', '24000', '-ac', '1', '-codec:a', 'libmp3lame', '-q:a', '7',
    mp3Path,
  ]);
}

const tmp = mkdtempSync(join(tmpdir(), 'gentts-'));
async function generate(clip) {
  const wav = await synthesize(speakable(clip), clip.role);
  const wavPath = join(tmp, `${clip.key}.wav`);
  writeFileSync(wavPath, wav);
  postProcess(wavPath, join(outDir, clip.file));
  rmSync(wavPath);
  cache[clip.key] = clipHash(clip);
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
      if (!existsSync(join(outDir, clip.file)) || cache[clip.key] !== clipHash(clip)) {
        console.log(`  … synthesizing missing/stale clip ${clip.key}`);
        await generate(clip);
      }
    }
    const list = clips.map((c) => `file '${join(outDir, c.file)}'`).join('\n');
    const listPath = join(tmp, `${stmt.name}.txt`);
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

  const stale = selected.filter(
    (c) => FORCE || !existsSync(join(outDir, c.file)) || cache[c.key] !== clipHash(c),
  );
  const skipped = selected.length - stale.length;
  if (!stale.length) {
    console.log(`Nothing to do — all ${selected.length} selected clip(s) are current (use --force to regenerate).`);
    return;
  }
  const chars = stale.reduce((n, c) => n + speakable(c).length, 0);
  console.log(
    `Synthesizing ${stale.length} clip(s) with ${MODEL} voice=${VOICE} (~${chars} chars)` +
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
rmSync(tmp, { recursive: true, force: true });
