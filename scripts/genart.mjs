// Offline art generator for Debate Simulator.
//
//   node scripts/genart.mjs            # generate every job
//   node scripts/genart.mjs frames     # only jobs tagged "frames"
//   node scripts/genart.mjs --only=card-parchment
//
// Reads OPENAI_API_KEY from the environment or a gitignored .env at repo root.
// Writes committed PNGs under src/ui/art/. This NEVER runs in the game — the key
// stays out of the bundle; the app only loads the baked PNGs.

import { writeFileSync, mkdirSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { execSync } from 'node:child_process';

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
const MODEL = process.env.GENART_MODEL || 'gpt-image-2';
const QUALITY = process.env.GENART_QUALITY || 'medium';

// A shared style + the three expressions; per character only the physical description changes,
// which keeps each caricature consistent across its expression set (validated on Patty Pander).
const STYLE =
  'drawn in the style of a vintage political cartoon / antique trading-card portrait to match an ' +
  'aged-parchment card game. Head-and-shoulders bust portrait, centered, plain warm sepia studio ' +
  'background, soft painterly rendering. No text, no words, no caption, no border.';
const EXPR = {
  confident: 'a big, glossy, overly-confident campaign smile, chin up, self-assured.',
  nervous: 'visibly nervous and anxious — wide worried eyes, a bead of sweat on the brow, a forced uneasy half-smile.',
  embarrassed: 'mortified and embarrassed after a gaffe — cringing, blushing deep red, eyes squeezed, a hand raised near the face.',
};

// An opponent → three expression jobs, keyed `${id}-${mood}.webp` (what the UI looks up).
const opp = (id, spec) =>
  Object.entries(EXPR).map(([mood, expr]) => ({
    id: `${id}-${mood}`,
    tag: 'portraits',
    size: '1024x1024',
    out: `src/ui/art/portraits/${id}-${mood}.png`,
    optimize: { width: 256, quality: 82 },
    prompt: `Editorial caricature of a fictional ${spec} ${STYLE} Their expression: ${expr}`,
  }));
// Player candidates get the same three mood expressions as opponents (their own face reacts too).
// "confident" is a warmer campaign look than the opponents' smug version.
const PLAYER_EXPR = {
  confident: 'a warm, confident, determined campaign-trail look with a slight smile.',
  nervous: EXPR.nervous,
  embarrassed: EXPR.embarrassed,
};
const player = (id, spec) =>
  Object.entries(PLAYER_EXPR).map(([mood, expr]) => ({
    id: `player-${id}-${mood}`,
    tag: 'players',
    size: '1024x1024',
    out: `src/ui/art/portraits/player-${id}-${mood}.png`,
    optimize: { width: 256, quality: 82 },
    prompt: `Editorial caricature of a fictional ${spec} ${STYLE} Their expression: ${expr}`,
  }));

// --- the catalog of images to generate ---
const JOBS = [
  {
    id: 'card-parchment',
    tag: 'frames',
    size: '1024x1536',
    out: 'src/ui/art/frames/card-parchment.png',
    optimize: { width: 320, quality: 82 }, // → committed .webp; raw .png is dropped
    prompt:
      'A blank antique trading-card frame on aged cream parchment paper. Subtle paper grain and ' +
      'faint foxing/age spots. A VERY THIN ornate engraved border line in muted antique gold and ' +
      'sepia runs close to the very outer edge of the card, hugging the rim with only a tiny margin. ' +
      'The central area is as LARGE as possible — a generous, clean, smooth, flat EMPTY field filling ' +
      'almost the entire card (a roomy space for text to be placed later); keep the border slim so the ' +
      'inner field is maximized. Absolutely no text, no letters, no words, no numbers, no illustration, ' +
      'no portrait, no characters, no symbols, no ornament in the center — only near the edges. Flat ' +
      'front-facing scan, soft even lighting, vintage 19th-century political campaign card aesthetic. ' +
      'Portrait orientation.',
  },
  {
    // Sibling of card-parchment, but for power-up/action cards (the sneaky political
    // maneuvers): a dark "classified campaign dossier" instead of cream parchment, so
    // they read as a different kind of object. Kept NEUTRAL/dark so the per-effect colored
    // borders + banners (set in CSS) still pop on top.
    id: 'card-action',
    tag: 'frames',
    size: '1024x1536',
    out: 'src/ui/art/frames/card-action.png',
    optimize: { width: 320, quality: 82 }, // → committed .webp; raw .png is dropped
    prompt:
      'A blank dark "classified dossier" trading-card frame. The card is a desaturated dark ' +
      'SLATE-BLUE-GREY (NOT pure black — clearly a dark grey-blue so its surface is visible), with a ' +
      'CLEARLY VISIBLE leathery cardstock grain and faint scuffs across the whole surface, like the ' +
      'cover of a confidential government file folder. A distinct ornate engraved DOUBLE border line in ' +
      'tarnished antique silver runs all the way around, close to the outer edge, with small filigree ' +
      'corner flourishes — visible but slim. The central area is as LARGE as possible: a generous, ' +
      'clean, smooth, flat EMPTY dark slate field filling almost the entire card (a roomy space for ' +
      'light text to be placed later). Absolutely no text, no letters, no words, no numbers, no ' +
      'illustration, no portrait, no characters, no symbols, no stamps, no ornament in the center — ' +
      'only the border near the edges. Flat front-facing scan, soft EVEN bright studio lighting (so the ' +
      'grain texture is clearly visible), vintage spy-dossier / secret-campaign-memo aesthetic. ' +
      'Portrait orientation.',
  },
  // --- opponents (match cards.ts OPPONENTS ids: pander/blowhard/passer/smearwell/slander/grandstand) ---
  ...opp('pander', 'female American politician, "Gov. Patty Pander", about 55, neat blonde bob with a slight flip, pearl earrings and a single strand of pearls, tailored bright teal skirt-suit blazer with a small American-flag lapel pin, rosy cheeks, exaggerated wide expressive eyes, slightly overdone makeup'),
  ...opp('blowhard', 'male U.S. senator, "Senator Blowhard", about 60, stout and barrel-chested, florid ruddy face with heavy jowls, thinning grey-blond comb-over, double-breasted navy pinstripe suit, loud red power tie, flag lapel pin, puffed-up self-important posture'),
  ...opp('passer', 'male mayor, "Mayor Buck Passer", about 50, slick gelled dark hair, deep perma-tan, gleaming over-white capped-teeth smile, sharp charcoal suit, a shifty evasive sideways glance, oily salesman charm'),
  ...opp('smearwell', 'male congressman, "Rep. Dirk Smearwell", about 45, lean and angular, slicked-back black hair, sharp pointed features, a thin pencil mustache, one arched eyebrow, a sardonic sneer, steel-grey suit with a dark crimson tie'),
  ...opp('slander', 'female judge-turned-politician, "Justice Vera Slander", about 50, poised and severe, sleek black hair pulled into a tight bun, sharp cheekbones, a cool composed icy stare, dark tailored blazer, minimal elegant jewelry'),
  ...opp('grandstand', 'aristocratic elderly statesman, "Maximilian Q. Grandstand III", about 65, patrician, silver swept-back hair, a waxed white handlebar mustache, a monocle, a three-piece suit with pocket square and boutonniere, supremely smug and unflappable'),
  // --- selectable player candidates ---
  ...player('maverick', 'rugged outsider political candidate, about 45, tousled brown hair, a strong jaw, an open-collar white shirt with sleeves rolled up, an energetic grin'),
  ...player('stateswoman', 'poised female political candidate, about 45, shoulder-length auburn hair, a sharp modern navy pantsuit, a warm but commanding presence'),
  ...player('veteran', 'distinguished older political candidate, about 60, neat grey hair, a kind weathered face, a classic dark suit with a flag lapel pin, dignified and trustworthy'),
];

async function generate(job) {
  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, prompt: job.prompt, size: job.size, quality: QUALITY, n: 1 }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`${res.status} ${JSON.stringify(body.error ?? body)}`);
  const b64 = body.data?.[0]?.b64_json;
  if (!b64) throw new Error('no image data in response');
  const outPath = join(root, job.out);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, Buffer.from(b64, 'base64'));

  // Optimize for the web: a 1024px PNG is huge for a ~140px card. Downscale to WebP
  // (needs ImageMagick `convert`) and drop the raw PNG so only the small asset is committed.
  if (job.optimize) {
    const webp = outPath.replace(/\.png$/, '.webp');
    try {
      execSync(
        `convert ${JSON.stringify(outPath)} -resize ${job.optimize.width}x ` +
          `-quality ${job.optimize.quality ?? 82} ${JSON.stringify(webp)}`,
      );
      rmSync(outPath);
      const kb = Math.round((readFileSync(webp).length / 1024) * 10) / 10;
      console.log(`  ✓ ${job.id} → ${job.out.replace(/\.png$/, '.webp')} (${kb} KB)`);
      return;
    } catch (e) {
      console.warn(`  ! ${job.id}: optimize failed (${e.message}); keeping raw PNG`);
    }
  }
  const kb = Math.round(Buffer.from(b64, 'base64').length / 1024);
  console.log(`  ✓ ${job.id} → ${job.out} (${kb} KB)`);
}

