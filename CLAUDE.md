# CLAUDE.md

## Project

Eleventy 3.x static site for [zgrey.github.io](https://zgrey.github.io). Source lives in `src/`, builds to `_site/`, deploys via GitHub Actions to GitHub Pages.

## Commands

- `npm run dev` -- local dev server at localhost:8080
- `npm run build` -- production build to `_site/`
- `npm run audit` -- run npm audit (high severity)
- `npm run lint` -- lint code with ESLint (pinned to v8, uses `.eslintrc.json`)
- `npm run html-validate` -- validate generated HTML
- `npm run gitleaks` -- scan repository for secrets (requires gitleaks binary locally)

## CI/CD Pipeline

The GitHub Actions workflow (`.github/workflows/deploy.yml`) runs on every push and PR to `main`:

1. `npm ci` -- deterministic install from lock file
2. `npm run audit` -- fails on high-severity vulnerabilities
3. `npm run lint` -- ESLint with `eslint-config-standard`
4. `gitleaks/gitleaks-action@v2` -- official Gitleaks GitHub Action for secret scanning
5. `npm run build` -- Eleventy static site generation
6. `npm run html-validate` -- HTML validation on generated output

Deploy to GitHub Pages runs **only** on pushes to `main` (PRs run checks without deploying).

## Security

See [SECURITY.md](SECURITY.md) for full details on the security pipeline, permissions model, and hardening recommendations.

## Content TODO

- [ ] Research page (`src/research/index.njk`) -- fill in placeholder content with actual research descriptions, publications, and paper links
- [ ] Code page (`src/code/index.njk`) -- add real project links and descriptions (GitHub repos, documentation)
- [ ] EVIE (`src/evie/index.njk`) -- wire up agent backend when ready
- [ ] Run `npm run dev` to preview changes locally before pushing
