# CLAUDE.md

## Project

Eleventy 3.x static site for [zgrey.github.io](https://zgrey.github.io). Source lives in `src/`, builds to `_site/`, deploys via GitHub Actions to GitHub Pages. CI and local development target Node 24 (required by `html-validate` 11).

## Commands

- `npm run dev` -- local dev server at localhost:8080
- `npm run build` -- production build to `_site/`
- `npm run audit` -- run npm audit (high severity)
- `npm run lint` -- lint code with ESLint 10 (flat config, `eslint.config.js`)
- `npm run html-validate` -- validate generated HTML
- `npm run gitleaks` -- scan repository for secrets (requires gitleaks binary locally)

## CI/CD Pipeline

The GitHub Actions workflow (`.github/workflows/deploy.yml`) runs on every push and PR to `main`:

1. `npm ci` -- deterministic install from lock file
2. `npm run audit` -- fails on high-severity vulnerabilities
3. `npm run lint` -- ESLint 10 flat config (`@eslint/js` recommended)
4. `gitleaks/gitleaks-action@v2` -- official Gitleaks GitHub Action for secret scanning
5. `npm run build` -- Eleventy static site generation
6. `npm run html-validate` -- HTML validation on generated output

Deploy to GitHub Pages runs **only** on pushes to `main` (PRs run checks without deploying).

## Security

See [SECURITY.md](SECURITY.md) for full details on the security pipeline, permissions model, and hardening recommendations.

## SST walkthrough (read this before touching `src/sst/`)

There is **no `/sst/` page**. The interactive walkthrough is embedded in the Separable Shape
Tensors section of `src/research/index.njk`, behind a launcher, and the former `/sst/` and
`/sst/map/` pages were removed. The directory is therefore not what it looks like:

- `src/sst/scenes/*.njk` -- scene content, tagged `sstScene` via `scenes/scenes.json`, with
  `permalink: false`. These are data, not pages; they build to nothing on their own.
- `src/sst/scenes.json.njk` -- builds the `/sst/scenes.json` **data endpoint** the player
  fetches. This is the only thing under `/sst/` in the output.
- `src/assets/js/sst/player.js` -- boots on `#sst-app`, lazily behind `#sst-launch`. The map
  is a panel inside the embed, not a page.

Two invariants worth preserving: scene ids are written to the URL under an **`sst-` prefix**
so they cannot collide with the research page's own section anchors (a bare hash must be left
untouched), and anything linking to a scene must not point at `/sst/#id`, which no longer
resolves. Widgets can also mount outside the player as standalone figures via `[data-widget]`.

## Content TODO

- [ ] EVIE (`src/evie/index.njk`) -- wire up agent backend when ready
- [ ] Research page -- SST, Dimension Reduction, and Bi-Criteria Spectrum Sharing sections are
      written with real citations; remaining work is adding further research areas as they mature
- [ ] Code page -- G2Aero and active_subspaces carry real links and Key references; add further
      projects as they are published
- [ ] Run `npm run dev` to preview changes locally before pushing

Security follow-ups are tracked separately in [SECURITY.md](SECURITY.md) under
"Recommendations for Further Hardening" -- start there, not here, for hardening work.
