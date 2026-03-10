# CLAUDE.md

## Project

Eleventy 3.x static site for zgrey.github.io. Source lives in `src/`, builds to `_site/`, deploys via GitHub Actions to GitHub Pages.

## Commands

- `npm run dev` -- local dev server at localhost:8080
- `npm run build` -- production build to `_site/`
- `npm run audit` -- run npm audit (high severity)
- `npm run lint` -- lint code with ESLint
- `npm run html-validate` -- validate generated HTML
- `npm run gitleaks` -- scan repository for secrets

## Content TODO

- [ ] Research page (`src/research/index.njk`) -- fill in placeholder content with actual research descriptions, publications, and paper links
- [ ] Code page (`src/code/index.njk`) -- add real project links and descriptions (GitHub repos, documentation)
- [ ] EVIE (`src/evie/index.njk`) -- wire up agent backend when ready
- [ ] Run `npm run dev` to preview changes locally before pushing
