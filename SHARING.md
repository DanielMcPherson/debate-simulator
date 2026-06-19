# Sharing the prototype with playtesters

This is a **static, client-side app** (Vite + TypeScript — no backend, no API keys,
no database). `npm run build` produces a self-contained `dist/` folder (~30 KB of
HTML/JS/CSS) that runs on any static host. Options below, easiest first.

First, always build the latest:

```bash
npm run build      # outputs dist/
```

---

## 1. Drag-and-drop — no account, instant (best for sending a stranger a link)

1. Run `npm run build`.
2. Go to **https://app.netlify.com/drop**
3. Drag the **`dist/`** folder onto the page → you get a public URL in seconds.

To update later: rebuild and drag `dist/` again (you'll get a new URL unless you
claim the site to a free account).

## 2. One-command deploy — persistent, updatable URL

From the project folder, after `npm run build`:

```bash
npx vercel deploy --prod          # Vercel (prompts a quick login the first time)
npx netlify deploy --prod --dir=dist   # Netlify CLI
npx surge dist                    # Surge — pick a yourname.surge.sh subdomain
```

All free, all serve `dist/` at a root URL (no config needed). Re-run to update.

## 3. Same network, no deploy (someone on your Wi-Fi / next to you)

```bash
npm run dev -- --host
```

Then share the **Network** URL it prints, e.g. `http://192.168.x.x:5173`.
Only reachable on the same network.

## 4. Temporary public link to your machine (live watch-along session)

```bash
npm run dev -- --host
# in a second terminal:
npx cloudflared tunnel --url http://localhost:5173
```

Gives a throwaway `https://….trycloudflare.com` URL that works anywhere while your
machine keeps running it. Disappears when you stop it.

## 5. Send the code

Zip the folder **without `node_modules`**; the recipient runs:

```bash
npm install
npm run dev
```

Requires Node.js installed.

---

## Recommendation

- **Playtesters (the current setup):** the game is already live on **GitHub Pages**
  at https://danielmcpherson.github.io/debate-simulator/ — just send the link. See
  **option 6** below for how it works and how to ship updates. Options 1–2 are
  alternatives if you ever want a one-off link off GitHub.
- **Someone with you:** option 3.

## 6. GitHub Pages (this is the LIVE setup) ✅

The game is published here — send this to playtesters (no login needed on their end):

> **https://danielmcpherson.github.io/debate-simulator/**

It's hosted from the public repo **github.com/DanielMcPherson/debate-simulator** via
GitHub Actions. Nothing to re-set-up; this section is the "how it works + how to
ship updates" reference.

### How it's wired

- `vite.config.ts` sets `base: './'` (relative asset paths), so the build works
  under the `/debate-simulator/` subpath.
- `.github/workflows/deploy.yml` runs `npm ci && npm run build` and publishes
  `dist/` to Pages on **every push to `master`** (and via a manual **Run workflow**
  button on the Actions tab). You never commit `dist/` — the workflow builds it.
- Repo **Settings → Pages → Source** is set to **GitHub Actions**.

### Shipping an update (the normal loop)

1. Make your code change.
2. `npm test` and `npm run build` locally to catch errors before they reach CI.
3. **Commit and push with GitHub Desktop** (this repo lives on a personal GitHub
   account that's only wired up through GitHub Desktop — do **not** push from the
   command line, which is signed in to a different account).
4. The push triggers the workflow; watch it on the repo's **Actions** tab. In
   ~30s–1min the live site updates. Hard-refresh (Ctrl/Cmd-Shift-R) if you don't
   see the change — the browser may have cached the old assets.

If a push ever doesn't trigger a build, open the **Actions** tab → **Deploy to
GitHub Pages** → **Run workflow** to deploy manually.

### Heads-up: deprecation warnings

The Actions run shows two yellow "Node.js 20 is deprecated…" warnings about the
bundled runtime of the GitHub-provided actions (checkout / setup-node /
upload-pages-artifact / deploy-pages). They're cosmetic and non-blocking; they'll
clear when those actions ship Node 24 majors.
