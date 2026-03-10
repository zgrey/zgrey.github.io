# Security — zgrey.github.io

## CI/CD Pipeline

The GitHub Actions workflow (`.github/workflows/deploy.yml`) runs on every push to `main` and every pull request targeting `main`.

### Build Checks (run on all pushes and PRs)

| Step | Tool | What it does |
|------|------|-------------|
| Install | `npm ci` | Deterministic install from `package-lock.json`; fails on lockfile drift |
| Dependency audit | `npm audit --audit-level=high` | Fails the build on high-severity vulnerabilities |
| Linting | ESLint 8 (`eslint-config-standard`) | Static analysis with relaxed rules for legacy code |
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
| `.eslintrc.json` | ESLint 8 standard config; strict rules disabled for legacy compatibility |
| `.htmlvalidate.json` | HTML validation; allows inline styles, void-style, and trailing whitespace (template artifacts) |
| `.gitleaks.toml` | Gitleaks baseline config (extend to allowlist known false positives) |

## Dependency Management

- ESLint is pinned to `~8.57.0` to prevent automatic upgrade to v9+, which requires a flat config migration (`eslint.config.js`).
- The `gitleaks` npm package was removed from `devDependencies` (non-functional placeholder). Secret scanning in CI uses the official GitHub Action; local scanning requires the [gitleaks binary](https://github.com/gitleaks/gitleaks#installing).

## Recommendations for Further Hardening

- **Re-enable strict ESLint rules** gradually (`semi`, `quotes`, `no-undef`, `no-unused-vars`) as code is cleaned up.
- **Enable GitHub secret scanning** in Settings > Security & analysis for an additional detection layer beyond Gitleaks.
- **Enable Dependabot** for automated dependency update PRs targeting security patches.
- **Add Content Security Policy** via a `<meta>` tag in `base.njk` to restrict CDN origins (Google Fonts, KaTeX, NIST assets).
- **Migrate to ESLint 9+ flat config** (`eslint.config.js`) when ready to modernize the linting setup.
