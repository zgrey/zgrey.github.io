# Security — zgrey.github.io

## CI/CD Pipeline

The GitHub Actions workflow (`.github/workflows/deploy.yml`) runs on every push to `main` and every pull request targeting `main`.

### Build Checks (run on all pushes and PRs)

| Step | Tool | What it does |
|------|------|-------------|
| Install | `npm ci` | Deterministic install from `package-lock.json`; fails on lockfile drift |
| Dependency audit | `npm audit --audit-level=high` | Fails the build on high-severity vulnerabilities |
| Linting | ESLint 10 (flat config, `@eslint/js` recommended) | Static analysis with relaxed rules for legacy code |
| Secret scanning | [`gitleaks/gitleaks-action@v2`](https://github.com/gitleaks/gitleaks-action) | Official Gitleaks GitHub Action scans for leaked secrets |
| Build | `npx @11ty/eleventy` | Generates static site to `_site/` |
| HTML validation | `html-validate` | Validates all generated HTML against recommended rules |

### Code scanning (separate from `deploy.yml`)

CodeQL runs on the same pushes and PRs via GitHub's **default setup**, configured in
repository Settings → Code security, *not* by a committed workflow. There is deliberately
no `.github/workflows/codeql.yml`; if you go looking for one, that is why. It surfaces as
four additional checks on every PR: `CodeQL`, plus `Analyze (actions)`,
`Analyze (javascript-typescript)`, and `Analyze (python)`.

The Python analysis is not vestigial — the repo carries Python under `scripts/`, `manim/`,
and `src/python/` even though none of it ships to the site. Switching to an advanced
(committed-workflow) setup would let you pin the query suite and language matrix, at the
cost of maintaining the workflow.

### Deploy (main branch only)

Artifacts are uploaded and deployed to GitHub Pages **only** on pushes to `main`. Pull requests run the full check suite without deploying.

### Permissions

```yaml
permissions:
  contents: read    # read-only access to source
  pages: write      # write access to GitHub Pages
  id-token: write   # OIDC token for Pages deployment
```

Minimal privilege model — no write access to repository contents.

## Configuration Files

| File | Purpose |
|------|---------|
| `eslint.config.js` | ESLint 10 flat config; `@eslint/js` recommended with `no-undef`/`no-unused-vars` off for legacy browser code, `_site/` ignored |
| `.htmlvalidate.json` | HTML validation; allows inline styles, void-style, and trailing whitespace (template artifacts) |
| `.gitleaks.toml` | Gitleaks baseline config (extend to allowlist known false positives) |

## Dependency Management

- ESLint is on v10 with flat config (`eslint.config.js`). `eslint-config-standard` was dropped in the v8->v10 migration: it was never ported to flat config (it still peer-deps `eslint ^8`) and its stylistic ruleset was already switched off, so `@eslint/js` recommended is the equivalent baseline.
- CI runs Node 24. `html-validate` 11 requires Node `^22.22.0 || >=24.8.0`, so Node 20 is no longer supported by the toolchain.
- `package.json` `overrides` force patched transitive dependencies; each entry is explained in the adjacent `comments` block. `@11ty/recursive-copy` is overridden to `^5.0.2` because Eleventy 3.1.6 still pins `^4.0.4`, whose `minimatch` 3.x pulls a `brace-expansion` vulnerable to GHSA-mh99-v99m-4gvg. Re-check on each Eleventy release and drop the override when it is no longer needed.
- The `gitleaks` npm package was removed from `devDependencies` (non-functional placeholder). Secret scanning in CI uses the official GitHub Action; local scanning requires the [gitleaks binary](https://github.com/gitleaks/gitleaks#installing).

## Already in place

- **Dependabot security updates** are active — they have opened and merged PRs against this
  repo (#4, #5, #9). Note there is **no `.github/dependabot.yml`**, so this is security-alert
  updates only; scheduled *version* updates are not configured. Adding that file is the
  remaining half of the story if you want routine bumps rather than only advisory-driven ones.
- **CodeQL** code scanning, via default setup (see above).

## Recommendations for Further Hardening

- **Add Content Security Policy** via a `<meta>` tag in `base.njk`. The origins actually
  loaded today are:
  - `script-src` / `style-src` / `font-src`: `cdn.jsdelivr.net` (KaTeX JS, CSS and its fonts)
  - `style-src` / `font-src`: `fonts.googleapis.com`, `fonts.gstatic.com`
  - `img-src`: `www.nist.gov` (the footer NIST logo is a remote `<img src>`, not a local asset)

  Gotcha before attempting this: `base.njk` contains **two inline `<script>` blocks** (the
  anti-flash theme bootstrap and the KaTeX auto-render call). A naive policy will break both.
  They need either hashes (workable — the build is static, so the hashes are stable) or
  `'unsafe-inline'`, which would defeat much of the point.
- **Configure Dependabot version updates** (`.github/dependabot.yml`) — see above.
- **Enable GitHub secret scanning** in Settings > Code security for a detection layer beyond
  Gitleaks. Status not verifiable from a sandboxed session; confirm in the UI.
- **Re-enable strict ESLint rules** gradually (`no-undef`, `no-unused-vars`) as code is cleaned
  up; the stylistic rules (`semi`, `quotes`) are no longer enforced by the config at all since
  `eslint-config-standard` was dropped.
- **Drop the `@11ty/recursive-copy` override** once Eleventy ships a stable release depending on
  `recursive-copy >=5`. As of this writing the only such release is `4.0.0-alpha.10` (canary),
  which already pins `^5.0.2` — so the fix is coming upstream, but pinning a live site to an
  Eleventy 4.0 alpha is not a reasonable trade for removing a two-line override. Re-check on each
  Eleventy release; Eleventy 4.0 will be a major with its own migration, so this is not a
  drive-by change.
