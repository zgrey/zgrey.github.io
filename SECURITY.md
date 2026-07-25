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

## Recommendations for Further Hardening

- **Re-enable strict ESLint rules** gradually (`no-undef`, `no-unused-vars`) as code is cleaned up; the stylistic rules (`semi`, `quotes`) are no longer enforced by the config at all since `eslint-config-standard` was dropped.
- **Enable GitHub secret scanning** in Settings > Security & analysis for an additional detection layer beyond Gitleaks.
- **Enable Dependabot** for automated dependency update PRs targeting security patches.
- **Add Content Security Policy** via a `<meta>` tag in `base.njk` to restrict CDN origins (Google Fonts, KaTeX, NIST assets).
