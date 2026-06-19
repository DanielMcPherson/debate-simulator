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

- **Remote playtester:** option 1 (Netlify Drop) for zero setup, or option 2
  (`npx vercel`) if you want a stable link you can re-deploy to.
- **Someone with you:** option 3.

## 6. GitHub Pages (auto-deploy on push)

Configured and ready: `vite.config.ts` sets `base: './'` (relative asset paths, so
it works at a root *or* a subpath), and `.github/workflows/deploy.yml` builds and
publishes `dist/` on every push to `main`. You don't commit `dist/` — the workflow
builds it.

One-time setup:

```bash
# from the project folder, if it isn't a git repo yet:
git init -b main
git add .
git commit -m "Debate simulator"

# create the repo and push (GitHub CLI; or create it on github.com and add the remote):
gh repo create <repo-name> --public --source=. --push
# …or manually:
#   git remote add origin https://github.com/<username>/<repo-name>.git
#   git push -u origin main
```

Then on GitHub: **Settings → Pages → Build and deployment → Source: GitHub
Actions**. The next push (or a manual run from the **Actions** tab) deploys it.

Your URL depends on the repo name:

- **Project site** — repo named anything (e.g. `debate-simulator`) →
  `https://<username>.github.io/debate-simulator/`
- **User site** — repo named exactly `<username>.github.io` →
  `https://<username>.github.io/`

The relative `base` means **both work without further changes**. To update the live
site later, just push to `main`.
