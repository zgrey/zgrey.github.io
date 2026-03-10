# Security Enhancements for zgrey.github.io

## CI/CD Pipeline (`.github/workflows/deploy.yml`)

Every push to `main` and every pull request triggers:

1. **`npm ci`** — deterministic install from `package-lock.json`; fails fast on lockfile drift.
2. **Dependency audit** — `npm audit --audit-level=high` fails the build on high-severity vulnerabilities.
3. **ESLint linting** — `npm run lint` with `eslint-config-standard` (ESLint 8, pinned via `~8.57.0`).
4. **Secret scanning** — [`gitleaks/gitleaks-action@v2`](https://github.com/gitleaks/gitleaks-action) runs the official Gitleaks GitHub Action (replaces manual binary download).
5. **Build** — `npx @11ty/eleventy` produces the static site.
6. **HTML validation** — `html-validate` checks all generated HTML for errors.
7. **Deploy** — artifacts upload and deploy to GitHub Pages **only** on pushes to `main` (PRs run checks but do not deploy).

### Permissions

```yaml
permissions:
  contents: read
  pages: write
  id-token: write
```

Minimal privilege model — read-only on source, write only to Pages.

## Configuration Files

| File | Purpose |
|------|---------|
| `.eslintrc.json` | ESLint 8 standard config with relaxed rules for legacy code |
| `.htmlvalidate.json` | HTML validation (inline styles & trailing whitespace allowed for templates) |
| `.gitleaks.toml` | Optional Gitleaks baseline config |

## Recommendations for Further Hardening

- **Re-enable strict ESLint rules** gradually as code is refactored (`semi`, `quotes`, `no-undef`, `no-unused-vars`).
- **Enable GitHub secret scanning** in Settings > Security & analysis for an additional detection layer.
- **Enable Dependabot** for automated dependency update PRs.
- **Add Content Security Policy headers** via a `_headers` file or `<meta>` tag for CDN resources (Google Fonts, KaTeX, NIST assets).