const args = process.argv.slice(2);
const force = args.includes('--force'); // regenerate even if the asset already exists
const onlyArg = args.find((a) => a.startsWith('--only='));
const only = onlyArg ? onlyArg.slice(7) : null;
const tag = args.find((a) => !a.startsWith('--')) ?? null;
const selected = JOBS.filter((j) => (only ? j.id === only : tag ? j.tag === tag : true));
if (!selected.length) {
  console.error(`No jobs matched. Known tags: frames, portraits, players. ids: ${JOBS.map((j) => j.id).join(', ')}`);
  process.exit(1);
}

// Idempotent: skip jobs whose final asset already exists (so re-running won't burn budget
// or alter approved art). Use --force to regenerate.
const finalPath = (j) => join(root, j.optimize ? j.out.replace(/\.png$/, '.webp') : j.out);
const jobs = force ? selected : selected.filter((j) => !existsSync(finalPath(j)));
const skipped = selected.length - jobs.length;

if (!jobs.length) {
  console.log(`Nothing to do — all ${selected.length} selected asset(s) already exist (use --force to regenerate).`);
  process.exit(0);
}
console.log(`Generating ${jobs.length} image(s) with ${MODEL} (quality=${QUALITY})${skipped ? `; skipping ${skipped} existing` : ''}…`);
for (const job of jobs) {
  try {
    await generate(job);
  } catch (e) {
    console.error(`  ✗ ${job.id}: ${e.message}`);
  }
}
console.log('Done.');
